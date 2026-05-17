import "server-only";
import { effectiveMonthlyBudget } from "./seasonal";
import { convertToIls } from "./fx";
import { getAdAccountSpendThisMonth, MetaGraphError } from "./meta-graph";
import {
  getTokenForBusiness,
  MetaConnectionExpired,
  MetaConnectionRequired,
} from "./meta-tokens";
import type { AgentDecision, Business, DataClient } from "./db/types";

/**
 * Live-spend resolver — the dashboard's escape hatch from the agent-only data
 * path.
 *
 * The Python `compute_monthly_pace.py` tool writes a `budget_health` row once
 * per agent run (~daily). When the runner is silent for a day, the dashboard's
 * hero block was showing a stale number. This module pulls fresh spend from
 * Meta on every page load, recomputes pace/status in JS, and persists a new
 * snapshot via `recordBudgetHealthSnapshot` so the BudgetHealthCard below also
 * picks up the live figure without waiting on the agent.
 *
 * One Meta call (`getAdAccountSpendThisMonth`). Projection uses linear pace
 * (`spend × days_in_month / days_elapsed`) instead of a 7-day trailing avg —
 * that's slightly less accurate than what the Python tool computes (it makes a
 * second insights call for the last_7d window), but the agent overwrites with
 * the real 7d projection on its next run, so the divergence is bounded to one
 * day. The trade is worth it: one network round-trip on the home page render.
 */

const OVERRUN_THRESHOLD = 1.1;
const UNDERRUN_THRESHOLD = 0.7;

export type LiveSpendResult =
  | { ok: true; decision: AgentDecision; live: true }
  | { ok: false; reason: "no_token" | "expired_token" | "meta_error" };

function daysInMonth(d: Date): number {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
}

function classify(pace: number | null): "ok" | "overrun" | "underrun" | "no_budget_set" {
  if (pace === null) return "no_budget_set";
  if (pace > OVERRUN_THRESHOLD) return "overrun";
  if (pace < UNDERRUN_THRESHOLD) return "underrun";
  return "ok";
}

function buildSummary(
  spend: number,
  effBudget: number,
  pace: number | null,
  status: ReturnType<typeof classify>,
): string {
  // Same Hebrew shape the agent writes (see existing rows on Aiweon) so the
  // /history feed reads identically regardless of source.
  const spendStr = `₪${Math.round(spend).toLocaleString("he-IL")}`;
  const budgetStr = `₪${Math.round(effBudget).toLocaleString("he-IL")}`;
  const pacePct = pace !== null ? `${Math.round(pace * 100)}%` : "—";
  if (status === "no_budget_set") {
    return `הוצאו ${spendStr} (אין תקציב חודשי מוגדר)`;
  }
  const label =
    status === "overrun"
      ? "חריגה"
      : status === "underrun"
        ? "תת-ניצול"
        : "בקצב";
  return `תקציב ${label} — הוצאו ${spendStr} מתוך ${budgetStr} (${pacePct} מהקצב)`;
}

/**
 * Fetch live spend from Meta, recompute pace, and persist the snapshot.
 *
 * Returns `{ ok: false, reason }` (not throwing) when Meta is unreachable or
 * the token is missing/expired — the caller falls back to the most recent
 * stored decision with a "מיושן" badge. Throwing here would surface as a 500
 * on the home page, which is worse than a stale number plus a clear label.
 */
