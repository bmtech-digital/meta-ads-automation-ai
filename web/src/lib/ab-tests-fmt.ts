/**
 * Hebrew formatters for /ab-tests pages. Block 11 (2026-05-13).
 * Pure functions — no I/O, no date.now() at module scope.
 */

import type { AbTestStatus, AbTestWinnerMetric } from "./db/types";

export const AB_TEST_STATUS_LABEL_HE: Record<AbTestStatus, string> = {
  running: "פעיל",
  decided: "הוחלט",
  cancelled: "בוטל",
  expired: "פג תוקף",
};

export const AB_TEST_STATUS_STYLES: Record<AbTestStatus, string> = {
  running:
    "bg-brand-500/15 text-brand-500 dark:text-brand-400 ring-1 ring-brand-500/30",
  decided:
    "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 ring-1 ring-emerald-500/30",
  cancelled: "bg-muted text-muted-foreground ring-1 ring-border",
  expired: "bg-amber-500/15 text-amber-700 dark:text-amber-300 ring-1 ring-amber-500/30",
};

export const AB_TEST_METRIC_LABEL_HE: Record<AbTestWinnerMetric, string> = {
  hook_rate: "אחוז משיכת תשומת לב (Hook rate)",
  ctr: "אחוז קליקים (CTR)",
  cpa: "עלות לרכישה (CPA)",
  cpl: "עלות לליד (CPL)",
  conversions: "סך המרות",
};

export const AB_TEST_CONFIDENCE_LABEL_HE: Record<string, string> = {
  "95pct": "ביטחון 95%",
  directional: "כיוון, לא מובהק",
  insufficient: "לא מספיק נתונים",
};

export const AB_TEST_CONFIDENCE_TONE: Record<
  string,
  "good" | "warn" | "alert" | "neutral"
> = {
  "95pct": "good",
  directional: "warn",
  insufficient: "alert",
};

/**
 * Days-remaining label for a running test. Takes the planned_end_at ISO
 * string and returns "נותרו N ימים" or "החלון נסגר" depending on now.
 *
 * Pure — takes optional `now` for tests; defaults to `new Date()` at call
 * time, NOT module load.
 */
export function daysRemainingHe(
  plannedEndIso: string,
  nowMs: number = Date.now(),
): string {
  const end = new Date(plannedEndIso).getTime();
  if (Number.isNaN(end)) return "—";
  const msLeft = end - nowMs;
  const days = Math.ceil(msLeft / (1000 * 60 * 60 * 24));
  if (days < 0) return "החלון נסגר — מוכן להחלטה";
  if (days === 0) return "מסתיים היום";
  if (days === 1) return "נותר יום אחד";
  return `נותרו ${days} ימים`;
}

/**
 * Format a metric value with the right shape per metric type.
 *  hook_rate, ctr → percent (4 decimals → 2 decimals as %)
 *  cpa, cpl → ₪ with one decimal
 *  conversions → integer
 */
export function formatMetricValueHe(
  metric: AbTestWinnerMetric,
  value: number | null | undefined,
): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  if (metric === "hook_rate" || metric === "ctr") {
    return `${(value * 100).toFixed(2)}%`;
  }
  if (metric === "cpa" || metric === "cpl") {
    return `₪${value.toFixed(1)}`;
  }
  return Math.round(value).toLocaleString("he-IL");
}
