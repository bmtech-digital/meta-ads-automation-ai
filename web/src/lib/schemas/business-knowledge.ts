import { z } from "zod";
import { VERTICALS } from "@/lib/kpi";

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
    .refine((v) => v === null || /^https?:\/\/.+/i.test(v), { message: "URL לא תקין (http(s)://...)" }),
  service_regions: z.array(z.string()).nullable(),
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
});

const _verticalBrand = z.enum(VERTICALS as [string, ...string[]]);

export type BusinessKnowledgeForm = z.infer<typeof businessKnowledgeFormSchema>;

export function parseProductsRaw(raw: string | null): Array<{ name: string; description?: string }> | null {
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
