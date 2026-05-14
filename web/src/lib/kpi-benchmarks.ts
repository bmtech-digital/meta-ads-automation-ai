/**
 * KPI benchmark bands per vertical — Israeli market, 2026 (FLAT FALLBACK).
 *
 * NOTE (2026-05-13): For richer per-business benchmarks that account for
 * sub-vertical × geo × funnel-stage × offer × channel × season, see
 * `./cpl-infrastructure.ts`. That file is now the authoritative source
 * when business_knowledge has vertical + products + service_regions; this
 * flat per-vertical fallback is used only when the rich match falls back
 * (vertical=other, no products entered, etc).
 *
 * Used in three places:
 *   1. /business-knowledge form — shows the realistic band next to each
 *      target_* input, plus an out-of-band warning when the operator types
 *      a value outside it.
 *   2. Dashboard KpiTargetTile — shows the band + a "good / less good / way off"
 *      verdict comparing the operator's set target to the band, and
 *      comparing actual recent performance to the same band.
 *   3. Agent `set_kpi_target` proposals — the agent reads the same ranges
 *      from `campaigner/prompts/kpi-benchmarks.md` (kept in sync by hand).
 *
 * Numbers are MEDIAN-CENTERED RANGES, not floors or ceilings. Use them to
 * detect "is the operator's value sane?", not as hard limits.
 *
 * Update protocol: change here AND in `campaigner/prompts/kpi-benchmarks.md`
 * together. The prompt file is what Claude reads at runtime; this TS file is
 * what the operator sees in the browser. They must agree.
 */

import type { Vertical } from "./db/types";

export type KpiKind = "cpa" | "cpl" | "roas";

export interface KpiBenchmark {
  /** Lower bound of "good" performance — anything ≤ this is clearly winning. */
  good_max: number;
  /** Median expectation. The middle of the typical band. */
  median: number;
  /** Upper bound of "typical" — anything ≤ this is in-range, even if not great. */
  realistic_max: number;
  /**
   * Hard floor — anything below this is implausible for the vertical. We
   * surface a warning ("are you sure?") and the agent emits an alert per
   * the reality-check rule (see decision-tree §T-2). NOT a hard reject —
   * operators can override.
   */
  implausible_below: number;
  /**
   * Hard ceiling — anything above this is "you're not really setting a goal,
   * you're calling defeat early." Same warning shape as `implausible_below`.
   */
  unambitious_above: number;
  /** One-line Hebrew label explaining where the number comes from. */
  source_note: string;
}

const NOT_APPLICABLE: KpiBenchmark | null = null;

/**
 * Per (vertical, kpi) bands. `null` means "this KPI doesn't apply to this
 * vertical" — e.g. awareness campaigns don't have a CPA target, ecommerce
 * doesn't track CPL the same way.
 */
const BENCHMARKS: Record<
  Vertical,
  Record<KpiKind, KpiBenchmark | typeof NOT_APPLICABLE>
> = {
  leads: {
    cpa: NOT_APPLICABLE,
    cpl: {
      implausible_below: 15,
      good_max: 60,
      median: 90,
      realistic_max: 180,
      unambitious_above: 400,
      source_note:
        "Meta IL B2C services 2026 — ליד לקוח-קצה בפלח שירותים מקומיים (קבלן, מתווך, סוכן ביטוח, נדל\"ן)",
    },
    roas: NOT_APPLICABLE,
  },
  b2b_saas: {
    cpa: NOT_APPLICABLE,
    cpl: {
      implausible_below: 30,
      good_max: 150,
      median: 250,
      realistic_max: 400,
      unambitious_above: 800,
      source_note:
        "Meta IL B2B SaaS / פלטפורמות 2026 — demo request ממנהל שיווק/מותג. מחזור מכירה ארוך, ערך עסקה גבוה, קהל יעד צר ומקצועי — CPL גבוה מ-B2C services כי הליד עצמו שווה יותר",
    },
    roas: NOT_APPLICABLE,
  },
  ecommerce: {
    cpa: {
      implausible_below: 8,
      good_max: 35,
      median: 60,
      realistic_max: 120,
      unambitious_above: 300,
      source_note: "Meta IL e-commerce 2026 — AOV ₪150-₪400, מוצרים פיזיים",
    },
    cpl: NOT_APPLICABLE,
    roas: {
      implausible_below: 1.2,
      good_max: 4.0,
      median: 2.8,
      realistic_max: 2.0,
      unambitious_above: 1.5,
      source_note:
        "Meta IL e-commerce ROAS — מותגים יציבים מגיעים ל-2.5-4.0",
    },
  },
  awareness: {
    cpa: NOT_APPLICABLE,
    cpl: NOT_APPLICABLE,
    roas: NOT_APPLICABLE,
  },
  app: {
    cpa: {
      implausible_below: 5,
      good_max: 20,
      median: 35,
      realistic_max: 80,
      unambitious_above: 200,
      source_note: "Meta IL app-install — install + opening event",
    },
    cpl: NOT_APPLICABLE,
    roas: NOT_APPLICABLE,
  },
  other: {
    // No category — use the leads band as a soft default. Operators on
    // "other" should be encouraged to pick a real vertical for sharper
    // benchmarks.
    cpa: {
      implausible_below: 15,
      good_max: 60,
      median: 100,
      realistic_max: 200,
      unambitious_above: 500,
      source_note: "ברירת מחדל — שווה לבחור vertical ספציפי לבדגים מדויקים",
    },
    cpl: {
      implausible_below: 15,
      good_max: 60,
      median: 100,
      realistic_max: 200,
      unambitious_above: 500,
      source_note: "ברירת מחדל — שווה לבחור vertical ספציפי לבדגים מדויקים",
    },
    roas: {
      implausible_below: 1.2,
      good_max: 3.5,
      median: 2.5,
      realistic_max: 1.8,
      unambitious_above: 1.3,
      source_note: "ברירת מחדל ROAS",
    },
  },
};

