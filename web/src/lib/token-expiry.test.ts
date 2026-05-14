import { describe, it, expect } from "vitest";
import {
  tokenExpiryState,
  tokenStateLabelHe,
  isTokenActionable,
} from "./token-expiry";
import type { Business } from "./db/types";

function mkBusiness(overrides: Partial<Business>): Business {
  return {
    id: "b1",
    name: "Test",
    timezone: "Asia/Jerusalem",
    meta_ad_account_id: "act_1",
    meta_page_id: "p1",
    meta_auth_mode: "user_token",
    meta_access_token_expires_at: null,
    monthly_budget_ils: null,
    daily_budget_ils: null,
    seasonal_hints: {},
    primary_kpi: null,
    target_cpa_ils: null,
    target_cpl_ils: null,
    target_roas: null,
    monthly_brief: null,
    active: true,
    agent_mode: "draft",
    created_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

const NOW = new Date("2026-04-21T12:00:00Z");

describe("tokenExpiryState", () => {
  it("returns unknown when no expiry date is recorded (pre-OAuth)", () => {
    const b = mkBusiness({
      meta_auth_mode: "user_token",
      meta_access_token_expires_at: null,
    });
    expect(tokenExpiryState(b, NOW)).toEqual({ kind: "unknown" });
  });

  it("returns healthy when >10 days away", () => {
    const b = mkBusiness({
      meta_access_token_expires_at: "2026-06-01T00:00:00Z",
    });
    const state = tokenExpiryState(b, NOW);
    expect(state.kind).toBe("healthy");
    if (state.kind === "healthy") expect(state.daysLeft).toBeGreaterThan(10);
  });

  it("returns warning at 10 days or less", () => {
    const b = mkBusiness({
      meta_access_token_expires_at: "2026-04-28T12:00:00Z",
    });
    const state = tokenExpiryState(b, NOW);
    expect(state.kind).toBe("warning");
    if (state.kind === "warning") expect(state.daysLeft).toBe(7);
  });

  it("returns critical at 3 days or less", () => {
    const b = mkBusiness({
      meta_access_token_expires_at: "2026-04-23T12:00:00Z",
    });
    const state = tokenExpiryState(b, NOW);
    expect(state.kind).toBe("critical");
    if (state.kind === "critical") expect(state.daysLeft).toBe(2);
  });

  it("returns critical at exactly 0 days", () => {
    const b = mkBusiness({
      meta_access_token_expires_at: "2026-04-22T00:00:00Z",
    });
    const state = tokenExpiryState(b, NOW);
    expect(state.kind).toBe("critical");
    if (state.kind === "critical") expect(state.daysLeft).toBe(0);
  });

  it("returns expired when past the expiry date", () => {
    const b = mkBusiness({
      meta_access_token_expires_at: "2026-04-15T12:00:00Z",
    });
    const state = tokenExpiryState(b, NOW);
    expect(state.kind).toBe("expired");
    if (state.kind === "expired") expect(state.daysAgo).toBe(6);
  });

  it("treats malformed date string as unknown", () => {
    const b = mkBusiness({ meta_access_token_expires_at: "not-a-date" });
    expect(tokenExpiryState(b, NOW)).toEqual({ kind: "unknown" });
  });
});

describe("tokenStateLabelHe", () => {
  it("renders Hebrew for each state", () => {
    expect(tokenStateLabelHe({ kind: "unknown" })).toContain("חובר");
    expect(tokenStateLabelHe({ kind: "expired", daysAgo: 5 })).toContain(
      "פג לפני 5",
    );
    expect(tokenStateLabelHe({ kind: "critical", daysLeft: 2 })).toContain(
      "בעוד 2",
    );
    expect(tokenStateLabelHe({ kind: "critical", daysLeft: 0 })).toContain(
      "פג היום",
    );
    expect(tokenStateLabelHe({ kind: "warning", daysLeft: 7 })).toContain(
      "בעוד 7",
    );
    expect(tokenStateLabelHe({ kind: "healthy", daysLeft: 50 })).toBe(
      "מחובר",
    );
  });
});

describe("isTokenActionable", () => {
  it("flags only states requiring action", () => {
    expect(isTokenActionable({ kind: "unknown" })).toBe(false);
    expect(isTokenActionable({ kind: "healthy", daysLeft: 20 })).toBe(false);
    expect(isTokenActionable({ kind: "warning", daysLeft: 7 })).toBe(true);
    expect(isTokenActionable({ kind: "critical", daysLeft: 2 })).toBe(true);
    expect(isTokenActionable({ kind: "expired", daysAgo: 1 })).toBe(true);
  });
});
