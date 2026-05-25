import type { AgentDecision } from "@/lib/db/types";

/**
 * Run summary extraction — pure, no I/O. Takes the full
 * `agent_decisions` trail for a single run and reduces it to the
 * shape the home-page card + /runs index render. Lives outside
 * components so both surfaces and tests share one source of truth
 * for "what counts as the run's headline."
 *
 * Per `docs/todos/surface-runs-detail.md`: the data is already there,
 * the gap is discoverability. This helper picks out the gates and
 * top finding so the operator never has to load the full trail to
 * know whether a scan was interesting.
 */

export type BudgetStatus = "ok" | "overrun" | "underrun" | "no_budget_set";
export type TrackingStatus = "healthy" | "partial" | "unverified" | "unknown";
export type AccountBand = "healthy" | "watch" | "critical";

export type CampaignLane =
  | "scale_up_candidate"
  | "scale_down_candidate"
  | "creative_pool_exhausted"
  | "pool_misalignment"
  | "routine_observation"
  | "hands_off";

export interface CampaignRoute {
  campaignId: string;
  lane: CampaignLane | string;
  summary: string;
}

export interface BlockedFinding {
  /** Decision id, for keying + linking back to the underlying row. */
  decisionId: string;
  /** Hebrew one-line summary (the agent's summary on the decision row). */
  summary: string;
  /** When the finding was logged. */
  createdAt: string;
  /** `outputs.finding_type` — e.g. "objective_mismatch", "staged_scale_up". */
  findingType: string | null;
  /** Capability requirement names that block the action. */
  blockedBy: string[];
  /** Campaign scope if present. */
  campaignId: string | null;
}

