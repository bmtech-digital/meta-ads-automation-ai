import type { AgentDecision, DecisionType } from "@/lib/db/types";

/**
 * Pure helpers that turn the raw `agent_decisions` trail of a single run
 * into a friendly, per-campaign Hebrew narrative. No JSX, no I/O. Powers
 * `web/src/components/run-story.tsx`.
 *
 * The translation tables here are deliberately *generous*: every machine
 * identifier the agent might log (`node_name`, `finding_type`, lane
 * codes, guardrail codes, capability requirements) gets a Hebrew phrase
 * a non-technical operator can read. When a code isn't in the table we
 * fall back to a soft default ("בדיקה כללית") instead of leaking the
 * raw identifier into the UI.
 */

// ---- Per-campaign grouping -------------------------------------------------

export interface StoryStep {
  /** Original decision row — passed through for time + ids + raw access. */
  d: AgentDecision;
  /** Friendly headline for this step (one short Hebrew sentence). */
  headline: string;
  /** Optional secondary line — the agent's own `rationale`, displayed verbatim. */
  body: string | null;
  /** "What it would have done" — set on observation_blocked when present. */
  wouldDo: string | null;
  /** Friendly capability-block reasons (Hebrew labels). */
  blockedBy: string[];
  /** Friendly guardrail reasons (Hebrew labels). */
  guardrailReasons: string[];
  /** Visual mood — drives the dot color in the timeline. */
  tone: "neutral" | "good" | "warn" | "bad" | "info";
  /** A small leading glyph. Plain text glyphs only — no logos. */
  glyph: string;
}

export interface StoryGroup {
  /** `null` = the "run-level" bucket: decisions with no campaign_id. */
  campaignId: string | null;
  /** Friendly header shown above the timeline. */
  title: string;
  /** Optional subtitle — e.g. "3 שלבים · החלטה אחת ממתינה לאישור". */
  subtitle: string;
  steps: StoryStep[];
  /** Has at least one error in this group? Used to flag it visually. */
  hasError: boolean;
  /** Did the agent end up proposing something for this campaign? */
  producedProposal: boolean;
  /** Was the agent ready to propose but blocked? */
  hasBlocked: boolean;
}

export interface RunStoryData {
  groups: StoryGroup[];
  /** One-paragraph Hebrew summary of the whole run, for the page header. */
  intro: string;
}

export function buildRunStory(decisions: AgentDecision[]): RunStoryData {
  // Group by campaign_id. Decisions without a campaign go into the
  // "general" bucket which renders first when present (it tends to
  // describe account-wide observations like tracking + budget health).
  const buckets = new Map<string | null, AgentDecision[]>();
  for (const d of decisions) {
    const key = d.campaign_id ?? null;
    const arr = buckets.get(key);
    if (arr) arr.push(d);
    else buckets.set(key, [d]);
  }

  const groups: StoryGroup[] = [];
  // Stable order: general bucket first, then campaigns in order of first appearance.
  const orderedKeys: (string | null)[] = [];
  if (buckets.has(null)) orderedKeys.push(null);
  for (const d of decisions) {
    if (d.campaign_id && !orderedKeys.includes(d.campaign_id)) {
      orderedKeys.push(d.campaign_id);
    }
  }

  for (const key of orderedKeys) {
    const rows = buckets.get(key) ?? [];
    rows.sort(
      (a, b) => Date.parse(a.created_at) - Date.parse(b.created_at),
    );
    const steps = rows.map(buildStep);
    const proposalCount = steps.filter(
      (s) => s.d.decision_type === "proposal",
    ).length;
    const blockedCount = steps.filter(
      (s) => s.d.decision_type === "observation_blocked",
    ).length;
    const rejectionCount = steps.filter(
      (s) => s.d.decision_type === "rejection",
    ).length;
    const errorCount = steps.filter(
      (s) => s.d.decision_type === "error",
    ).length;
    const skipCount = steps.filter(
      (s) => s.d.decision_type === "skip",
    ).length;
    const parts: string[] = [`${steps.length} שלבים`];
    if (proposalCount > 0) parts.push(`${proposalCount} הצעות לאישור`);
    if (blockedCount > 0) parts.push(`${blockedCount} ממצאים חסומים`);
    if (rejectionCount > 0) parts.push(`${rejectionCount} הצעות נדחו`);
    if (skipCount > 0 && proposalCount === 0 && blockedCount === 0)
      parts.push(`${skipCount} דילוגים`);
    if (errorCount > 0) parts.push(`${errorCount} שגיאות`);

    groups.push({
      campaignId: key,
      title: titleFor(key),
      subtitle: parts.join(" · "),
      steps,
      hasError: errorCount > 0,
      producedProposal: proposalCount > 0,
      hasBlocked: blockedCount > 0,
    });
  }

  const intro = buildIntro(decisions, groups);
  return { groups, intro };
}

