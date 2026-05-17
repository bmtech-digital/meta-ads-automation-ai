import Link from "next/link";
import { redirect } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Pencil } from "lucide-react";
import { Shell, PageHeader, SectionHeader } from "@/components/shell";
import { PulseDot } from "@/components/brand/icons";
import { RunNowButton } from "@/components/run-now-button";
import { BudgetHealthCard } from "@/components/budget-health-card";
import { CountUp } from "@/components/count-up";
import { Sparkline, synthSpendTrend } from "@/components/sparkline";
import { getActiveBusiness } from "@/lib/active-business";
import { getAuth } from "@/lib/auth";
import { getDataClient } from "@/lib/db";
import {
  URGENCY_LABEL_HE,
  URGENCY_STYLES,
  TARGET_KIND_LABEL_HE,
  relativeHe,
  requiresHumanReview,
  taskTypeLabel,
  truncate,
} from "@/lib/approvals-fmt";
import type {
  AgentDecision,
  Approval,
  Business,
  Heartbeat,
  HeartbeatFlow,
} from "@/lib/db/types";
import {
  isTokenActionable,
  tokenExpiryState,
  tokenStateLabelHe,
  tokenStateStyles,
} from "@/lib/token-expiry";
import {
  bandMedianHe,
  classifyAgainstBenchmark,
  formatBandHe,
  getBenchmark,
  verdictHe,
  type KpiBenchmark,
  type KpiKind,
} from "@/lib/kpi-benchmarks";
import {
  estimateCPL,
  matchSubVertical,
  monthOf,
  pickGeoTier,
  SUBVERTICALS,
  type EstimateResult,
} from "@/lib/cpl-infrastructure";
import { ResearchBenchmarkButton } from "@/components/research-benchmark-button";
import { fetchLiveSpendAndRecord, type LiveSpendResult } from "@/lib/live-spend";

const INBOX_PREVIEW_LIMIT = 5;

const FLOWS: Array<{ flow: HeartbeatFlow; label: string; schedule: string }> = [
  {
    flow: "daily_observe_propose",
    label: "סריקה יומית",
    schedule: "כל יום 09:00",
  },
  { flow: "execute_approvals", label: "ביצוע אישורים", schedule: "כל 15 דק׳" },
  {
    flow: "weekly_creative_firehose",
    label: "ייצור קריאייטיבים",
    schedule: "שני 10:00",
  },
  {
    flow: "weekly_competitive_research",
    label: "מחקר תחרותי שבועי",
    schedule: "שני 11:00",
  },
];

type PhaseMeta = {
  label: string;
  tone: "active" | "idle" | "error" | "success";
  cls: string;
};