export interface RunHighlights {
  /** From the latest `budget_health` observation in the run. */
  budgetStatus: BudgetStatus | null;
  budgetPace: number | null;
  /** From the latest `tracking_health` observation in the run. */
  trackingStatus: TrackingStatus | null;
  /** From the latest `account_health` observation. */
  accountBand: AccountBand | null;
  /** Per-campaign lane assignments from `route` diagnoses. */
  routes: CampaignRoute[];
  /** Counts by decision_type, for quick badges. */
  proposalCount: number;
  skipCount: number;
  rejectionCount: number;
  errorCount: number;
  observationCount: number;
  /**
   * Count of `observation_blocked` rows — findings the agent surfaced but
   * couldn't act on because a capability is gated. Migration 033 (2026-05-25).
   * Drives the "ready when you unblock me" UI affordance.
   */
  observationBlockedCount: number;
  diagnosisCount: number;
  /** True when at least one row was an `error`. */
  hasErrors: boolean;
  /** Distinct campaigns the run touched. */
  campaignsTouched: number;
  /** Up to 5 most recent `observation_blocked` rows (for cards/lists). */
  blockedFindings: BlockedFinding[];
  /**
   * One-line "top finding" — the most operator-worthy single observation
   * the run produced. Picked from (in order): first error, first scale_up
   * candidate, first scale_down candidate, first proposal, first
   * observation_blocked, first route-diagnosis summary. Returns null when
   * the run had nothing notable beyond routine observations.
   */
  topFinding: { kind: "error" | "scale_up" | "scale_down" | "pool" | "proposal" | "blocked" | "route"; text: string } | null;
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null;

function pickLatest(
  decisions: AgentDecision[],
  match: (d: AgentDecision) => boolean,
): AgentDecision | null {
  let chosen: AgentDecision | null = null;
  for (const d of decisions) {
    if (!match(d)) continue;
    if (!chosen || Date.parse(d.created_at) > Date.parse(chosen.created_at)) {
      chosen = d;
    }
  }
  return chosen;
}

export function summarizeRun(decisions: AgentDecision[]): RunHighlights {
  const budgetD = pickLatest(
    decisions,
    (d) => d.node_name === "budget_health" && d.decision_type === "observation",
  );
  const trackingD = pickLatest(
    decisions,
    (d) =>
      d.node_name === "tracking_health" && d.decision_type === "observation",
  );
  const accountD = pickLatest(
    decisions,
    (d) =>
      d.node_name === "account_health" && d.decision_type === "observation",
  );

  const budgetOutputs = isObj(budgetD?.outputs) ? budgetD!.outputs : {};
  const trackingOutputs = isObj(trackingD?.outputs) ? trackingD!.outputs : {};
  const accountOutputs = isObj(accountD?.outputs) ? accountD!.outputs : {};

  const budgetStatus =
    typeof budgetOutputs.status === "string"
      ? (budgetOutputs.status as BudgetStatus)
      : null;
  const budgetPace =
    typeof budgetOutputs.pace === "number" ? (budgetOutputs.pace as number) : null;
  const trackingStatus =
    typeof trackingOutputs.status === "string"
      ? (trackingOutputs.status as TrackingStatus)
      : null;
  const accountBand =
    typeof accountOutputs.health_band === "string"
      ? (accountOutputs.health_band as AccountBand)
      : null;

  // Per-campaign route lanes — one row per campaign × `route` diagnosis.
  // Order preserved (the trail is already chronological).
  const seenCampaigns = new Set<string>();
  const routes: CampaignRoute[] = [];
  for (const d of decisions) {
    if (d.decision_type !== "diagnosis" || d.node_name !== "route") continue;
    if (!d.campaign_id || seenCampaigns.has(d.campaign_id)) continue;
    const outs = isObj(d.outputs) ? d.outputs : {};
    const lane = typeof outs.lane === "string" ? outs.lane : "routine_observation";
    seenCampaigns.add(d.campaign_id);
    routes.push({
      campaignId: d.campaign_id,
      lane,
      summary: d.summary,
    });
  }

  let proposalCount = 0;
  let skipCount = 0;
  let rejectionCount = 0;
  let errorCount = 0;
  let observationCount = 0;
  let observationBlockedCount = 0;
  let diagnosisCount = 0;
  for (const d of decisions) {
    switch (d.decision_type) {
      case "proposal":
        proposalCount++;
        break;
      case "skip":
        skipCount++;
        break;
      case "rejection":
        rejectionCount++;
        break;
      case "error":
        errorCount++;
        break;
      case "observation":
        observationCount++;
        break;
      case "observation_blocked":
        observationBlockedCount++;
        break;
      case "diagnosis":
        diagnosisCount++;
        break;
    }
  }

  // Collect up to 5 most-recent observation_blocked rows for surfaces that
  // want to render "blocked findings" inline (home card, /approvals section).
  const blockedFindings: BlockedFinding[] = [];
  for (const d of [...decisions].reverse()) {
    if (d.decision_type !== "observation_blocked") continue;
    const outs = isObj(d.outputs) ? d.outputs : {};
    const blockedByRaw = outs.blocked_by;
    const blockedBy =
      Array.isArray(blockedByRaw) && blockedByRaw.every((x) => typeof x === "string")
        ? (blockedByRaw as string[])
        : [];
    const findingType =
      typeof outs.finding_type === "string" ? (outs.finding_type as string) : null;
    blockedFindings.push({
      decisionId: d.id,
      summary: d.summary,
      createdAt: d.created_at,
      findingType,
      blockedBy,
      campaignId: d.campaign_id ?? null,
    });
    if (blockedFindings.length >= 5) break;
  }
  const campaignsTouched = new Set(
    decisions.map((d) => d.campaign_id).filter((c): c is string => !!c),
  ).size;

  // Pick the top finding — first match wins. Errors take precedence
  // because the operator must see them; otherwise prefer signals that
  // imply action over routine observation. observation_blocked rows sit
  // above generic routine routes because they represent "agent has
  // something to act on, gated on unblock" — the operator wants to know.
  let topFinding: RunHighlights["topFinding"] = null;
  const firstError = decisions.find((d) => d.decision_type === "error");
  if (firstError) {
    topFinding = { kind: "error", text: firstError.summary };
  } else {
    const scaleUp = routes.find((r) => r.lane === "scale_up_candidate");
    const scaleDown = routes.find((r) => r.lane === "scale_down_candidate");
    const pool = routes.find(
      (r) => r.lane === "creative_pool_exhausted" || r.lane === "pool_misalignment",
    );
    const firstProposal = decisions.find((d) => d.decision_type === "proposal");
    const firstRoute = routes.find((r) => r.lane !== "routine_observation" && r.lane !== "hands_off");
    if (scaleUp) {
      topFinding = { kind: "scale_up", text: scaleUp.summary };
    } else if (scaleDown) {
      topFinding = { kind: "scale_down", text: scaleDown.summary };
    } else if (pool) {
      topFinding = { kind: "pool", text: pool.summary };
    } else if (firstProposal) {
      topFinding = { kind: "proposal", text: firstProposal.summary };
    } else if (blockedFindings.length > 0) {
      topFinding = { kind: "blocked", text: blockedFindings[0].summary };
    } else if (firstRoute) {
      topFinding = { kind: "route", text: firstRoute.summary };
    }
  }

  return {
    budgetStatus,
    budgetPace,
    trackingStatus,
    accountBand,
    routes,
    proposalCount,
    skipCount,
    rejectionCount,
    errorCount,
    observationCount,
    observationBlockedCount,
    diagnosisCount,
    hasErrors: errorCount > 0,
    campaignsTouched,
    blockedFindings,
    topFinding,
  };
}

// ---- Hebrew display helpers ------------------------------------------------

export const BUDGET_LABEL_HE: Record<BudgetStatus, string> = {
  ok: "תקציב בקצב",
  overrun: "חריגה בקצב",
  underrun: "תת-ניצול",
  no_budget_set: "תקציב לא הוגדר",
};

export const TRACKING_LABEL_HE: Record<TrackingStatus, string> = {
  healthy: "מעקב תקין",
  partial: "מעקב חלקי",
  unverified: "מעקב לא מאומת",
  unknown: "מעקב לא ידוע",
};

export const ACCOUNT_LABEL_HE: Record<AccountBand, string> = {
  healthy: "חשבון תקין",
  watch: "חשבון במעקב",
  critical: "חשבון קריטי",
};

export const LANE_LABEL_HE: Record<CampaignLane, string> = {
  scale_up_candidate: "מועמד להגדלה",
  scale_down_candidate: "מועמד להקטנה",
  creative_pool_exhausted: "פול קריאייטיב מוצה",
  pool_misalignment: "אי-התאמה",
  routine_observation: "מעקב שגרתי",
  hands_off: "אל תיגע",
};

export type Tone = "good" | "warn" | "bad" | "neutral";

export function budgetTone(status: BudgetStatus | null): Tone {
  if (status === "ok") return "good";
  if (status === "overrun") return "bad";
  if (status === "underrun") return "warn";
  if (status === "no_budget_set") return "warn";
  return "neutral";
}

export function trackingTone(status: TrackingStatus | null): Tone {
  if (status === "healthy") return "good";
  if (status === "partial") return "warn";
  if (status === "unverified") return "bad";
  return "neutral";
}

export function accountTone(band: AccountBand | null): Tone {
  if (band === "healthy") return "good";
  if (band === "watch") return "warn";
  if (band === "critical") return "bad";
  return "neutral";
}

export function laneTone(lane: CampaignLane | string): Tone {
  if (lane === "scale_up_candidate") return "good";
  if (lane === "scale_down_candidate") return "warn";
  if (lane === "creative_pool_exhausted" || lane === "pool_misalignment")
    return "warn";
  if (lane === "hands_off") return "bad";
  return "neutral";
}

export const TONE_CHIP_CLASS: Record<Tone, string> = {
  good: "bg-emerald-500/15 text-emerald-700 ring-1 ring-emerald-500/30 dark:text-emerald-300",
  warn: "bg-amber-500/15 text-amber-700 ring-1 ring-amber-500/30 dark:text-amber-300",
  bad: "bg-red-500/15 text-red-700 ring-1 ring-red-500/30 dark:text-red-300",
  neutral:
    "bg-muted text-muted-foreground ring-1 ring-border",
};

// ---- Debug-page helpers ----------------------------------------------------
// Used by /runs/[run_id] when DEBUG=true. See `docs/plans/debug-runs-page.md`.

export type RunShape = "empty" | "blocked" | "rejected" | "productive" | "errored";

export interface RunNarrative {
  shape: RunShape;
  observations: number;
  /** observation_blocked + rejection + proposal — things the agent saw as actionable. */
  wouldPropose: number;
  blocked: number;
  rejected: number;
  proposals: number;
  skips: number;
  errors: number;
  /** Single Hebrew sentence framing the run's outcome. */
  sentence: string;
}

/**
 * Pure: classify a run by shape and build a one-line Hebrew TL;DR. The
 * shape drives which framing wins — errors first, then productive, then
 * blocked, then rejected, then empty. The sentence avoids restating
 * counts already visible as chips above it.
 */
export function buildRunNarrative(decisions: AgentDecision[]): RunNarrative {
  let observations = 0;
  let blocked = 0;
  let rejected = 0;
  let proposals = 0;
  let skips = 0;
  let errors = 0;
  for (const d of decisions) {
    switch (d.decision_type) {
      case "observation":
        observations++;
        break;
      case "observation_blocked":
        blocked++;
        break;
      case "rejection":
        rejected++;
        break;
      case "proposal":
        proposals++;
        break;
      case "skip":
        skips++;
        break;
      case "error":
        errors++;
        break;
    }
  }
  const wouldPropose = blocked + rejected + proposals;

  let shape: RunShape;
  let sentence: string;
  if (errors > 0) {
    shape = "errored";
    sentence = `הריצה נתקלה ב־${errors} שגיאות. בדוק את הקטע "שגיאות" למטה.`;
  } else if (proposals > 0) {
    shape = "productive";
    const extras: string[] = [];
    if (blocked > 0) extras.push(`${blocked} ממצאים חסומים`);
    if (rejected > 0) extras.push(`${rejected} הצעות נדחו על־ידי guardrails`);
    sentence =
      `הסוכן יצר ${proposals} הצעות חדשות שמחכות לאישור.` +
      (extras.length ? ` בנוסף: ${extras.join(", ")}.` : "");
  } else if (blocked > 0) {
    shape = "blocked";
    sentence =
      `הסוכן זיהה ${wouldPropose} ממצאים בני־פעולה — ${blocked} מהם חסומים על־ידי דרישות יכולת ` +
      `(למשל מעקב לא מאומת, יעד KPI לא מוגדר), ולכן לא נשלחו הצעות. פתיחה של היכולות תאפשר ביצוע.`;
  } else if (rejected > 0) {
    shape = "rejected";
    sentence = `הסוכן הכין ${wouldPropose} הצעות, אך ${rejected} נדחו על־ידי guardrails לפני שהגיעו לתור.`;
  } else {
    shape = "empty";
    sentence =
      observations > 0
        ? `הסוכן צפה ב־${observations} תצפיות. לא זוהו ממצאים שדורשים פעולה.`
        : "לריצה אין תצפיות מתועדות.";
  }

  return {
    shape,
    observations,
    wouldPropose,
    blocked,
    rejected,
    proposals,
    skips,
    errors,
    sentence,
  };
}

export interface GroupedDecisions {
  blockedFindings: AgentDecision[];
  rejections: AgentDecision[];
  skips: AgentDecision[];
  proposals: AgentDecision[];
  errors: AgentDecision[];
}

/**
 * Pure: split the decision trail into the five buckets the debug page
 * renders as accordions. Order within each bucket is the input order
 * (chronological, ascending).
 */
export function groupDecisions(decisions: AgentDecision[]): GroupedDecisions {
  const g: GroupedDecisions = {
    blockedFindings: [],
    rejections: [],
    skips: [],
    proposals: [],
    errors: [],
  };
  for (const d of decisions) {
    switch (d.decision_type) {
      case "observation_blocked":
        g.blockedFindings.push(d);
        break;
      case "rejection":
        g.rejections.push(d);
        break;
      case "skip":
        g.skips.push(d);
        break;
      case "proposal":
        g.proposals.push(d);
        break;
      case "error":
        g.errors.push(d);
        break;
    }
  }
  return g;
}

export const SHAPE_LABEL_HE: Record<RunShape, string> = {
  empty: "ריצה ריקה",
  blocked: "ממצאים חסומים",
  rejected: "נדחה ע״י guardrails",
  productive: "הצעות נוצרו",
  errored: "שגיאות בריצה",
};

export function shapeTone(shape: RunShape): Tone {
  if (shape === "productive") return "good";
  if (shape === "blocked" || shape === "rejected") return "warn";
  if (shape === "errored") return "bad";
  return "neutral";
}