// ---- Step construction ----------------------------------------------------

function buildStep(d: AgentDecision): StoryStep {
  const headline = friendlyHeadline(d);
  const body = d.rationale?.trim() || null;
  const wouldDo = extractWouldDo(d);
  const blockedBy = extractBlockedBy(d).map(friendlyRequirement);
  const guardrailReasons = (d.guardrail_violations ?? []).map(
    friendlyGuardrail,
  );
  const { tone, glyph } = visualsFor(d);
  return {
    d,
    headline,
    body,
    wouldDo,
    blockedBy,
    guardrailReasons,
    tone,
    glyph,
  };
}

function friendlyHeadline(d: AgentDecision): string {
  // We never echo the raw `summary` if we can build a richer sentence from
  // `node_name` + `decision_type`. But the agent's own summary is usually
  // already Hebrew-friendly, so when we don't have a stronger template we
  // pass it through.
  const what = friendlyNode(d.node_name);
  switch (d.decision_type) {
    case "observation":
      return d.summary
        ? `${what} — ${d.summary}`
        : `${what}: הסוכן בדק את המצב.`;
    case "observation_blocked":
      return d.summary
        ? `הסוכן זיהה הזדמנות (${d.summary}) אך לא יכול היה לפעול עליה כרגע.`
        : `הסוכן זיהה הזדמנות אך לא יכול היה לפעול עליה כרגע.`;
    case "diagnosis":
      return d.summary
        ? `הסוכן הסיק: ${d.summary}`
        : `הסוכן הסיק מסקנה על המצב.`;
    case "proposal":
      return d.summary
        ? `הסוכן הציע: ${d.summary} (ממתין לאישורך).`
        : `הסוכן הכין הצעה לאישורך.`;
    case "rejection":
      return d.summary
        ? `הסוכן הכין הצעה (${d.summary}) אבל בדיקת בטיחות חסמה אותה.`
        : `הסוכן הכין הצעה אבל בדיקת בטיחות חסמה אותה.`;
    case "skip":
      return d.summary
        ? `הסוכן בחר לא לגעת — ${d.summary}.`
        : `הסוכן בחר לא לגעת בסיבוב הזה.`;
    case "execution":
      return d.summary
        ? `הסוכן ביצע: ${d.summary}.`
        : `הסוכן ביצע פעולה לאחר אישור.`;
    case "error":
      return d.summary
        ? `אירעה תקלה בשלב "${what}": ${d.summary}.`
        : `אירעה תקלה בשלב "${what}".`;
  }
}

function visualsFor(d: AgentDecision): {
  tone: StoryStep["tone"];
  glyph: string;
} {
  switch (d.decision_type) {
    case "observation":
      return { tone: "info", glyph: "👀" };
    case "observation_blocked":
      return { tone: "warn", glyph: "🛑" };
    case "diagnosis":
      return { tone: "info", glyph: "💡" };
    case "proposal":
      return { tone: "good", glyph: "✨" };
    case "rejection":
      return { tone: "warn", glyph: "🛡" };
    case "skip":
      return { tone: "neutral", glyph: "⏭" };
    case "execution":
      return { tone: "good", glyph: "✅" };
    case "error":
      return { tone: "bad", glyph: "⚠" };
  }
}