function phaseMeta(hb: Heartbeat | undefined): PhaseMeta {
  if (!hb)
    return { label: "עוד לא רץ", tone: "idle", cls: "text-muted-foreground" };
  if (hb.phase === "end")
    return { label: "הצלחה", tone: "success", cls: "text-success" };
  if (hb.phase === "error")
    return { label: "נכשל", tone: "error", cls: "text-destructive" };
  return {
    label: "רץ עכשיו",
    tone: "active",
    cls: "text-brand-500 dark:text-brand-400",
  };
}

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const auth = getAuth();
  const session = await auth.getSession();
  if (!session) redirect("/login");

  const db = getDataClient();
  const business = await getActiveBusiness();

  const heartbeats = business ? await db.getLatestHeartbeats(business.id) : [];
  const byFlow = new Map(heartbeats.map((h) => [h.flow, h]));
  const pendingApprovals = business
    ? await db.listPendingApprovals(business.id)
    : [];
  const inboxPreview = pendingApprovals.slice(0, INBOX_PREVIEW_LIMIT);
  const inboxRemainder = Math.max(
    0,
    pendingApprovals.length - inboxPreview.length,
  );
  // Spend on the hero block must reflect Meta in real-time, not the row the
  // agent wrote on its last run (which can be 1–4 days stale in local dev
  // without cron). We fetch live + record a fresh budget_health row in
  // parallel with the stale-row lookup, then pick whichever is more recent
  // when handing off to SpendHero / BudgetHealthCard.
  const [staleBudgetHealth, liveSpend]: [
    Awaited<ReturnType<typeof db.getLatestBudgetHealthDecision>>,
    LiveSpendResult | null,
  ] = business
    ? await Promise.all([
        db.getLatestBudgetHealthDecision(business.id),
        fetchLiveSpendAndRecord(db, business).catch(() => null),
      ])
    : [null, null];
  const budgetHealth =
    liveSpend?.ok ? liveSpend.decision : staleBudgetHealth;
  const spendIsLive = !!liveSpend?.ok;
  const spendFailReason = liveSpend && !liveSpend.ok ? liveSpend.reason : null;
  const knowledge = business
    ? await db.getBusinessKnowledge(business.id)
    : null;
  // Read the latest agent-researched benchmark for the business's primary
  // KPI. When present, the dashboard tile shows the business-specific value
  // (researched via WebSearch grounded in business_knowledge); when null,
  // it falls back to the generic per-vertical band and labels the source
  // honestly. The CTA button on the tile triggers the agent to research.
  const primaryKpi = business?.primary_kpi as
    | "cpa"
    | "cpl"
    | "roas"
    | null
    | undefined;
  const kpiResearch =
    business && primaryKpi && ["cpa", "cpl", "roas"].includes(primaryKpi)
      ? await db.getLatestKpiResearch(business.id, primaryKpi)
      : null;
  // Resolve the connection's real expiry — the `business.meta_access_token_expires_at`
  // column may not be mirrored on auto-provisioned businesses from before
  // the OAuth-callback mirror step landed. The connection is the truth.
  const connection = business
    ? await db.getConnectionByAdAccountId(business.meta_ad_account_id)
    : null;
  const businessForToken: Business | null = business
    ? {
        ...business,
        meta_access_token_expires_at:
          connection?.token_expires_at ??
          business.meta_access_token_expires_at,
      }
    : null;

  return (
    <Shell active="/">
      <PageHeader
        eyebrow="דשבורד"
        title={business ? business.name : "Campaigner"}
        subtitle="הסוכן סורק, מציע, ומבצע רק אחרי שאתה מאשר. כל מה שצריך לקרות היום — מופיע כאן."
        actions={
          <div className="flex items-center gap-2">
            <Badge
              variant="outline"
              className="border-border bg-muted/40 font-mono text-[10.5px] font-medium uppercase tracking-wider text-muted-foreground"
            >
              DB · {db.mode}
            </Badge>
            <Badge
              variant="outline"
              className="border-border bg-muted/40 font-mono text-[10.5px] font-medium uppercase tracking-wider text-muted-foreground"
            >
              AUTH · {auth.mode}
            </Badge>
          </div>
        }
      />

      {business && businessForToken ? (
        <div className="flex flex-col gap-10">
          <TokenExpiryBanner business={businessForToken} />

          <SpendHero
            business={business}
            budgetHealth={budgetHealth}
            isLive={spendIsLive}
            failReason={spendFailReason}
          />

          <BudgetHealthCard business={business} decision={budgetHealth} />

          <ApprovalsInbox
            preview={inboxPreview}
            total={pendingApprovals.length}
            remainder={inboxRemainder}
          />

          <section>
            <SectionHeader
              title="בריף העסק"
              description="הקלט שהסוכן קורא לפני כל ריצה. שינויים כאן משפיעים על סריקת הבוקר."
              action={
                <Link href="/settings">
                  <Button variant="outline" size="sm" className="gap-2">
                    <Pencil size={14} />
                    ערוך
                  </Button>
                </Link>
              }
            />
            <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
              <KpiTile
                label="תקציב פרסום חודשי"
                value={
                  business.monthly_budget_ils
                    ? `₪${Number(business.monthly_budget_ils).toLocaleString("he-IL")}`
                    : "—"
                }
                hint={
                  business.monthly_budget_ils ? "מוגדר ב-Business" : "לא הוגדר"
                }
                accent={!!business.monthly_budget_ils}
              />
              <KpiTile
                label="תקציב יומי (מחושב)"
                value={
                  business.monthly_budget_ils
                    ? `≈ ₪${Math.round(Number(business.monthly_budget_ils) / 30).toLocaleString("he-IL")}`
                    : "—"
                }
                hint="חודשי ÷ 30"
              />
              <KpiTile
                label="KPI עיקרי"
                value={(business.primary_kpi ?? "—").toString().toUpperCase()}
                hint="נגזר מה-vertical"
              />
              <KpiTargetTile
                business={business}
                knowledge={knowledge}
                research={kpiResearch}
              />
            </div>
            <dl className="glass-surface mt-5 grid grid-cols-1 gap-y-2.5 gap-x-8 rounded-lg p-4 text-[13px] sm:grid-cols-[auto_1fr]">
              <MetaRow label="חשבון Meta" value={business.meta_ad_account_id} />
              <MetaRow label="Page ID" value={business.meta_page_id ?? "—"} />
              <MetaRow label="מזהה עסק" value={business.id} />
              <TokenRow business={businessForToken} />
            </dl>
          </section>

          <section>
            <SectionHeader
              title="סריקה אחרונה"
              description="כל runner כותב heartbeat ל-Supabase בכל start / end / error. אם משהו לא התחדש מעל ״הצפוי״ — יש בעיה."
            />
            <ul className="glass-surface divide-y divide-border/60 rounded-lg overflow-hidden">
              {FLOWS.map(({ flow, label, schedule }) => {
                const hb = byFlow.get(flow);
                const meta = phaseMeta(hb);
                return (
                  <li
                    key={flow}
                    className="flex items-center gap-4 px-4 py-3.5 transition-colors hover:bg-muted/30"
                  >
                    <PulseDot
                      tone={meta.tone}
                      className={
                        meta.tone === "active" ? "animate-pulse-soft" : ""
                      }
                    />
                    <div className="flex min-w-0 flex-1 flex-col">
                      <span className="font-medium">{label}</span>
                      <span className="text-xs text-muted-foreground">
                        {schedule}
                      </span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="font-tabular text-xs text-muted-foreground">
                        {hb ? relativeHe(hb.ran_at) : "—"}
                      </span>
                      <span className={`text-xs font-semibold ${meta.cls}`}>
                        {meta.label}
                      </span>
                      <RunNowButton flow={flow} />
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        </div>
      ) : (
        <EmptyBusinessState />
      )}
    </Shell>
  );
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      {/* dd stays in RTL (inherit) so value aligns naturally to the right,
          next to the label. Only the LTR ID is isolated inside .mono-ltr. */}
      <dd className="text-[12.5px] text-foreground/90">
        <span className="mono-ltr">{value}</span>
      </dd>
    </>
  );
}

function TokenRow({ business }: { business: Business }) {
  const state = tokenExpiryState(business);
  return (
    <>
      <dt className="text-muted-foreground">טוקן Meta</dt>
      {/* justify-end pushes the badge + link to the right edge of the
          stretched dd column, lining them up with the right-aligned label. */}
      <dd className="flex items-center justify-end gap-2">
        <span
          className={`inline-flex items-center rounded-full border px-2 py-[1px] text-[11.5px] font-medium ${tokenStateStyles(state)}`}
        >
          {tokenStateLabelHe(state)}
        </span>
        <Link
          href="/settings"
          className="text-[11.5px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
        >
          נהל
        </Link>
      </dd>
    </>
  );
}

function TokenExpiryBanner({ business }: { business: Business }) {
  const state = tokenExpiryState(business);
  if (!isTokenActionable(state)) return null;
  const isExpired = state.kind === "expired" || state.kind === "critical";
  return (
    <div
      role="alert"
      className={
        "flex flex-wrap items-center justify-between gap-3 rounded-lg border px-4 py-3 text-sm " +
        tokenStateStyles(state)
      }
    >
      <div className="flex items-center gap-2 font-medium">
        <span aria-hidden>{isExpired ? "🚨" : "⚠️"}</span>
        <span>
          {state.kind === "expired"
            ? `הטוקן של Meta פג לפני ${state.daysAgo} ימים — הביצועים והסריקות ייכשלו עד שתחדש.`
            : state.kind === "critical"
              ? state.daysLeft === 0
                ? "הטוקן של Meta פג היום. חדש עכשיו כדי שהסריקה של מחר תעבוד."
                : `הטוקן של Meta פג בעוד ${state.daysLeft} ימים — חדש עכשיו.`
              : state.kind === "warning"
                ? `הטוקן של Meta פג בעוד ${state.daysLeft} ימים.`
                : null}
        </span>
      </div>
      <Link
        href="/settings"
        className="inline-flex items-center gap-1 rounded-md border border-current/30 bg-background/60 px-3 py-1 text-xs font-semibold hover:bg-background"
      >
        עבור להגדרות
        <ArrowLeft size={12} />
      </Link>
    </div>
  );
}

// Hebrew labels for the sub-verticals we display on the dashboard tile.
// Keep in sync with SUBVERTICALS keys in `lib/cpl-infrastructure.ts`. The
// map only covers sub-verticals that are likely to render on the dashboard
// — the rest fall through to the raw key.
const SUB_VERTICAL_HE: Record<string, string> = {
  real_estate_residential: "נדל\"ן מגורים",
  real_estate_commercial: "נדל\"ן מסחרי",
  home_services: "שירותי בית",
  renovation_contractor: "קבלן שיפוצים",
  insurance_agent: "סוכן ביטוח",
  automotive_dealer: "סוכנות רכב",
  automotive_service: "מוסך / שירות רכב",
  beauty_aesthetic: "אסתטיקה",
  wellness_alt: "רפואה משלימה",
  fitness_studio: "סטודיו כושר",
  dental_clinic: "מרפאת שיניים",
  private_clinic: "מרפאה פרטית",
  legal_personal: "עו\"ד אישי",
  legal_corporate: "עו\"ד מסחרי",
  accounting_tax: "רואה חשבון / מס",
  education_private: "מורה / שיעורי עזר",
  education_university: "השכלה גבוהה",
  saas_horizontal: "SaaS כללי",
  saas_marketing_tech: "טכנולוגיית שיווק",
  saas_dev_tech: "טכנולוגיה למפתחים",
  agency_services: "סוכנות שיווק",
  ai_chatbot_services: "סוכני AI / צ'אט-בוטים",
  ai_video_production: "הפקת סרטוני AI",
  ai_campaign_management: "ניהול קמפיינים AI",
  ecom_fashion: "אי-קומרס אופנה",
  ecom_beauty_products: "אי-קומרס טיפוח",
  ecom_electronics: "אי-קומרס אלקטרוניקה",
  ecom_home_goods: "אי-קומרס מוצרי בית",
  ecom_food_supplements: "אי-קומרס תוספי תזונה",
};

/**
 * Static rich CPL estimate derived from business_knowledge — sub-vertical ×
 * geo × cold × consultation × CTWA-or-lead-form × current month. Returns
 * null when match falls back to `other` (no products / no vertical) so the
 * caller can fall through to the flat per-vertical band.
 *
 * This is the Tier-2 source in the three-tier hierarchy on KpiTargetTile:
 *   Tier 1 — agent live research (research approval exists)
 *   Tier 2 — this static rich estimate
 *   Tier 3 — flat per-vertical band from kpi-benchmarks
 */
function computeRichEstimate({
  kpi,
  knowledge,
  business,
}: {
  kpi: KpiKind | null;
  knowledge: {
    vertical: string | null;
    service_regions: string[] | null;
    products: { name: string; description?: string }[] | null;
    questionnaire_answers: Record<string, unknown> | null;
  } | null;
  business: Business;
}): (EstimateResult & { matchedSubVerticalHe: string }) | null {
  if (!kpi || !knowledge) return null;
  if (kpi === "roas") return null; // ROAS isn't modeled by the multiplier stack.
  const productsBlob = (knowledge.products ?? [])
    .map((p) => `${p.name}${p.description ? " — " + p.description : ""}`)
    .join("  ");
  const qa = knowledge.questionnaire_answers ?? {};
  const match = matchSubVertical({
    vertical: knowledge.vertical as
      | "ecommerce"
      | "leads"
      | "b2b_saas"
      | "awareness"
      | "app"
      | "other"
      | null,
    products_raw: productsBlob || null,
    ideal_customer: (qa.ideal_customer as string | undefined) ?? null,
    usp: (qa.usp as string | undefined) ?? null,
    main_pain: (qa.main_pain as string | undefined) ?? null,
  });
  if (match.confidence_of_match === "fallback") return null;
  const cell = SUBVERTICALS[match.sub];
  // Default channel: B2C services → CTWA (IL baseline); everything else
  // → lead_form. Mirrors the Python tool's default in estimate_cpl.py.
  const defaultChannel: "click_to_whatsapp" | "lead_form" =
    cell.parent === "leads" ? "click_to_whatsapp" : "lead_form";
  const estimate = estimateCPL({
    sub: match.sub,
    geo: pickGeoTier(knowledge.service_regions),
    stage: "cold",
    offer: "consultation_free",
    channel: defaultChannel,
    month: monthOf(new Date()),
    security_event: false,
  });
  return {
    ...estimate,
    matchedSubVerticalHe: SUB_VERTICAL_HE[match.sub] ?? match.sub,
  };
}

/**
 * KpiTargetTile — surfaces the *target value* for the business's primary KPI
 * (per migration 019), alongside the Israeli-market benchmark band for the
 * business's vertical (per kpi-benchmarks.ts). The user shouldn't have to
 * invent a target; we show what's realistic and let them see at a glance
 * whether their target is "מעל הממוצע" / "בטווח" / "לא ריאלי".
 *
 * The agent's §T-2 reality-check gate uses the same band — if the operator's
 * target is implausibly low, the agent emits an alert before optimizing
 * toward it.
 */
function KpiTargetTile({
  business,
  knowledge,
  research,
}: {
  business: Business;
  knowledge: {
    vertical: string | null;
    service_regions: string[] | null;
    products: { name: string; description?: string }[] | null;
    questionnaire_answers: Record<string, unknown> | null;
  } | null;
  /** Agent-researched market average for this business+KPI, or null when not yet researched. */
  research: {
    market_average: number;
    range_low: number | null;
    range_high: number | null;
    sources_count: number;
    researched_at: string | null;
    approval_id: string;
  } | null;
}) {
  const kpi = business.primary_kpi as KpiKind | null;
  let target: number | null = null;
  let label = "יעד KPI";
  let unitPrefix = "";
  let unitSuffix = "";
  if (kpi === "cpa") {
    target = business.target_cpa_ils;
    label = "יעד עלות להשגה (CPA)";
    unitPrefix = "≤ ₪";
  } else if (kpi === "cpl") {
    target = business.target_cpl_ils;
    label = "יעד עלות לליד (CPL)";
    unitPrefix = "≤ ₪";
  } else if (kpi === "roas") {
    target = business.target_roas;
    label = "יעד החזר על הפרסום (ROAS)";
    unitSuffix = "x";
  }
  const hasTarget = target !== null && target !== undefined;
  const vertical = (knowledge?.vertical ?? null) as
    | "ecommerce"
    | "leads"
    | "b2b_saas"
    | "awareness"
    | "app"
    | "other"
    | null;
  const band = kpi ? getBenchmark(vertical, kpi) : null;
  // Rich per-business estimate (Block 2026-05-13). Only computed for CPL/CPA
  // verticals where we have a sub-vertical match — otherwise we fall back to
  // the flat band below. ROAS isn't modeled by the rich estimator (it's an
  // output ratio, not a CPL); the flat band still covers it.
  const richEstimate = computeRichEstimate({
    kpi,
    knowledge,
    business,
  });
  // Build a band-shaped object out of the rich estimate so the existing
  // classifier can score the operator's target against it. The classifier
  // expects `(value, kpi, band)` — we synthesize the band from the rich
  // estimate's value + band tuple.
  const effectiveBand: KpiBenchmark | null = richEstimate
    ? {
        implausible_below: Math.round(richEstimate.band_ils[0] * 0.4),
        good_max: richEstimate.band_ils[0],
        median: richEstimate.value_ils,
        realistic_max: richEstimate.band_ils[1],
        unambitious_above: Math.round(richEstimate.band_ils[1] * 2.5),
        source_note: "rich estimate (cpl-infrastructure)",
      }
    : band;
  const verdict =
    hasTarget && effectiveBand && kpi
      ? classifyAgainstBenchmark(target!, kpi, effectiveBand)
      : null;
  const verdictUi = verdict ? verdictHe(verdict) : null;
  const toneClass: Record<string, string> = {
    good: "text-emerald-600 dark:text-emerald-400",
    ok: "text-muted-foreground",
    warn: "text-amber-600 dark:text-amber-400",
    bad: "text-red-600 dark:text-red-400",
  };
  const ringClass = !kpi
    ? ""
    : !hasTarget
      ? "ring-1 ring-amber-500/40"
      : verdictUi?.tone === "bad"
        ? "ring-1 ring-red-500/40"
        : verdictUi?.tone === "warn"
          ? "ring-1 ring-amber-500/30"
          : "";

  return (
    <div
      className={
        "glass-panel group relative overflow-hidden rounded-lg p-4 transition-transform hover:-translate-y-0.5 " +
        ringClass
      }
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">
          {label}
        </span>
        {hasTarget && verdictUi ? (
          <span
            className={
              "text-[10.5px] font-semibold " + toneClass[verdictUi.tone]
            }
          >
            {verdictUi.label}
          </span>
        ) : !hasTarget ? (
          <span
            className="h-1.5 w-1.5 rounded-full bg-amber-500"
            aria-hidden
          />
        ) : null}
      </div>
      <div className="mt-2 font-tabular text-[26px] font-semibold leading-none tracking-[-0.02em]">
        {hasTarget
          ? `${unitPrefix}${Number(target).toLocaleString("he-IL")}${unitSuffix}`
          : "לא הוגדר"}
      </div>
      {/* Honest source labeling: when the agent has researched a
          business-specific value, show that prominently with "ממוצע השוק
          (לעסק שלך)" + sources count. Otherwise show the generic
          per-vertical band labeled clearly as "ממוצע ענפי כללי" and offer
          a CTA to trigger the agent's research. */}
      {research && kpi ? (
        // Tier 1 — agent has run live research (highest signal).
        <div className="mt-2 flex items-baseline justify-between gap-2 rounded-md border border-emerald-300/60 bg-emerald-50/40 px-2 py-1.5 dark:border-emerald-500/30 dark:bg-emerald-950/20">
          <div className="flex flex-col">
            <span className="text-[10.5px] font-semibold uppercase tracking-wider text-emerald-800 dark:text-emerald-300">
              ממוצע השוק (לעסק שלך)
            </span>
            <span className="text-[9.5px] text-emerald-700/80 dark:text-emerald-400/70">
              {research.sources_count > 0
                ? `מבוסס על ${research.sources_count} מקורות שהסוכן חקר`
                : "מחקר הסוכן"}
            </span>
          </div>
          <span className="font-tabular text-[15px] font-bold text-emerald-900 dark:text-emerald-100">
            {kpi === "roas"
              ? `${research.market_average}x`
              : `₪${Math.round(research.market_average).toLocaleString("he-IL")}`}
          </span>
        </div>
      ) : richEstimate && kpi ? (
        // Tier 2 — static rich estimate from cpl-infrastructure. Tailored
        // to sub-vertical + geo + funnel-stage defaults; no WebSearch.
        <div className="mt-2 flex items-baseline justify-between gap-2 rounded-md border border-sky-300/60 bg-sky-50/40 px-2 py-1.5 dark:border-sky-500/30 dark:bg-sky-950/20">
          <div className="flex flex-col">
            <span className="text-[10.5px] font-semibold uppercase tracking-wider text-sky-800 dark:text-sky-300">
              ממוצע מותאם לעסק שלך (אומדן)
            </span>
            <span className="text-[9.5px] text-sky-700/80 dark:text-sky-400/70">
              {`לפי ${richEstimate.matchedSubVerticalHe} · ₪${richEstimate.band_ils[0]}–₪${richEstimate.band_ils[1]}`}
            </span>
          </div>
          <span className="font-tabular text-[15px] font-bold text-sky-900 dark:text-sky-100">
            {`₪${richEstimate.value_ils.toLocaleString("he-IL")}`}
          </span>
        </div>
      ) : band && kpi ? (
        // Tier 3 — flat per-vertical fallback. Used when sub-vertical match
        // returns `fallback` (no products/vertical) or KPI is ROAS.
        <div className="mt-2 flex items-baseline justify-between gap-2 rounded-md border border-border/60 bg-background/50 px-2 py-1.5">
          <div className="flex flex-col">
            <span className="text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
              ממוצע ענפי כללי
            </span>
            <span className="text-[9.5px] text-muted-foreground/80">
              נתון רוחבי לוורטיקל — לא ספציפי לעסק שלך
            </span>
          </div>
          <span className="font-tabular text-[13.5px] font-semibold">
            {bandMedianHe(kpi, band)}
          </span>
        </div>
      ) : null}
      {research && research.approval_id ? (
        <Link
          href={`/approvals/${research.approval_id}`}
          className="mt-1 inline-flex items-center gap-1 text-[11px] font-medium text-primary underline-offset-2 hover:underline"
        >
          צפה במחקר המלא
          <ArrowLeft size={10} />
        </Link>
      ) : (richEstimate || band) && kpi ? (
        <div className="mt-1.5 flex flex-col gap-1.5">
          <div className="text-[10.5px] text-muted-foreground">
            {richEstimate
              ? `מודל סטטי — נסה מחקר חי לדיוק גבוה יותר`
              : band
                ? formatBandHe(kpi, band)
                : ""}
          </div>
          <ResearchBenchmarkButton
            currentResearchApprovalId={research?.approval_id ?? null}
          />
        </div>
      ) : null}
      {!hasTarget ? (
        <Link
          href="/business-knowledge"
          className="mt-1.5 inline-flex items-center gap-1 text-[11.5px] font-medium text-amber-700 underline-offset-2 hover:underline dark:text-amber-400"
        >
          הגדר יעד ב-העסק שלי
          <ArrowLeft size={11} />
        </Link>
      ) : null}
    </div>
  );
}

function KpiTile({
  label,
  value,
  hint,
  accent = false,
}: {
  label: string;
  value: string;
  hint?: string;
  accent?: boolean;
}) {
  return (
    <div className="glass-panel group relative overflow-hidden rounded-lg p-4 transition-transform hover:-translate-y-0.5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">
          {label}
        </span>
        {accent ? (
          <span
            className="h-1.5 w-1.5 rounded-full bg-brand-500 dark:bg-brand-400"
            aria-hidden
          />
        ) : null}
      </div>
      <div className="mt-2 font-tabular text-[26px] font-semibold leading-none tracking-[-0.02em]">
        {value}
      </div>
      {hint ? (
        <div className="mt-1.5 text-[11.5px] text-muted-foreground">{hint}</div>
      ) : null}
    </div>
  );
}

function EmptyBusinessState() {
  return (
    <div className="glass-surface rounded-lg p-10 text-center">
      <h2 className="text-h2">אין עסק פעיל ב-DB</h2>
      <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
        הרץ{" "}
        <code className="mono-ltr rounded bg-muted px-1.5 py-0.5 text-[12px]">
          bash scripts/bootstrap_local_db.sh
        </code>{" "}
        כדי להריץ migrations ולטעון seed.
      </p>
    </div>
  );
}

/**
 * SpendHero — the dashboard's hero block. One enormous number (the
 * month-to-date spend), one verdict, one utilization line. Inspired by
 * Mercury's financial dashboards: contrast + grid precision communicate
 * "control over complex metrics".
 *
 * The number plays a count-up animation on first paint — turning a static
 * value into a moment. If the agent hasn't recorded a pace decision yet,
 * we still render a quiet version using the configured monthly budget so
 * the hero never collapses.
 */
function SpendHero({
  business,
  budgetHealth,
  isLive,
  failReason,
}: {
  business: Business;
  budgetHealth: AgentDecision | null;
  /** True when `budgetHealth` was just synthesized from a live Meta fetch. */
  isLive: boolean;
  /** Reason the live fetch failed — drives reconnect CTA when token is dead. */
  failReason: "no_token" | "expired_token" | "meta_error" | null;
}) {
  const outputs = (budgetHealth?.outputs ?? {}) as {
    spend_this_month?: number;
    effective_monthly_budget?: number;
    pace?: number | null;
    status?: "ok" | "overrun" | "underrun" | "no_budget_set";
    fx?: {
      source_currency: string;
      native_amount: number;
      rate_used: number;
      rate_source: "live" | "cached" | "fallback" | "none";
    } | null;
  };
  // Staleness math drives the "מיושן · N ימים" badge. Only meaningful when
  // we fell back to the agent's row (live fetch failed); a fresh live snapshot
  // is by definition not stale.
  const decisionAgeDays = budgetHealth?.created_at
    ? Math.floor(
        (Date.now() - Date.parse(budgetHealth.created_at)) / 86_400_000,
      )
    : null;
  const showStaleBadge =
    !isLive && decisionAgeDays !== null && decisionAgeDays >= 1;
  const spend = Math.round(outputs.spend_this_month ?? 0);
  const budget =
    outputs.effective_monthly_budget ??
    (business.monthly_budget_ils ? Number(business.monthly_budget_ils) : 0);
  const pacePct =
    outputs.pace !== undefined && outputs.pace !== null
      ? Math.round(outputs.pace * 100)
      : null;
  const utilization =
    budget > 0 ? Math.min(100, Math.round((spend / budget) * 100)) : null;

  const status = outputs.status ?? (budget > 0 ? "ok" : "no_budget_set");
  const verdict =
    status === "overrun"
      ? { label: "חריגה בקצב", tone: "text-destructive" }
      : status === "underrun"
        ? { label: "תת-ניצול", tone: "text-warning" }
        : status === "no_budget_set"
          ? {
              label: "תקציב חודשי לא מוגדר",
              tone: "text-muted-foreground",
            }
          : { label: "בקצב", tone: "text-success" };

  // Decorative spend trend until per-day budget_health sampling lands. The
  // curve's average matches the actual MTD spend so the visual reads
  // consistent with the headline number even though individual points are
  // synthetic. See sparkline.tsx for the math.
  const trend = synthSpendTrend(spend, 30);

  return (
    <section className="relative overflow-hidden">
      <div className="grid grid-cols-1 items-end gap-x-10 gap-y-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <span className="page-eyebrow-rule text-[10.5px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
            הוצאה החודש
          </span>
          {isLive ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-emerald-300/60 bg-emerald-50/40 px-1.5 py-[1px] text-[9.5px] font-semibold uppercase tracking-wider text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-950/30 dark:text-emerald-300">
              <span className="h-1 w-1 rounded-full bg-emerald-500 dark:bg-emerald-400" aria-hidden />
              חי מ-Meta
            </span>
          ) : showStaleBadge ? (
            <span
              className="inline-flex items-center gap-1 rounded-full border border-amber-300/60 bg-amber-50/40 px-1.5 py-[1px] text-[9.5px] font-semibold uppercase tracking-wider text-amber-700 dark:border-amber-500/30 dark:bg-amber-950/30 dark:text-amber-300"
              title={
                failReason === "expired_token"
                  ? "הטוקן של Meta פג — לא הצלחנו לקרוא הוצאה חדשה"
                  : failReason === "no_token"
                    ? "לא מחובר ל-Meta — לא הצלחנו לקרוא הוצאה חדשה"
                    : failReason === "meta_error"
                      ? "Meta החזיר שגיאה — מוצג snapshot ישן"
                      : undefined
              }
            >
              מיושן · {decisionAgeDays} {decisionAgeDays === 1 ? "יום" : "ימים"}
            </span>
          ) : null}
        </div>
        <div
          className="font-tabular leading-[0.95] tracking-[-0.04em]"
          style={{ fontSize: "clamp(56px, 9vw, 96px)", fontWeight: 700 }}
        >
          <span className="text-muted-foreground/70">₪</span>
          <CountUp value={spend} className="text-foreground" />
        </div>
        <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-[14.5px]">
          <span className={`font-semibold ${verdict.tone}`}>
            {verdict.label}
          </span>
          {pacePct !== null ? (
            <span className="text-muted-foreground">
              ·{" "}
              <span className="font-tabular text-foreground">{pacePct}%</span>{" "}
              מהצפוי
            </span>
          ) : null}
          {budget > 0 ? (
            <span className="text-muted-foreground">
              · מתוך{" "}
              <span className="font-tabular text-foreground">
                ₪{budget.toLocaleString("he-IL")}
              </span>
            </span>
          ) : null}
        </div>

        {outputs.fx ? (
          <div className="mt-0.5 text-[11.5px] text-muted-foreground">
            מומר מ-
            <span className="font-tabular text-foreground">
              {outputs.fx.source_currency === "USD" ? "$" : ""}
              {Math.round(outputs.fx.native_amount).toLocaleString("en-US")}
              {outputs.fx.source_currency !== "USD"
                ? ` ${outputs.fx.source_currency}`
                : ""}
            </span>{" "}
            · שער{" "}
            <span className="font-tabular text-foreground">
              {outputs.fx.rate_used.toFixed(2)}
            </span>
            {outputs.fx.rate_source === "fallback" ? (
              <span
                className="ms-1 inline-flex items-center rounded border border-amber-300/60 bg-amber-50/40 px-1 py-[1px] text-[9.5px] font-semibold uppercase tracking-wider text-amber-700 dark:border-amber-500/30 dark:bg-amber-950/30 dark:text-amber-300"
                title="שער מטבע FX לא נטען מ-ECB — מוצג שער ברירת מחדל"
              >
                שער ברירת מחדל
              </span>
            ) : null}
          </div>
        ) : null}

        {utilization !== null ? (
          <div
            className="mt-6 h-1.5 w-full max-w-md overflow-hidden rounded-full bg-foreground/8 dark:bg-foreground/12"
            role="progressbar"
            aria-valuenow={utilization}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="ניצול תקציב חודשי"
          >
            <div
              className={`h-full rounded-full transition-[width] duration-[1100ms] ease-out ${
                status === "overrun"
                  ? "bg-destructive shadow-[0_0_18px_hsl(0_72%_51%/0.45)]"
                  : status === "underrun"
                    ? "bg-warning shadow-[0_0_18px_hsl(38_92%_48%/0.45)]"
                    : "bg-gradient-to-r from-brand-500 to-brand-600 shadow-[0_0_18px_hsl(28_91%_54%/0.45)]"
              }`}
              style={{ width: `${utilization}%` }}
            />
          </div>
        ) : null}
        </div>
        {/* Right column — decorative spend trend. Hidden on small screens
            where the headline number is already the visual anchor. */}
        {spend > 0 ? (
          <div className="hidden h-[180px] lg:block">
            <Sparkline data={trend} height={180} />
          </div>
        ) : null}
      </div>
    </section>
  );
}

function ApprovalsInbox({
  preview,
  total,
  remainder,
}: {
  preview: Approval[];
  total: number;
  remainder: number;
}) {
  if (total === 0) {
    return (
      <section>
        <div className="glass-surface flex items-center justify-between gap-4 rounded-lg p-5">
          <div className="flex items-center gap-3">
            <PulseDot tone="idle" />
            <div className="flex flex-col">
              <span className="text-[15px] font-semibold">התור ריק</span>
              <span className="text-[13px] text-muted-foreground">
                אין הצעות פתוחות. הסוכן יציע משימות חדשות בסריקה הבאה.
              </span>
            </div>
          </div>
          <Link
            href="/approvals"
            className="inline-flex items-center gap-1 text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            כל ההצעות
            <ArrowLeft size={14} />
          </Link>
        </div>
      </section>
    );
  }

  return (
    <section>
      <SectionHeader
        title={
          <span className="inline-flex items-center gap-2">
            משימות ממתינות לאישור
            <span className="font-tabular inline-flex h-[22px] min-w-[22px] items-center justify-center rounded-full bg-brand-500/15 px-1.5 text-[11.5px] font-semibold text-brand-500 ring-1 ring-brand-500/30 dark:text-brand-400">
              {total}
            </span>
          </span>
        }
        description="ממוין לפי דחיפות. פתח שורה לנימוק מלא, השפעה צפויה, ולאישור/דחייה."
        action={
          <Link href="/approvals">
            <Button variant="outline" size="sm" className="gap-1">
              כל ההצעות
              <ArrowLeft size={14} />
            </Button>
          </Link>
        }
      />
      <ul className="glass-surface overflow-hidden rounded-lg">
        {preview.map((a, i) => {
          const hrReason = requiresHumanReview(a);
          // Urgency-keyed vertical stripe — replaces the inline badge. The
          // glow on urgent/high turns the stripe into a quiet attention
          // affordance instead of a loud chip; sufficient color contrast
          // for sighted users + aria-label for screen readers.
          const stripeCls =
            a.urgency === "urgent"
              ? "bg-destructive shadow-[0_0_12px_hsl(0_72%_51%/0.55)]"
              : a.urgency === "high"
                ? "bg-brand-500 shadow-[0_0_10px_hsl(28_91%_54%/0.5)] dark:bg-brand-400"
                : a.urgency === "medium"
                  ? "bg-warning shadow-[0_0_8px_hsl(38_92%_48%/0.4)]"
                  : "bg-muted-foreground/50";
          return (
            <li key={a.id} className={i > 0 ? "border-t border-border/60" : ""}>
              <Link
                href={`/approvals/${a.id}`}
                className="group grid grid-cols-[4px_minmax(0,1fr)_auto] items-center gap-4 px-5 py-[18px] transition-colors hover:bg-foreground/[0.03]"
              >
                {/* Urgency stripe — vertical bar at row start (right in RTL).
                    Self-stretches to row height for the full-bleed look. */}
                <span
                  className={`h-9 w-1 self-center rounded-full ${stripeCls}`}
                  aria-label={URGENCY_LABEL_HE[a.urgency]}
                />
                <div className="min-w-0">
                  <div className="text-[14.5px] font-semibold leading-tight">
                    {taskTypeLabel(a.task_type)}
                  </div>
                  <p className="mt-1 line-clamp-1 text-[12.5px] leading-relaxed text-muted-foreground">
                    {truncate(a.rationale, 180)}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  {hrReason ? (
                    <span className="inline-flex items-center rounded-full bg-warning/15 px-2 py-[2px] text-[10.5px] font-semibold text-warning ring-1 ring-warning/30">
                      דורש בדיקה
                    </span>
                  ) : null}
                  <span className="font-tabular text-[11.5px] text-muted-foreground">
                    {relativeHe(a.created_at)}
                  </span>
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
      {remainder > 0 ? (
        <div className="mt-3 text-center">
          <Link
            href="/approvals"
            className="text-[13px] text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            ועוד {remainder} ממתינות
          </Link>
        </div>
      ) : null}
    </section>
  );
}
