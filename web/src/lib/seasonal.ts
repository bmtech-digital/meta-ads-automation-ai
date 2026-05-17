/**
 * Seasonal multiplier — TS port of `campaigner/lib/seasonal.py`.
 *
 * Per decisions-log §1.10: `businesses.seasonal_hints` holds operator-entered
 * windows. On any date, the effective multiplier is the PRODUCT of multipliers
 * of all windows covering that date. Empty hints → 1.0.
 *
 * Mirrors the Python contract exactly so a row written from the web side
 * matches what the agent would write tomorrow morning.
 */

export interface SeasonalWindow {
  name?: string;
  start: string;
  end: string;
  multiplier: number;
  confidence?: string;
}

type SeasonalHintsInput = { windows?: unknown } | Record<string, unknown> | null | undefined;

function parseDate(raw: unknown): Date | null {
  if (typeof raw !== "string") return null;
  // ISO YYYY-MM-DD — interpret as UTC noon to dodge DST/TZ edge cases when
  // comparing to `on`. We only care about the calendar date.
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (!m) return null;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12));
}

function sameOrBefore(a: Date, b: Date): boolean {
  return a.getTime() <= b.getTime();
}

export function activeWindows(
  seasonal_hints: SeasonalHintsInput,
  on: Date,
): SeasonalWindow[] {
  if (!seasonal_hints || typeof seasonal_hints !== "object") return [];
  const windows = (seasonal_hints as { windows?: unknown }).windows;
  if (!Array.isArray(windows)) return [];
  const active: SeasonalWindow[] = [];
  for (const w of windows) {
    if (!w || typeof w !== "object") continue;
    const ww = w as Record<string, unknown>;
    const start = parseDate(ww.start);
    const end = parseDate(ww.end);
    if (!start || !end || start.getTime() > end.getTime()) continue;
    if (sameOrBefore(start, on) && sameOrBefore(on, end)) {
      active.push({
        name: typeof ww.name === "string" ? ww.name : undefined,
        start: ww.start as string,
        end: ww.end as string,
        multiplier:
          typeof ww.multiplier === "number" && ww.multiplier > 0
            ? ww.multiplier
            : 1.0,
        confidence:
          typeof ww.confidence === "string" ? ww.confidence : undefined,
      });
    }
  }
  return active;
}

export function multiplierForDate(
  seasonal_hints: SeasonalHintsInput,
  on: Date,
): number {
  let total = 1.0;
  for (const w of activeWindows(seasonal_hints, on)) {
    if (typeof w.multiplier === "number" && w.multiplier > 0) {
      total *= w.multiplier;
    }
  }
  return total;
}

export function effectiveMonthlyBudget(
  monthly_budget_ils: number | null | undefined,
  seasonal_hints: SeasonalHintsInput,
  on: Date,
): {
  effective: number;
  multiplier: number;
  active_windows: SeasonalWindow[];
} {
  const m = multiplierForDate(seasonal_hints, on);
  const base = Number(monthly_budget_ils ?? 0);
  return {
    effective: base * m,
    multiplier: m,
    active_windows: activeWindows(seasonal_hints, on),
  };
}