function extractWouldDo(d: AgentDecision): string | null {
  if (d.decision_type !== "observation_blocked") return null;
  const outs = isObj(d.outputs) ? d.outputs : null;
  if (!outs) return null;
  const wp = isObj(outs.would_propose) ? outs.would_propose : null;
  if (!wp) return null;
  const summary =
    typeof wp.summary === "string" && wp.summary.trim()
      ? wp.summary.trim()
      : null;
  if (summary) return summary;
  const taskType =
    typeof wp.task_type === "string" && wp.task_type.trim()
      ? wp.task_type.trim()
      : null;
  if (taskType) return friendlyTaskType(taskType);
  return null;
}

function extractBlockedBy(d: AgentDecision): string[] {
  const outs = isObj(d.outputs) ? d.outputs : null;
  if (!outs) return [];
  const raw = outs.blocked_by;
  if (!Array.isArray(raw)) return [];
  return raw.filter((x): x is string => typeof x === "string");
}

// ---- Friendly labels ------------------------------------------------------

const NODE_LABEL_HE: Record<string, string> = {
  budget_health: "מצב התקציב",
  tracking_health: "מצב המעקב (Pixel/CAPI)",
  account_health: "מצב חשבון המודעות",
  fetch_meta_state: "שליפת המצב הנוכחי מ-Meta",
  state_hash: "השוואה למצב אתמול",
  state_unchanged: "המצב לא השתנה",
  route: "ניתוח כיוון לקמפיין",
  portfolio_rebalance: "איזון תקציבים בין קמפיינים",
  competitive_research: "מחקר תחרותי",
  weekly_digest: "דוח שבועי",
};

export function friendlyNode(node: string): string {
  return NODE_LABEL_HE[node] ?? "בדיקה כללית";
}

// Common "would_propose.task_type" values — kept terse so they read in a sentence.
const TASK_TYPE_LABEL_HE: Record<string, string> = {
  scale_up_budget: "להגדיל את התקציב",
  scale_down_budget: "להקטין את התקציב",
  refresh_creative: "לרענן את הקריאייטיב",
  pause_underperformer: "להשהות מבצע חלש",
  duplicate_winner: "לשכפל מבצע מנצח",
  switch_objective: "להחליף את מטרת הקמפיין",
  expand_audience: "להרחיב את הקהל",
  narrow_audience: "לצמצם את הקהל",
  alert: "להזעיק התראה לאופרטור",
};

export function friendlyTaskType(t: string): string {
  return TASK_TYPE_LABEL_HE[t] ?? t.replace(/_/g, " ");
}

// Capability requirement names → Hebrew (also used in run-decision-groups.tsx).
const REQUIREMENT_LABEL_HE: Record<string, string> = {
  tracking_verified: "מעקב Pixel/CAPI מאומת",
  primary_kpi_set: "KPI ראשי מוגדר",
  target_value_set: "ערך יעד ל-KPI הוגדר",
  not_in_learning: "הקמפיין יצא משלב הלימוד",
  utilization_7d_at_least_50: "ניצול תקציב ≥50% ב-7 ימים",
  cpa_above_target: "CPA מעל היעד",
  research_sources_at_least_2: "לפחות 2 מקורות מחקר",
  matched_terms_present: "מונחים תואמים נמצאו",
  test_age_at_least_7d: "ניסוי בן 7 ימים לפחות",
};

export function friendlyRequirement(r: string): string {
  return REQUIREMENT_LABEL_HE[r] ?? r.replace(/_/g, " ");
}

