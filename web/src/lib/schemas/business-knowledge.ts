import { z } from "zod";
import { VERTICALS } from "@/lib/kpi";

/**
 * Geo targeting — mirror of Meta's targeting.geo_locations + excluded_geo_locations.
 * Persisted as `business_knowledge.geo_targeting jsonb` (migration 025).
 *
 * Roi 2026-05-13: an Aiweon campaign needs both an inclusion pool AND
 * exclusions ("כן ת"א + רדיוס מהמשרד; לא בני ברק"). City-only without
 * radius is intentional — Meta defaults to ~17km around the city center,
 * which is the operator's mental model of "טרגט את ת"א".
 */
const geoNamedKeySchema = z.object({
  key: z.string().trim().min(1),
  name: z.string().trim().min(1),
});

const geoRadiusCenterSchema = z.object({
  name: z.string().trim().min(1),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  radius_km: z.number().int().min(1).max(80),
});

const geoBlockSchema = z.object({
  countries: z.array(z.string().length(2)).optional(),
  regions: z.array(geoNamedKeySchema).optional(),
  cities: z.array(geoNamedKeySchema).optional(),
  radius_centers: z.array(geoRadiusCenterSchema).optional(),
  zips: z.array(geoNamedKeySchema).optional(),
});

export const geoTargetingSchema = z.object({
  include: geoBlockSchema.optional(),
  exclude: geoBlockSchema.optional(),
});

export type GeoTargeting = z.infer<typeof geoTargetingSchema>;
export type GeoBlock = z.infer<typeof geoBlockSchema>;
export type GeoNamedKey = z.infer<typeof geoNamedKeySchema>;
export type GeoRadiusCenter = z.infer<typeof geoRadiusCenterSchema>;

const optionalIntBounded = (min: number, max: number) =>
  z
    .string()
    .trim()
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .refine((v) => v === null || /^\d+$/.test(v), { message: "מספר שלם בלבד" })
    .transform((v) => (v === null ? null : Number.parseInt(v, 10)))
    .refine((v) => v === null || (v >= min && v <= max), {
      message: `חייב להיות בין ${min} ל-${max}`,
    });

/**
 * Optional positive number for KPI targets (CPA/CPL in ILS, ROAS multiplier).
 * Accepts decimal input ("80", "80.5"), rejects ≤ 0, returns null on empty.
 * Migration 019 enforces the same constraints at the DB level.
 */
const optionalPositiveNumber = (opts: { min?: number; label: string }) =>
  z
    .string()
    .trim()
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .refine((v) => v === null || /^\d+(\.\d+)?$/.test(v), {
      message: `${opts.label}: מספר חיובי בלבד`,
    })
    .transform((v) => (v === null ? null : Number.parseFloat(v)))
    .refine((v) => v === null || v > (opts.min ?? 0), {
      message: `${opts.label}: חייב להיות גדול מ-${opts.min ?? 0}`,
    });

const splitCsv = (s: FormDataEntryValue | null): string[] | null => {
  const raw = typeof s === "string" ? s.trim() : "";
  if (!raw) return null;
  return raw
    .split(/[,\n]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
};

export const businessKnowledgeFormSchema = z.object({
  vertical: z
    .string()
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .refine((v) => v === null || (VERTICALS as readonly string[]).includes(v), {
      message: "vertical לא חוקי",
    })
    .transform((v) => v as z.infer<typeof _verticalBrand> | null),
  website_url: z
    .string()
    .trim()
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .transform((v) => (v === null ? null : /^https?:\/\//i.test(v) ? v : `https://${v}`))
    .refine(
      (v) => {
        if (v === null) return true;
        try {
          const u = new URL(v);
          return (
            (u.protocol === "http:" || u.protocol === "https:") &&
            u.hostname.includes(".")
          );
        } catch {
          return false;
        }
      },
      { message: "URL לא תקין" },
    ),
  service_regions: z.array(z.string()).nullable(),
  // Migration 025 — per-business geo (include + exclude). Mirrors Meta's
  // targeting.geo_locations spec. Submitted by GeoTargetingEditor as a
  // JSON-stringified hidden input.  Empty string / "{}" → null on save.
  geo_targeting: z
    .string()
    .trim()
    .transform((v) => (v === "" || v === "{}" ? null : v))
    .nullable()
    .superRefine((v, ctx) => {
      if (v === null) return;
      try {
        const parsed = JSON.parse(v) as unknown;
        const result = geoTargetingSchema.safeParse(parsed);
        if (!result.success) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `geo_targeting JSON לא תואם schema: ${result.error.issues
              .map((i) => i.message)
              .join("; ")}`,
          });
        }
      } catch (e) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `geo_targeting אינו JSON תקין: ${(e as Error).message}`,
        });
      }
    })
    .transform((v) => (v === null ? null : (JSON.parse(v) as GeoTargeting))),
  customer_age_min: optionalIntBounded(13, 80),
  customer_age_max: optionalIntBounded(13, 80),
  products_raw: z
    .string()
    .trim()
    .transform((v) => (v === "" ? null : v))
    .nullable(),
  delivery_time_days: optionalIntBounded(0, 365),
  strong_seasons: z.array(z.string()).nullable(),
  weak_seasons: z.array(z.string()).nullable(),
  competitors: z.array(z.string()).nullable(),
  ideal_customer: z.string().trim().nullable(),
  main_pain: z.string().trim().nullable(),
  common_objections: z.string().trim().nullable(),
  usp: z.string().trim().nullable(),
  what_worked_before: z.string().trim().nullable(),
  what_failed_before: z.string().trim().nullable(),
  brand_tone: z.string().trim().nullable(),
  brand_forbidden_words: z.array(z.string()).nullable(),
  // KPI targets — migration 019. CPM/CPI deferred (not collected here).
  target_cpa_ils: optionalPositiveNumber({ label: "יעד CPA" }),
  target_cpl_ils: optionalPositiveNumber({ label: "יעד CPL" }),
  target_roas: optionalPositiveNumber({ min: 1.0, label: "יעד ROAS" }),
  // Monthly brief — migration 020. The `month` field is stamped server-side
  // on save so the operator doesn't need to type it.
  brief_active_offer: z.string().trim().nullable(),
  brief_deadline_date: z
    .string()
    .trim()
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .refine((v) => v === null || /^\d{4}-\d{2}-\d{2}$/.test(v), {
      message: "תאריך חייב להיות בפורמט YYYY-MM-DD",
    }),
  brief_hands_off_campaign_ids: z.array(z.string()).nullable(),
  brief_notes: z.string().trim().nullable(),
});

const _verticalBrand = z.enum(VERTICALS as [string, ...string[]]);

export type BusinessKnowledgeForm = z.infer<typeof businessKnowledgeFormSchema>;

export function parseProductsRaw(
  raw: string | null,
): Array<{ name: string; description?: string }> | null {
  if (!raw) return null;
  const lines = raw
    .split(/\n+/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length === 0) return null;
  return lines.map((line) => {
    const [name, ...rest] = line.split("—").map((s) => s.trim());
    const description = rest.join(" — ").trim();
    return description ? { name, description } : { name };
  });
}

export { splitCsv };
