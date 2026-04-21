import Link from "next/link";
import { redirect } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Nav } from "@/components/nav";
import { getAuth } from "@/lib/auth";
import { getDataClient } from "@/lib/db";
import {
  MetaApiError,
  type DatePreset,
  type DateRange,
  type MetaAdSummary,
  type MetaInsights,
  findAction,
  formatCents,
  formatMoney,
  formatPct,
  getAdAccountInfo,
  listAdsForAccount,
  listCampaignsWithInsights,
  parseDateRange,
} from "@/lib/meta";

export const dynamic = "force-dynamic";

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
const CONVERSIONS_BY_OBJECTIVE: Record<string, Array<{ label: string; types: string[] }>> = {
  MESSAGES: [
    { label: "שיחות שנפתחו", types: ["onsite_conversion.messaging_conversation_started_7d"] },
    { label: "תגובות ראשונות", types: ["onsite_conversion.messaging_first_reply"] },
  ],
  OUTCOME_ENGAGEMENT: [
    { label: "שיחות שנפתחו", types: ["onsite_conversion.messaging_conversation_started_7d"] },
    { label: "מעורבות בפוסט", types: ["post_engagement"] },
  ],
  POST_ENGAGEMENT: [
    { label: "מעורבות בפוסט", types: ["post_engagement"] },
  ],
  OUTCOME_LEADS: [
    { label: "לידים", types: ["lead", "onsite_conversion.lead_grouped", "offsite_conversion.fb_pixel_lead"] },
    { label: "שיחות טלפון", types: ["click_to_call_call_confirm"] },
  ],
  LEAD_GENERATION: [
    { label: "לידים", types: ["lead", "onsite_conversion.lead_grouped"] },
  ],
  OUTCOME_SALES: [
    { label: "רכישות", types: ["purchase", "offsite_conversion.fb_pixel_purchase"] },
    { label: "הוספות לסל", types: ["add_to_cart", "offsite_conversion.fb_pixel_add_to_cart"] },
  ],
  CONVERSIONS: [
    { label: "רכישות", types: ["purchase", "offsite_conversion.fb_pixel_purchase"] },
    { label: "לידים", types: ["lead", "offsite_conversion.fb_pixel_lead"] },
  ],
  OUTCOME_TRAFFIC: [
    { label: "קליקים ללינק", types: ["link_click"] },
    { label: "צפיות בדף נחיתה", types: ["landing_page_view"] },
  ],
  LINK_CLICKS: [
    { label: "קליקים ללינק", types: ["link_click"] },
  ],
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
        const cpa = ins.cost_per_action_type?.find((a) => a.action_type === t)?.value;
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
  const business = process.env.BUSINESS_ID
    ? await db.getBusinessById(process.env.BUSINESS_ID)
    : await db.getFirstBusiness();

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
  let errorMsg: string | null = null;

  try {
    [accountInfo, campaigns, allAds] = await Promise.all([
      getAdAccountInfo(business.meta_ad_account_id),
      listCampaignsWithInsights(business.meta_ad_account_id, range),
      listAdsForAccount(business.meta_ad_account_id),
    ]);
  } catch (e) {
    errorMsg =
      e instanceof MetaApiError
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
            <CardDescription dir="ltr" className="text-left font-mono text-xs text-red-800">
              {errorMsg}
            </CardDescription>
          </CardHeader>
        </Card>
      </Page>
    );
  }

  const activeCount = campaigns.filter((c) => c.effective_status === "ACTIVE").length;
  const totalSpend = campaigns.reduce((sum, c) => sum + Number(c.insights?.spend ?? 0), 0);

  const adsByCampaign = new Map<string, MetaAdSummary[]>();
  for (const ad of allAds) {
    const arr = adsByCampaign.get(ad.campaign_id) ?? [];
    arr.push(ad);
    adsByCampaign.set(ad.campaign_id, arr);
  }

  return (
    <Page>
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold">קמפיינים (חיים מ-Meta)</h1>
        <p className="text-sm text-muted-foreground">
          חשבון: <span dir="ltr" className="font-mono text-xs">{accountInfo?.id}</span> ·{" "}
          {accountInfo?.name} · {currency} · timezone {accountInfo?.timezone_name}
        </p>
      </header>

      <DateRangePicker range={range} />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <StatCard label="קמפיינים סה״כ" value={campaigns.length.toString()} />
        <StatCard label="פעילים" value={activeCount.toString()} />
        <StatCard label={`הוצאה · ${rangeLabel(range)}`} value={formatMoney(String(totalSpend), currency)} />
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
            const objectiveLabel = OBJECTIVE_LABEL_HE[c.objective] ?? c.objective;
            const ads = adsByCampaign.get(c.id) ?? [];
            const activeAds = ads.filter((a) => a.effective_status === "ACTIVE").length;
            return (
              <Card key={c.id}>
                <CardHeader>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="flex flex-col gap-1">
                      <CardTitle className="text-base">
                        {c.name}
                        <span dir="ltr" className="ms-2 font-mono text-[10px] font-normal text-muted-foreground">
                          #{c.id}
                        </span>
                      </CardTitle>
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_STYLES[c.effective_status] ?? "bg-slate-200"}`}
                        >
                          {c.effective_status}
                        </span>
                        <span className="text-xs text-muted-foreground">{objectiveLabel}</span>
                        <span className="text-xs text-muted-foreground">
                          מודעות: <strong className="text-foreground">{ads.length}</strong>
                          {activeAds !== ads.length ? ` (${activeAds} פעילות)` : null}
                        </span>
                        {c.daily_budget ? (
                          <span className="text-xs text-muted-foreground">
                            תקציב יומי: {formatCents(c.daily_budget, currency)}
                          </span>
                        ) : null}
                        {c.lifetime_budget ? (
                          <span className="text-xs text-muted-foreground">
                            תקציב חיים: {formatCents(c.lifetime_budget, currency)}
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
                  <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-7">
                    <Metric label="הוצאה" value={formatMoney(ins?.spend, currency)} />
                    <Metric label="חשיפות" value={ins?.impressions ?? "—"} />
                    <Metric label="קליקים" value={ins?.clicks ?? "—"} />
                    <Metric label="CTR" value={formatPct(ins?.ctr)} />
                    <Metric label="CPM" value={formatMoney(ins?.cpm, currency)} />
                    <Metric label="CPC" value={formatMoney(ins?.cpc, currency)} />
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
                          <li key={a.id} className="flex flex-wrap items-center gap-2">
                            <span
                              className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${STATUS_STYLES[a.effective_status] ?? "bg-slate-200"}`}
                            >
                              {a.effective_status}
                            </span>
                            <span>{a.name}</span>
                            <span dir="ltr" className="font-mono text-[10px] text-muted-foreground">
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
        הנתונים נלקחים חי מ-Meta Graph API (טווח: {rangeLabel(range)}). ה-PRD רואה את העמוד הזה כ-v2,
        אבל הוא כאן כדי שתוכל לראות את הנתונים הגולמיים לפני שהסוכן מעבד אותם.
      </p>
    </Page>
  );
}

function Page({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen p-6">
      <div className="mx-auto flex max-w-6xl flex-col gap-6">
        <Nav active="/campaigns" />
        {children}
      </div>
    </main>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-bold">{value}</div>
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
  const presets: DatePreset[] = ["today", "yesterday", "last_7d", "last_30d", "last_90d", "maximum"];
  const currentPreset = range.kind === "preset" ? range.preset : null;
  const customSince = range.kind === "custom" ? range.since : "";
  const customUntil = range.kind === "custom" ? range.until : "";

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border p-3">
      <span className="text-sm font-medium text-muted-foreground">טווח תאריכים:</span>
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
      <form method="GET" action="/campaigns" className="ms-auto flex flex-wrap items-center gap-1">
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