// Guardrail codes — short, action-oriented Hebrew. The agent's library
// is in `campaigner/prompts/guardrails.md`; keep new codes in sync.
const GUARDRAIL_LABEL_HE: Record<string, string> = {
  budget_change_too_large: "שינוי התקציב גדול מדי לסיבוב יחיד",
  budget_change_min_floor: "שינוי התקציב קטן מהמינימום שמותר",
  campaign_in_learning: "הקמפיין עדיין בשלב לימוד",
  hands_off_lane: "הקמפיין סומן כ\"אל תיגע\"",
  missing_tracking: "אין נתוני מעקב מספקים",
  duplicate_proposal: "כבר קיימת הצעה דומה שממתינה לאישור",
  insufficient_research_sources: "אין מספיק מקורות מחקר",
  hebrew_required: "הטקסט חייב להיות בעברית",
  frequency_high_legacy: "תדירות גבוהה (כלל ישן)",
};

export function friendlyGuardrail(code: string): string {
  return GUARDRAIL_LABEL_HE[code] ?? code.replace(/_/g, " ");
}

// ---- Group titles ---------------------------------------------------------

function titleFor(campaignId: string | null): string {
  if (campaignId === null) return "תצפיות ברמת החשבון";
  // Campaign IDs from Meta look like "120211234567890123". We keep the
  // raw id visible — operators recognize their own ones — but frame it
  // in Hebrew prose. A future enhancement could resolve names from the
  // `campaigns` table.
  return `קמפיין ${campaignId}`;
}

// ---- Intro paragraph ------------------------------------------------------

function buildIntro(
  decisions: AgentDecision[],
  groups: StoryGroup[],
): string {
  if (decisions.length === 0) return "לא נרשמו צעדים בריצה הזו.";

  const counts = countsByType(decisions);
  const campaignCount = groups.filter((g) => g.campaignId !== null).length;

  const errorN = counts.error ?? 0;
  const proposalN = counts.proposal ?? 0;
  const blockedN = counts.observation_blocked ?? 0;
  const rejectionN = counts.rejection ?? 0;
  const skipN = counts.skip ?? 0;

  if (errorN > 0) {
    return `הריצה כללה ${errorN} שגיאות. ראה למטה — כל שגיאה מסומנת באדום בתוך השלב הרלוונטי.`;
  }

  if (proposalN > 0) {
    const extras: string[] = [];
    if (blockedN > 0)
      extras.push(`${blockedN} הזדמנויות שמחכות שתפתח להן את הדלת`);
    if (rejectionN > 0)
      extras.push(`${rejectionN} הצעות שנפלו על בדיקת בטיחות`);
    return (
      `הסוכן עבר על ${campaignCount > 0 ? `${campaignCount} קמפיינים` : "החשבון"} ` +
      `והפיק ${proposalN} הצעות חדשות הממתינות לאישורך.` +
      (extras.length ? ` בנוסף: ${extras.join(", ")}.` : "")
    );
  }

  if (blockedN > 0) {
    return (
      `הסוכן זיהה ${blockedN} הזדמנויות לפעולה, אבל עוד אין לו את כל מה שצריך כדי לפעול ` +
      `(למשל מעקב לא מאומת או יעד KPI חסר). ברגע שתפתח את הדרישות החסרות — הוא יציע אותן בריצה הבאה.`
    );
  }

  if (rejectionN > 0) {
    return `הסוכן הכין הצעות אבל ${rejectionN} מהן נפלו על בדיקות בטיחות לפני שהגיעו לתור. בדוק את הפירוט למטה.`;
  }

  if (skipN > 0 && proposalN === 0) {
    return `הסוכן עבר על הקמפיינים ובחר לא לגעת באף אחד הפעם. הסיבות מפורטות בתוך כל קמפיין.`;
  }

  return "הסוכן צפה בחשבון. לא נמצאו ממצאים שדורשים פעולה כרגע.";
}

function countsByType(
  decisions: AgentDecision[],
): Partial<Record<DecisionType, number>> {
  const out: Partial<Record<DecisionType, number>> = {};
  for (const d of decisions) {
    out[d.decision_type] = (out[d.decision_type] ?? 0) + 1;
  }
  return out;
}

// ---- Local helpers --------------------------------------------------------

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}
