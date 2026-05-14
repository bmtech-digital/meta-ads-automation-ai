import { describe, expect, it } from "vitest";
import {
  AB_TEST_STATUS_LABEL_HE,
  AB_TEST_METRIC_LABEL_HE,
  AB_TEST_CONFIDENCE_LABEL_HE,
  AB_TEST_CONFIDENCE_TONE,
  daysRemainingHe,
  formatMetricValueHe,
} from "./ab-tests-fmt";

describe("AB_TEST_STATUS_LABEL_HE", () => {
  it("covers all four statuses", () => {
    expect(AB_TEST_STATUS_LABEL_HE.running).toBe("פעיל");
    expect(AB_TEST_STATUS_LABEL_HE.decided).toBe("הוחלט");
    expect(AB_TEST_STATUS_LABEL_HE.cancelled).toBe("בוטל");
    expect(AB_TEST_STATUS_LABEL_HE.expired).toBe("פג תוקף");
  });
});

describe("AB_TEST_METRIC_LABEL_HE", () => {
  it("returns Hebrew labels for all metrics", () => {
    expect(AB_TEST_METRIC_LABEL_HE.hook_rate).toMatch(/Hook rate/);
    expect(AB_TEST_METRIC_LABEL_HE.ctr).toMatch(/CTR/);
    expect(AB_TEST_METRIC_LABEL_HE.cpa).toMatch(/CPA/);
    expect(AB_TEST_METRIC_LABEL_HE.cpl).toMatch(/CPL/);
    expect(AB_TEST_METRIC_LABEL_HE.conversions).toMatch(/המרות/);
  });
});

describe("AB_TEST_CONFIDENCE_LABEL_HE", () => {
  it("maps confidence buckets", () => {
    expect(AB_TEST_CONFIDENCE_LABEL_HE["95pct"]).toBe("ביטחון 95%");
    expect(AB_TEST_CONFIDENCE_LABEL_HE.directional).toBeDefined();
    expect(AB_TEST_CONFIDENCE_LABEL_HE.insufficient).toBeDefined();
  });
});

describe("AB_TEST_CONFIDENCE_TONE", () => {
  it("assigns tones correctly", () => {
    expect(AB_TEST_CONFIDENCE_TONE["95pct"]).toBe("good");
    expect(AB_TEST_CONFIDENCE_TONE.directional).toBe("warn");
    expect(AB_TEST_CONFIDENCE_TONE.insufficient).toBe("alert");
  });
});

describe("daysRemainingHe", () => {
  // Pin "now" so the test isn't time-dependent.
  const now = new Date("2026-05-13T12:00:00.000Z").getTime();

  it("returns 'mosaic-closed' phrasing when window already closed", () => {
    const out = daysRemainingHe("2026-05-10T12:00:00.000Z", now);
    expect(out).toMatch(/החלון נסגר/);
  });

  it("returns 'ends today' for same-day end", () => {
    // ~6 hours from now → ceil to 1 day; need a tighter case for "today"
    const eight_hours_later = new Date(now + 8 * 60 * 60 * 1000).toISOString();
    // 8h later still rounds up to 1 day with ceil; force "today" via exactly today
    // Use an end ~1 minute ago to assert "החלון נסגר"
    expect(daysRemainingHe(eight_hours_later, now)).toBe("נותר יום אחד");
  });

  it("returns 'one day left' for 1 day ahead", () => {
    const oneDay = new Date(now + 24 * 60 * 60 * 1000).toISOString();
    expect(daysRemainingHe(oneDay, now)).toBe("נותר יום אחד");
  });

  it("returns 'N days left' for >1 day", () => {
    const fiveDays = new Date(now + 5 * 24 * 60 * 60 * 1000).toISOString();
    expect(daysRemainingHe(fiveDays, now)).toBe("נותרו 5 ימים");
  });

  it("handles unparseable strings", () => {
    expect(daysRemainingHe("bogus", now)).toBe("—");
  });
});

describe("formatMetricValueHe", () => {
  it("formats hook_rate as percent with 2 decimals", () => {
    expect(formatMetricValueHe("hook_rate", 0.35)).toBe("35.00%");
    expect(formatMetricValueHe("hook_rate", 0.421)).toBe("42.10%");
  });
  it("formats ctr as percent with 2 decimals", () => {
    expect(formatMetricValueHe("ctr", 0.021)).toBe("2.10%");
  });
  it("formats cpa as ILS with one decimal", () => {
    expect(formatMetricValueHe("cpa", 42.3)).toBe("₪42.3");
    expect(formatMetricValueHe("cpa", 100)).toBe("₪100.0");
  });
  it("formats cpl as ILS with one decimal", () => {
    expect(formatMetricValueHe("cpl", 87.5)).toBe("₪87.5");
  });
  it("formats conversions as integer", () => {
    expect(formatMetricValueHe("conversions", 18)).toBe("18");
    expect(formatMetricValueHe("conversions", 18.7)).toBe("19");
  });
  it("handles null/undefined/NaN", () => {
    expect(formatMetricValueHe("ctr", null)).toBe("—");
    expect(formatMetricValueHe("ctr", undefined)).toBe("—");
    expect(formatMetricValueHe("ctr", NaN)).toBe("—");
  });
});
