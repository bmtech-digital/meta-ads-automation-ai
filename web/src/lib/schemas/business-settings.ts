import { z } from "zod";

const optionalPositiveNumber = z
  .string()
  .trim()
  .transform((v) => (v === "" ? null : v))
  .nullable()
  .refine((v) => v === null || !Number.isNaN(Number(v)), {
    message: "מספר לא תקין",
  })
  .transform((v) => (v === null ? null : Number(v)))
  .refine((v) => v === null || v >= 0, { message: "חייב להיות 0 ומעלה" });

export const businessSettingsFormSchema = z.object({
  name: z.string().trim().min(1, "חובה שם עסק").max(200),
  meta_ad_account_id: z
    .string()
    .trim()
    .min(1, "חובה מזהה חשבון")
    .regex(/^act_\d+$/, "חייב להתחיל ב-act_ ואז ספרות"),
  meta_page_id: z
    .string()
    .trim()
    .min(1, "חובה מזהה עמוד")
    .regex(/^\d+$/, "ספרות בלבד"),
  monthly_budget_ils: optionalPositiveNumber,
});

export type BusinessSettingsForm = z.infer<typeof businessSettingsFormSchema>;
