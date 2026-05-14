import { describe, it, expect } from "vitest";
import {
  approvalSchema,
  rejectRequestSchema,
  TASK_TYPES,
  URGENCY,
} from "./approval";

const validApproval = {
  id: "550e8400-e29b-41d4-a716-446655440000",
  business_id: "550e8400-e29b-41d4-a716-446655440001",
  task_type: "budget_change" as const,
  target_kind: "campaign" as const,
  target_id: "1234567890",
  payload: { new_daily_budget_cents: 6500, old_daily_budget_cents: 5000 },
  rationale: "CPA נמוך משמעותית מ-baseline; מעלים תקציב ב-30%.",
  expected_impact: { expected_cpa_change_pct: -12 },
  urgency: "medium" as const,
  status: "pending" as const,
  created_at: "2026-04-19T09:00:00Z",
  expires_at: "2026-04-20T09:00:00Z",
};

describe("approvalSchema", () => {
  it("accepts a well-formed row", () => {
    const parsed = approvalSchema.parse(validApproval);
    expect(parsed.id).toBe(validApproval.id);
  });

  it("rejects an invalid task_type", () => {
    const bad = { ...validApproval, task_type: "burn_money" };
    expect(() => approvalSchema.parse(bad)).toThrow();
  });

  it("rejects an invalid urgency", () => {
    const bad = { ...validApproval, urgency: "extreme" };
    expect(() => approvalSchema.parse(bad)).toThrow();
  });

  it("allows null expected_impact + expires_at", () => {
    const row = { ...validApproval, expected_impact: null, expires_at: null };
    expect(() => approvalSchema.parse(row)).not.toThrow();
  });

  it("enforces non-empty rationale", () => {
    const bad = { ...validApproval, rationale: "" };
    expect(() => approvalSchema.parse(bad)).toThrow();
  });

  it("exposes canonical enum lists", () => {
    expect(TASK_TYPES).toContain("new_campaign");
    expect(URGENCY).toEqual(["low", "medium", "high", "urgent"]);
  });
});

describe("rejectRequestSchema", () => {
  it("requires reason", () => {
    expect(() => rejectRequestSchema.parse({ reason: "" })).toThrow();
  });

  it("trims and accepts a short reason", () => {
    const r = rejectRequestSchema.parse({ reason: "  לא רלוונטי כרגע  " });
    expect(r.reason).toBe("לא רלוונטי כרגע");
  });

  it("caps at 200 chars", () => {
    const long = "א".repeat(201);
    expect(() => rejectRequestSchema.parse({ reason: long })).toThrow();
  });
});
