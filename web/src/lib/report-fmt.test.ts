import { describe, expect, it } from "vitest";
import {
  budgetSourceLabel,
  decisionTypeLabel,
  ilsHe,
  monthLabelHe,
  paceBucket,
  pctHe,
  shortDateHe,
} from "./report-fmt";

describe("monthLabelHe", () => {
  it("formats a valid YYYY-MM", () => {
    expect(monthLabelHe("2026-05")).toBe("מאי 2026");
    expect(monthLabelHe("2026-01")).toBe("ינואר 2026");
    expect(monthLabelHe("2025-12")).toBe("דצמבר 2025");
  });

  it("returns the input on unparseable strings", () => {
    expect(monthLabelHe("not-a-month")).toBe("not-a-month");
    expect(monthLabelHe("2026")).toBe("2026");
    expect(monthLabelHe("2026-13")).toBe("2026-13");
  });
});

describe("ilsHe", () => {
  it("formats integers", () => {
    expect(ilsHe(1000)).toBe("₪1,000");
    expect(ilsHe(0)).toBe("₪0");
  });
  it("rounds floats", () => {
    expect(ilsHe(123.4)).toBe("₪123");
    expect(ilsHe(123.6)).toBe("₪124");
  });
  it("handles null / undefined / NaN", () => {
    expect(ilsHe(null)).toBe("—");
    expect(ilsHe(undefined)).toBe("—");
    expect(ilsHe(NaN)).toBe("—");
  });
});

describe("pctHe", () => {
  it("formats whole percent", () => {
    expect(pctHe(50)).toBe("50%");
    expect(pctHe(100)).toBe("100%");
  });
  it("rounds", () => {
    expect(pctHe(99.4)).toBe("99%");
    expect(pctHe(99.5)).toBe("100%");
  });
  it("handles null", () => {
    expect(pctHe(null)).toBe("—");
  });
});

describe("paceBucket", () => {
  it("buckets correctly", () => {
    expect(paceBucket(null).tone).toBe("neutral");
    expect(paceBucket(30).tone).toBe("alert");
    expect(paceBucket(60).tone).toBe("warn");
    expect(paceBucket(95).tone).toBe("good");
    expect(paceBucket(110).tone).toBe("good");
    expect(paceBucket(120).tone).toBe("alert");
  });
});

describe("decisionTypeLabel", () => {
  it("maps known types", () => {
    expect(decisionTypeLabel("diagnosis")).toBe("אבחנות");
    expect(decisionTypeLabel("execution")).toBe("ביצועים");
  });
  it("falls through unknown types unchanged", () => {
    expect(decisionTypeLabel("bogus")).toBe("bogus");
  });
});

describe("budgetSourceLabel", () => {
  const now = "2026-05-13T12:00:00.000Z";

  it("handles unavailable", () => {
    expect(budgetSourceLabel("unavailable", null, now)).toContain(
      "לא נשמרו לחודש",
    );
  });
  it("snapshot today", () => {
    const sixHoursAgo = "2026-05-13T06:00:00.000Z";
    expect(budgetSourceLabel("budget_health_snapshot", sixHoursAgo, now)).toContain(
      "היום",
    );
  });
  it("snapshot yesterday", () => {
    const yesterday = "2026-05-12T08:00:00.000Z";
    expect(budgetSourceLabel("budget_health_snapshot", yesterday, now)).toContain(
      "אתמול",
    );
  });
  it("older snapshot", () => {
    const aWeekAgo = "2026-05-06T12:00:00.000Z";
    expect(budgetSourceLabel("budget_health_snapshot", aWeekAgo, now)).toContain(
      "לפני 7 ימים",
    );
  });
});

describe("shortDateHe", () => {
  it("handles null", () => {
    expect(shortDateHe(null)).toBe("—");
  });
  it("formats an ISO date", () => {
    // Locale-dependent — assert structure rather than exact characters.
    const out = shortDateHe("2026-05-13T12:00:00.000Z");
    expect(out).not.toBe("—");
    expect(out.length).toBeGreaterThan(3);
  });
  it("handles unparseable", () => {
    expect(shortDateHe("not-a-date")).toBe("—");
  });
});
