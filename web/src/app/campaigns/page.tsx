import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Shell, PageHeader } from "@/components/shell";
import { SubNav, CAMPAIGN_GROUP_ITEMS } from "@/components/sub-nav";
import { Sparkline, synthSpendTrend } from "@/components/sparkline";
import { getActiveBusiness } from "@/lib/active-business";
import { getAuth } from "@/lib/auth";
import { getDataClient } from "@/lib/db";
import {
  MetaApiError,
  type DatePreset,
  type DateRange,
  type MetaAdSetSummary,
  type MetaAdSummary,
  type MetaInsights,
  findAction,
  formatCents,
  formatMoney,
  formatPct,
  getAdAccountInfo,
  listAdSetsForAccount,
  listAdsForAccount,
  listCampaignsWithInsights,
  parseDateRange,
} from "@/lib/meta";
import {
  getTokenForBusiness,
  MetaConnectionExpired,
  MetaConnectionRequired,
} from "@/lib/meta-tokens";
import { matchSubVertical, SUBVERTICALS } from "@/lib/cpl-infrastructure";
import type { Vertical } from "@/lib/db/types";

// Hebrew labels mirroring SUB_VERTICAL_HE in /business-knowledge. Kept here
// to avoid a circular dep — single source of truth would be a shared map.
const SUB_VERTICAL_HE_LOCAL: Record<string, string> = {
  ai_chatbot_services: "סוכני AI",
  ai_video_production: "סרטוני AI",
  ai_campaign_management: "ניהול קמפיינים AI",
  saas_marketing_tech: "טכנולוגיית שיווק",
  agency_services: "סוכנות שיווק",
  real_estate_residential: "נדל\"ן מגורים",
  home_services: "שירותי בית",
  beauty_aesthetic: "אסתטיקה",
  fitness_studio: "סטודיו כושר",
  legal_personal: "עו\"ד אישי",
  insurance_agent: "סוכן ביטוח",
  renovation_contractor: "קבלן שיפוצים",
  dental_clinic: "מרפאת שיניים",
  other: "אחר",
};

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "קמפיינים" };

const STATUS_STYLES: Record<string, string> = {
  ACTIVE: "bg-green-100 text-green-800",
  PAUSED: "bg-yellow-100 text-yellow-800",
  DELETED: "bg-red-100 text-red-800",
  ARCHIVED: "bg-gray-200 text-gray-700",
};

const OBJECTIVE_LABEL_HE: Record<string, string> = {
  OUTCOME_SALES: "מכירות",
  OUTCOME_LEADS: "לידים",
  OUTCOME_ENGAGEMENT: "מעורבות",
  OUTCOME_AWARENESS: "מודעות",
  OUTCOME_TRAFFIC: "תעבורה",
  OUTCOME_APP_PROMOTION: "קידום אפליקציה",
  CONVERSIONS: "המרות",
  LINK_CLICKS: "קליקים",
  MESSAGES: "הודעות",
  POST_ENGAGEMENT: "מעורבות בפוסט",
  REACH: "Reach",
  LEAD_GENERATION: "לידים",
};

// Per-objective conversion metrics to surface on each campaign card.
// Each entry tries action types in order and uses the first one that returned a value.
const CONVERSIONS_BY_OBJECTIVE: Record<
  string,
  Array<{ label: string; types: string[] }>
> = {
  MESSAGES: [
    {
      label: "שיחות שנפתחו",
      types: ["onsite_conversion.messaging_conversation_started_7d"],
    },
    {
      label: "תגובות ראשונות",
      types: ["onsite_conversion.messaging_first_reply"],
    },
  ],
  OUTCOME_ENGAGEMENT: [
    {
      label: "שיחות שנפתחו",
      types: ["onsite_conversion.messaging_conversation_started_7d"],
    },
    { label: "מעורבות בפוסט", types: ["post_engagement"] },
  ],
  POST_ENGAGEMENT: [{ label: "מעורבות בפוסט", types: ["post_engagement"] }],
  OUTCOME_LEADS: [
    {
      label: "לידים",
      types: [
        "lead",
        "onsite_conversion.lead_grouped",
        "offsite_conversion.fb_pixel_lead",
      ],
    },
    { label: "שיחות טלפון", types: ["click_to_call_call_confirm"] },
  ],
  LEAD_GENERATION: [
    { label: "לידים", types: ["lead", "onsite_conversion.lead_grouped"] },
  ],
  OUTCOME_SALES: [
    {
      label: "רכישות",
      types: ["purchase", "offsite_conversion.fb_pixel_purchase"],
    },
    {
      label: "הוספות לסל",
      types: ["add_to_cart", "offsite_conversion.fb_pixel_add_to_cart"],
    },
  ],
  CONVERSIONS: [
    {
      label: "רכישות",
      types: ["purchase", "offsite_conversion.fb_pixel_purchase"],
    },
    { label: "לידים", types: ["lead", "offsite_conversion.fb_pixel_lead"] },
  ],
  OUTCOME_TRAFFIC: [
    { label: "קליקים ללינק", types: ["link_click"] },
    { label: "צפיות בדף נחיתה", types: ["landing_page_view"] },
  ],
  LINK_CLICKS: [{ label: "קליקים ללינק", types: ["link_click"] }],
};

