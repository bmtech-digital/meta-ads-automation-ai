import { z } from "zod";

/**
 * Shape of `businesses.seasonal_hints` — per decisions-log §1.10.
 *
 * MVP accepts only `confidence: "user_stated"` in the editor; the schema still
 * parses `"learned"` so v2 War Chest rows (auto-filled) don't fail validation
 * when the row is loaded for display. The editor UI hides the edit/delete
 * actions for learned rows.
 */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export const seasonalHintSchema = z
  .object({
    name: z.string().trim().min(1, "חובה שם חלון").max(60, "עד 60 תווים"),
    start: z.string().regex(ISO_DATE, "תאריך פתיחה חייב להיות YYYY-MM-DD"),
    end: z.string().regex(ISO_DATE, "תאריך סגירה חייב להיות YYYY-MM-DD"),
    multiplier: z
      .coerce.number({ invalid_type_error: "מכפיל חייב להיות מספר" })
      .min(0.1, "מינימום 0.1")
      .max(3.0, "מקסימום 3.0"),
    confidence: z.enum(["user_stated", "learned"]).default("user_stated"),
  })
  .refine((v) => v.start <= v.end, {
    message: "תאריך סגירה לפני תאריך פתיחה",
    path: ["end"],
  });

export const seasonalHintsSchema = z.object({
  windows: z.array(seasonalHintSchema).default([]),
});

export type SeasonalHintForm = z.infer<typeof seasonalHintSchema>;
export type SeasonalHintsForm = z.infer<typeof seasonalHintsSchema>;

/**
 * Product of multipliers of windows that cover `on`. Kept here (and not pulled
 * from a backend tool) so the overlap hint can render synchronously on the
 * settings page without a round-trip.
 */
export function multiplierForDate(hints: SeasonalHintsForm | undefined, on: Date): number {
  if (!hints?.windows?.length) return 1.0;
  const iso = on.toISOString().slice(0, 10);
  let total = 1.0;
  for (const w of hints.windows) {
    if (w.start <= iso && iso <= w.end && Number.isFinite(w.multiplier) && w.multiplier > 0) {
      total *= w.multiplier;
    }
  }
  return total;
}

/**
 * Pairs of windows that overlap each other. Used to render the overlap hint on
 * the settings form (yellow at any overlap, red when the product crosses 2.0 or
 * 0.5 — the bounds from decisions-log §1.10).
 */
export function overlappingPairs(
  hints: SeasonalHintsForm | undefined,
): Array<{ a: SeasonalHintForm; b: SeasonalHintForm; product: number }> {
  const windows = hints?.windows ?? [];
  const out: Array<{ a: SeasonalHintForm; b: SeasonalHintForm; product: number }> = [];
  for (let i = 0; i < windows.length; i++) {
    for (let j = i + 1; j < windows.length; j++) {
      const a = windows[i];
      const b = windows[j];
      // Intervals overlap iff a.start <= b.end AND b.start <= a.end.
      if (a.start <= b.end && b.start <= a.end) {
        out.push({ a, b, product: a.multiplier * b.multiplier });
      }
    }
  }
  return out;
}