export function getBenchmark(
  vertical: Vertical | null,
  kpi: KpiKind,
): KpiBenchmark | null {
  if (vertical === null) return BENCHMARKS.other[kpi];
  return BENCHMARKS[vertical][kpi];
}

/**
 * Classify an actual value against the benchmark band.
 * For CPA/CPL (lower=better): good if ≤ good_max, ok if ≤ realistic_max,
 * worrying if ≤ unambitious_above, off-band otherwise.
 * For ROAS (higher=better): inverted — good if ≥ good_max, etc.
 */
export type BenchmarkVerdict =
  | "implausible"
  | "good"
  | "ok"
  | "worrying"
  | "off_band";

export function classifyAgainstBenchmark(
  value: number,
  kpi: KpiKind,
  band: KpiBenchmark,
): BenchmarkVerdict {
  if (kpi === "roas") {
    // Higher is better. For ROAS, good_max is actually the high bound of
    // "good"; the field names are inverted by intent (see the schema).
    if (value < band.implausible_below) return "off_band";
    if (value >= band.good_max) return "good";
    if (value >= band.median) return "ok";
    if (value >= band.realistic_max) return "worrying";
    return "off_band";
  }
  // CPA / CPL — lower is better.
  if (value < band.implausible_below) return "implausible";
  if (value <= band.good_max) return "good";
  if (value <= band.realistic_max) return "ok";
  if (value <= band.unambitious_above) return "worrying";
  return "off_band";
}

export function verdictHe(verdict: BenchmarkVerdict): {
  label: string;
  tone: "good" | "ok" | "warn" | "bad";
} {
  switch (verdict) {
    case "good":
      return { label: "מעל הממוצע", tone: "good" };
    case "ok":
      return { label: "בטווח", tone: "ok" };
    case "worrying":
      return { label: "מתחת לממוצע", tone: "warn" };
    case "implausible":
      return { label: "לא ריאלי", tone: "bad" };
    case "off_band":
      return { label: "מחוץ לטווח", tone: "bad" };
  }
}

/**
 * Format the band for display. Leads with the single median number (the
 * "average" a non-marketer expects), then a parenthetical range, then
 * the "good" threshold. Reads as:
 *
 *   "ממוצע ₪90 · טווח ₪60-₪180 · ₪60 ומטה = מצוין"
 *
 * For ROAS the polarity flips: higher is better, so good_max is the
 * "good" upper bound:
 *
 *   "ממוצע 2.8x · טווח 2.0x-4.0x · 4.0x ומעלה = מצוין"
 */
export function formatBandHe(kpi: KpiKind, band: KpiBenchmark): string {
  if (kpi === "roas") {
    return `ממוצע ${band.median}x · טווח ${band.realistic_max}x-${band.good_max}x · ${band.good_max}x ומעלה = מצוין`;
  }
  return `ממוצע ₪${band.median} · טווח ₪${band.good_max}-₪${band.realistic_max} · ₪${band.good_max} ומטה = מצוין`;
}

/** Single-number "average" extracted from the band — what most users mean by "the average". */
export function bandMedianHe(kpi: KpiKind, band: KpiBenchmark): string {
  if (kpi === "roas") return `${band.median}x`;
  return `₪${band.median}`;
}