function getConversions(
  objective: string,
  ins: MetaInsights | null,
): Array<{ label: string; value: string; cpa?: string }> {
  if (!ins?.actions) return [];
  const groups = CONVERSIONS_BY_OBJECTIVE[objective] ?? [];
  const out: Array<{ label: string; value: string; cpa?: string }> = [];
  for (const { label, types } of groups) {
    for (const t of types) {
      const value = findAction(ins, t);
      if (value) {
        const cpa = ins.cost_per_action_type?.find(
          (a) => a.action_type === t,
        )?.value;
        out.push({ label, value, cpa });
        break;
      }
    }
  }
  return out;
}

export default async function CampaignsPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; since?: string; until?: string }>;
}) {
  const auth = getAuth();
  const session = await auth.getSession();
  if (!session) redirect("/login?next=/campaigns");

  const sp = await searchParams;
  const range = parseDateRange(sp);

  const db = getDataClient();
  const business = await getActiveBusiness();
  // Per-campaign service inference (G5, 2026-05-13). For each Meta campaign,
  // we run matchSubVertical with campaign.name as `campaign_name` (×3 weight)
  // → derives which AIWEON service this campaign is about. Shown as a badge
  // on the campaign card so the operator can verify the agent's anchoring.
  const knowledgeForServiceInference = business
    ? await db.getBusinessKnowledge(business.id)
    : null;

  if (!business) {
    return (
      <Page>
        <Card>
          <CardHeader>
            <CardTitle>אין עסק ב-DB</CardTitle>
            <CardDescription>הרץ migrations ו-seed קודם.</CardDescription>
          </CardHeader>
        </Card>
      </Page>
    );
  }

  let accountInfo: Awaited<ReturnType<typeof getAdAccountInfo>> | null = null;
  let campaigns: Awaited<ReturnType<typeof listCampaignsWithInsights>> = [];
  let allAds: MetaAdSummary[] = [];
  let allAdSets: MetaAdSetSummary[] = [];
  let errorMsg: string | null = null;

  try {
    const { token } = await getTokenForBusiness(db, business);
    [accountInfo, campaigns, allAds, allAdSets] = await Promise.all([
      getAdAccountInfo(token, business.meta_ad_account_id),
      listCampaignsWithInsights(token, business.meta_ad_account_id, range),
      listAdsForAccount(token, business.meta_ad_account_id),
      listAdSetsForAccount(token, business.meta_ad_account_id),
    ]);
  } catch (e) {
    errorMsg =
      e instanceof MetaConnectionRequired
        ? "אין חיבור פעיל ל-Meta — עבור ל-/integrations להתחבר"
        : e instanceof MetaConnectionExpired
          ? "החיבור ל-Meta פג — עבור ל-/integrations להתחבר מחדש"
          : e instanceof MetaApiError
            ? `Meta API: ${e.message}${e.code ? ` (code ${e.code})` : ""}`
            : e instanceof Error
              ? e.message
              : String(e);
  }

  const currency = accountInfo?.currency ?? "USD";

  if (errorMsg) {
    return (
      <Page>
        <Card className="border-red-300">
          <CardHeader>
            <CardTitle className="text-red-900">שגיאה בקריאה ל-Meta</CardTitle>
            <CardDescription
              dir="ltr"
              className="text-left font-mono text-xs text-red-800"
            >
              {errorMsg}
            </CardDescription>
          </CardHeader>
        </Card>
      </Page>
    );
  }

  const activeCount = campaigns.filter(
    (c) => c.effective_status === "ACTIVE",
  ).length;
  const totalSpend = campaigns.reduce(
    (sum, c) => sum + Number(c.insights?.spend ?? 0),
    0,
  );

  const pendingApprovals = await db.listPendingApprovals(business.id);
  const pendingByCampaign = new Map<string, number>();
  for (const a of pendingApprovals) {
    if (a.target_kind === "campaign" && a.target_id) {
      pendingByCampaign.set(
        a.target_id,
        (pendingByCampaign.get(a.target_id) ?? 0) + 1,
      );
    }
  }

  const adsByCampaign = new Map<string, MetaAdSummary[]>();
  for (const ad of allAds) {
    const arr = adsByCampaign.get(ad.campaign_id) ?? [];
    arr.push(ad);
    adsByCampaign.set(ad.campaign_id, arr);
  }

  const adSetsByCampaign = new Map<string, MetaAdSetSummary[]>();
  for (const as of allAdSets) {
    const arr = adSetsByCampaign.get(as.campaign_id) ?? [];
    arr.push(as);
    adSetsByCampaign.set(as.campaign_id, arr);
  }

  return (
    <Page>
      <PageHeader
        eyebrow="קמפיינים"
        title="חיים מ-Meta"
        subtitle={`חשבון: ${accountInfo?.id ?? "—"} · ${accountInfo?.name ?? ""} · ${currency} · timezone ${accountInfo?.timezone_name ?? ""}`}
      />

      <DateRangePicker range={range} />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <StatCard label="קמפיינים סה״כ" value={campaigns.length.toString()} />
        <StatCard label="פעילים" value={activeCount.toString()} />
        <StatCard
          label={`הוצאה · ${rangeLabel(range)}`}
          value={formatMoney(String(totalSpend), currency)}
        />
      </div>

      {campaigns.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>אין קמפיינים בחשבון</CardTitle>
            <CardDescription>
              או שכולם ב-DELETED/ARCHIVED, או שהחשבון ריק.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {campaigns.map((c) => {
            const ins = c.insights;
            const conversions = getConversions(c.objective, ins);
            const objectiveLabel =
              OBJECTIVE_LABEL_HE[c.objective] ?? c.objective;
            const ads = adsByCampaign.get(c.id) ?? [];
            const activeAds = ads.filter(
              (a) => a.effective_status === "ACTIVE",
            ).length;
            const campaignAdSets = adSetsByCampaign.get(c.id) ?? [];
            const adSetDailyTotal = campaignAdSets
              .filter(
                (as) =>
                  as.effective_status !== "DELETED" &&
                  as.effective_status !== "ARCHIVED",
              )
              .reduce((sum, as) => sum + Number(as.daily_budget ?? 0), 0);
            const effectiveDailyCents =
              Number(c.daily_budget ?? 0) || adSetDailyTotal;
            const pendingCount = pendingByCampaign.get(c.id) ?? 0;
            // Per-campaign service inference (G5). The matcher consumes the
            // business haystack plus this campaign's name as `campaign_name`
            // (×3 weight). When the campaign name carries a service term
            // (e.g. "סוכן AI - שלב 1"), that wins. If not, falls back to
            // aggregate match and the badge reads as warm-amber to nudge
            // the operator to rename.
            const serviceInference = knowledgeForServiceInference
              ? matchSubVertical({
                  vertical: knowledgeForServiceInference.vertical as Vertical | null,
                  products_raw: (knowledgeForServiceInference.products ?? [])
                    .map((p) => (p.description ? `${p.name} — ${p.description}` : p.name))
                    .join("  ") || null,
                  ideal_customer:
                    (knowledgeForServiceInference.questionnaire_answers as Record<string, string | undefined> | null)
                      ?.ideal_customer ?? null,
                  usp:
                    (knowledgeForServiceInference.questionnaire_answers as Record<string, string | undefined> | null)
                      ?.usp ?? null,
                  main_pain:
                    (knowledgeForServiceInference.questionnaire_answers as Record<string, string | undefined> | null)
                      ?.main_pain ?? null,
                  campaign_name: c.name,
                })
              : null;
            const serviceIsExplicit =
              serviceInference?.confidence_of_match === "exact" &&
              serviceInference.matched_terms.some((t) =>
                c.name.toLowerCase().includes(t.toLowerCase()),
              );
            const serviceLabelHe = serviceInference
              ? (SUB_VERTICAL_HE_LOCAL[serviceInference.sub] ?? serviceInference.sub)
              : null;
            // Decorative spend curve per card — synthesized from the
            // aggregate spend value (same approach as the dashboard hero).
            // Real per-day breakdown will replace this when we sample
            // `budget_health` decisions or daily insights.
            const cardSpendTrend = synthSpendTrend(
              Math.round(Number(ins?.spend ?? 0)),
              30,
            );
            const isPaused = c.effective_status !== "ACTIVE";
            return (
              <Card
                key={c.id}
                id={`campaign-${c.id}`}
                className={`glass-panel scroll-mt-6 border-0 ${isPaused ? "opacity-70" : ""}`}
              >
                <CardHeader>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="flex flex-col gap-1">
                      <CardTitle className="text-base">
                        {c.name}
                        <span
                          dir="ltr"
                          className="ms-2 font-mono text-[10px] font-normal text-muted-foreground"
                        >
                          #{c.id}
                        </span>
                      </CardTitle>
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_STYLES[c.effective_status] ?? "bg-slate-200"}`}
                        >
                          {c.effective_status}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {objectiveLabel}
                        </span>
                        {serviceLabelHe ? (
                          <span
                            className={
                              "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium " +
                              (serviceIsExplicit
                                ? "border border-emerald-300/60 bg-emerald-50/60 text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-950/40 dark:text-emerald-300"
                                : "border border-amber-300/60 bg-amber-50/60 text-amber-800 dark:border-amber-500/30 dark:bg-amber-950/40 dark:text-amber-300")
                            }
                            title={
                              serviceIsExplicit
                                ? `שם הקמפיין מזכיר את השירות '${serviceLabelHe}' — הסוכן יחקור לפי תת-ורטיקל זה`
                                : `שם הקמפיין לא ספציפי — הסוכן נופל ל-${serviceLabelHe} כברירת מחדל. שנה את שם הקמפיין לתיאורי כדי לקבל אומדן מדויק.`
                            }
                          >
                            שירות: {serviceLabelHe}
                            {!serviceIsExplicit ? " (משוער)" : ""}
                          </span>
                        ) : null}
                        {pendingCount > 0 ? (
                          <Link
                            href={`/approvals?campaign=${c.id}`}
                            className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900 hover:bg-amber-200"
                          >
                            🔔 {pendingCount} הצעות ממתינות
                          </Link>
                        ) : null}
                        <span className="text-xs text-muted-foreground">
                          מודעות:{" "}
                          <strong className="text-foreground">
                            {ads.length}
                          </strong>
                          {activeAds !== ads.length
                            ? ` (${activeAds} פעילות)`
                            : null}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          תקציב יומי:{" "}
                          {effectiveDailyCents > 0
                            ? formatCents(String(effectiveDailyCents), currency)
                            : "ללא הגבלה"}
                        </span>
                        {c.lifetime_budget ? (
                          <span className="text-xs text-muted-foreground">
                            תקציב חיים:{" "}
                            {formatCents(c.lifetime_budget, currency)}
                          </span>
                        ) : null}
                      </div>
                    </div>
                    <a
                      href={`https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=${business.meta_ad_account_id.replace("act_", "")}&selected_campaign_ids=${c.id}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs text-primary underline-offset-2 hover:underline"
                    >
                      פתח ב-Ads Manager ↗
                    </a>
                  </div>
                </CardHeader>
                <CardContent>
                  {Number(ins?.spend ?? 0) > 0 ? (
                    <div className="mb-4 h-[56px]">
                      <Sparkline
                        data={cardSpendTrend}
                        height={56}
                        color={
                          isPaused
                            ? "hsl(var(--muted-foreground))"
                            : "var(--brand-500, hsl(28 91% 54%))"
                        }
                        strokeWidth={1.6}
                      />
                    </div>
                  ) : null}
                  <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-7">
                    <Metric
                      label="הוצאה"
                      value={formatMoney(ins?.spend, currency)}
                    />
                    <Metric label="חשיפות" value={ins?.impressions ?? "—"} />
                    <Metric label="קליקים" value={ins?.clicks ?? "—"} />
                    <Metric label="CTR" value={formatPct(ins?.ctr)} />
                    <Metric
                      label="CPM"
                      value={formatMoney(ins?.cpm, currency)}
                    />
                    <Metric
                      label="CPC"
                      value={formatMoney(ins?.cpc, currency)}
                    />
                    <Metric label="Frequency" value={ins?.frequency ?? "—"} />
                  </div>
                  {conversions.length > 0 ? (
                    <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 rounded-md bg-muted px-3 py-2 text-sm">
                      {conversions.map((m) => (
                        <span key={m.label}>
                          {m.label}: <strong>{m.value}</strong>
                          {m.cpa ? (
                            <span className="text-muted-foreground">
                              {" · עלות: "}
                              {formatMoney(m.cpa, currency)}
                            </span>
                          ) : null}
                        </span>
                      ))}
                    </div>
                  ) : null}
                  {ads.length > 0 ? (
                    <details className="mt-3 text-xs">
                      <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                        מודעות בקמפיין ({ads.length})
                      </summary>
                      <ul className="mt-2 space-y-1 pe-4">
                        {ads.map((a) => (
                          <li
                            key={a.id}
                            className="flex flex-wrap items-center gap-2"
                          >
                            <span
                              className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${STATUS_STYLES[a.effective_status] ?? "bg-slate-200"}`}
                            >
                              {a.effective_status}
                            </span>
                            <span>{a.name}</span>
                            <span
                              dir="ltr"
                              className="font-mono text-[10px] text-muted-foreground"
                            >
                              #{a.id}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </details>
                  ) : null}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        הנתונים נלקחים חי מ-Meta Graph API (טווח: {rangeLabel(range)}). ה-PRD
        רואה את העמוד הזה כ-v2, אבל הוא כאן כדי שתוכל לראות את הנתונים הגולמיים
        לפני שהסוכן מעבד אותם.
      </p>
    </Page>
  );
}

function Page({ children }: { children: React.ReactNode }) {
  return (
    <Shell active="/campaigns">
      <SubNav items={CAMPAIGN_GROUP_ITEMS} />
      <div className="flex flex-col gap-6">{children}</div>
    </Shell>
  );
}

function StatCard({
  label,
  value,
  accent = false,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div className="glass-panel group relative overflow-hidden rounded-lg p-4 transition-transform hover:-translate-y-0.5">
      <div className="flex items-center justify-between">
        <span className="text-[11.5px] font-medium text-muted-foreground">
          {label}
        </span>
        {accent ? (
          <span
            className="h-1.5 w-1.5 rounded-full bg-brand-500 dark:bg-brand-400"
            aria-hidden
          />
        ) : null}
      </div>
      <div className="font-tabular mt-2 text-[26px] font-bold leading-none tracking-[-0.02em]">
        {value}
      </div>
    </div>
  );
}

const PRESET_LABEL_HE: Record<DatePreset, string> = {
  today: "היום",
  yesterday: "אתמול",
  last_7d: "7 ימים",
  last_30d: "30 ימים",
  last_90d: "90 ימים",
  maximum: "מקסימום",
};

function rangeLabel(range: DateRange): string {
  if (range.kind === "custom") return `${range.since} → ${range.until}`;
  return PRESET_LABEL_HE[range.preset];
}

function DateRangePicker({ range }: { range: DateRange }) {
  const presets: DatePreset[] = [
    "today",
    "yesterday",
    "last_7d",
    "last_30d",
    "last_90d",
    "maximum",
  ];
  const currentPreset = range.kind === "preset" ? range.preset : null;
  const customSince = range.kind === "custom" ? range.since : "";
  const customUntil = range.kind === "custom" ? range.until : "";

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border p-3">
      <span className="text-sm font-medium text-muted-foreground">
        טווח תאריכים:
      </span>
      <div className="flex flex-wrap gap-1">
        {presets.map((p) => {
          const isActive = currentPreset === p;
          return (
            <Link
              key={p}
              href={`/campaigns?range=${p}`}
              className={`rounded-md px-3 py-1 text-sm transition-colors ${
                isActive
                  ? "bg-primary text-primary-foreground"
                  : "border hover:bg-muted"
              }`}
            >
              {PRESET_LABEL_HE[p]}
            </Link>
          );
        })}
      </div>
      <form
        method="GET"
        action="/campaigns"
        className="ms-auto flex flex-wrap items-center gap-1"
      >
        <span className="text-xs text-muted-foreground">טווח מותאם:</span>
        <input
          type="date"
          name="since"
          defaultValue={customSince}
          className="rounded-md border bg-background px-2 py-1 text-sm"
          aria-label="מתאריך"
          required
        />
        <span className="text-sm text-muted-foreground">–</span>
        <input
          type="date"
          name="until"
          defaultValue={customUntil}
          className="rounded-md border bg-background px-2 py-1 text-sm"
          aria-label="עד תאריך"
          required
        />
        <button
          type="submit"
          className={`rounded-md px-3 py-1 text-sm transition-colors ${
            range.kind === "custom"
              ? "bg-primary text-primary-foreground"
              : "border hover:bg-muted"
          }`}
        >
          החל
        </button>
      </form>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-0.5 font-semibold">{value}</div>
    </div>
  );
}
