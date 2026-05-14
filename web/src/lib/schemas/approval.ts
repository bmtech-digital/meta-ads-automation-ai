import { z } from "zod";

/**
 * Shape of an `approvals` row as consumed by the UI. Matches the backend
 * enum exactly — see migrations/004_approvals.sql + backend PRD §10.4.
 */

export const TASK_TYPES = [
  "budget_change",
  "pause_campaign",
  "resume_campaign",
  "pause_adset",
  "new_creative",
  "new_campaign",
  "scale_up",
  "scale_down",
  "expand_audience",
] as const;

export const URGENCY = ["low", "medium", "high", "urgent"] as const;
export const STATUS = [
  "pending",
  "approved",
  "rejected",
  "executed",
  "failed",
  "expired",
  "dry_run",
] as const;
export const TARGET_KIND = [
  "campaign",
  "adset",
  "ad",
  "creative",
  "account",
] as const;

export const approvalSchema = z.object({
  id: z.string().uuid(),
  business_id: z.string().uuid(),
  task_type: z.enum(TASK_TYPES),
  target_kind: z.enum(TARGET_KIND),
  target_id: z.string(),
  payload: z.record(z.unknown()),
  rationale: z.string().min(1),
  expected_impact: z.record(z.unknown()).nullable(),
  urgency: z.enum(URGENCY),
  status: z.enum(STATUS),
  created_at: z.string(),
  expires_at: z.string().nullable(),
});

export const rejectRequestSchema = z.object({
  reason: z.string().trim().min(1, "נדרשת סיבה").max(200, "עד 200 תווים"),
});

export type Approval = z.infer<typeof approvalSchema>;
export type TaskType = (typeof TASK_TYPES)[number];
export type Urgency = (typeof URGENCY)[number];