export async function fetchLiveSpendAndRecord(
  db: DataClient,
  business: Business,
): Promise<LiveSpendResult> {
  let token: string;
  try {
    const resolved = await getTokenForBusiness(db, business);
    token = resolved.token;
  } catch (e) {
    if (e instanceof MetaConnectionRequired) return { ok: false, reason: "no_token" };
    if (e instanceof MetaConnectionExpired) {
      return { ok: false, reason: "expired_token" };
    }
    console.warn(
      `[live-spend] token resolve failed for business ${business.id}: ${
        e instanceof Error ? e.message : "unknown"
      }`,
    );
    return { ok: false, reason: "no_token" };
  }

  let accountSpend;
  try {
    accountSpend = await getAdAccountSpendThisMonth({
      adAccountId: business.meta_ad_account_id,
      userToken: token,
    });
  } catch (e) {
    console.warn(
      `[live-spend] Meta insights failed for ${business.meta_ad_account_id}: ${
        e instanceof MetaGraphError
          ? `${e.message} (code=${e.code ?? "?"})`
          : e instanceof Error
            ? e.message
            : "unknown"
      }`,
    );
    return { ok: false, reason: "meta_error" };
  }

  const today = new Date();
  const daysElapsed = today.getUTCDate();
  const dim = daysInMonth(today);
  const daysLeft = dim - daysElapsed;
  const monthlyBudget = business.monthly_budget_ils
    ? Number(business.monthly_budget_ils)
    : null;
  const { effective, multiplier, active_windows } = effectiveMonthlyBudget(
    monthlyBudget,
    business.seasonal_hints,
    today,
  );
  // Meta returns spend in the ad account's native currency (USD, EUR, etc).
  // Aiweon's account is denominated in USD; the business's monthly_budget
  // and every downstream pace calc is in ILS. Convert before we touch the
  // pace math, otherwise a ~$484 USD spend renders as "₪484 / ₪6,000 = 8%"
  // when the truth is ~"₪1,800 / ₪6,000 = 30%".
  const spendNative = accountSpend.spend_this_month;
  const fx = await convertToIls(spendNative, accountSpend.currency);
  const spend = fx.amount_ils;
  // Linear projection: spend so far × days_in_month / days_elapsed. Cheaper
  // than the agent's 7d-avg version (one fewer Meta call) and self-corrects
  // every morning when the runner overwrites this row.
  const projected = daysElapsed > 0 ? (spend * dim) / daysElapsed : spend;
  const pace =
    monthlyBudget && effective > 0
      ? spend / (effective * (daysElapsed / dim))
      : null;
  const status = classify(pace);

  const outputs = {
    business_id: business.id,
    today: today.toISOString().slice(0, 10),
    days_elapsed: daysElapsed,
    days_in_month: dim,
    days_left: daysLeft,
    monthly_budget_ils: monthlyBudget,
    seasonal_multiplier: Number(multiplier.toFixed(4)),
    active_windows,
    effective_monthly_budget: Number(effective.toFixed(2)),
    spend_this_month: Number(spend.toFixed(2)),
    avg_daily_spend_last_7d: null,
    projected_monthly_spend: Number(projected.toFixed(2)),
    pace: pace !== null ? Number(pace.toFixed(4)) : null,
    status,
    thresholds: {
      overrun_gt: OVERRUN_THRESHOLD,
      underrun_lt: UNDERRUN_THRESHOLD,
    },
    source: "web_live_fetch",
    // FX metadata — null when account is already ILS-denominated. UI uses
    // this to render "מומר מ-$X (שער 3.71)" beneath the hero number.
    fx:
      fx.source_currency !== "ILS"
        ? {
            source_currency: fx.source_currency,
            native_amount: Number(spendNative.toFixed(2)),
            rate_used: Number(fx.rate_used.toFixed(4)),
            rate_source: fx.fx_source,
          }
        : null,
  };

  try {
    const decision = await db.recordBudgetHealthSnapshot({
      business_id: business.id,
      summary: buildSummary(spend, effective, pace, status),
      outputs,
    });
    return { ok: true, decision, live: true };
  } catch (e) {
    // DB write failed — we still have the live numbers; return a synthetic
    // decision so the UI renders the live values even when persistence
    // hiccups. The next agent run will write the next persistent row.
    console.warn(
      `[live-spend] recordBudgetHealthSnapshot failed for ${business.id}: ${
        e instanceof Error ? e.message : "unknown"
      }`,
    );
    const synthetic: AgentDecision = {
      id: "live-ephemeral",
      business_id: business.id,
      run_id: "live-ephemeral",
      graph_name: "observe_propose",
      node_name: "budget_health",
      created_at: new Date().toISOString(),
      decision_type: "observation",
      summary: buildSummary(spend, effective, pace, status),
      rationale: null,
      inputs: null,
      outputs,
      related_approval_id: null,
      campaign_id: null,
      adset_id: null,
      ad_id: null,
      llm_model: null,
      llm_tokens_in: null,
      llm_tokens_out: null,
      latency_ms: null,
      guardrail_violations: null,
      confidence: null,
    };
    return { ok: true, decision: synthetic, live: true };
  }
}
