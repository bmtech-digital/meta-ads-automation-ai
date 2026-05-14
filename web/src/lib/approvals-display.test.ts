import { describe, it, expect } from "vitest";
import {
  humanExecutionRows,
  humanImpactRows,
  humanPayloadRows,
} from "./approvals-display";

describe("humanExecutionRows", () => {
  it("returns [] for null", () => {
    expect(humanExecutionRows(null)).toEqual([]);
  });

  it("formats a budget-update result", () => {
    const rows = humanExecutionRows({
      id: "123456",
      type: "campaign",
      daily_budget_usd: 10,
      daily_budget_agorot: 3600,
    });
    const keys = rows.map((r) => r.key);
    expect(keys).toEqual([
      "id",
      "type",
      "daily_budget_usd",
      "daily_budget_agorot",
    ]);
    const idRow = rows.find((r) => r.key === "id");
    expect(idRow?.isId).toBe(true);
    expect(idRow?.value).toBe("123456");
    expect(rows.find((r) => r.key === "daily_budget_usd")?.value).toBe("10");
  });

  it("formats a status-update result", () => {
    const rows = humanExecutionRows({
      id: "c1",
      type: "campaign",
      status: "PAUSED",
    });
    expect(rows.map((r) => r.key)).toEqual(["id", "type", "status"]);
    expect(rows.find((r) => r.key === "status")?.label).toBe("סטטוס חדש");
  });

  it("flags errors with isError=true", () => {
    const rows = humanExecutionRows({
      error: "Meta API: Invalid parameter",
      details: { code: 100 },
    });
    const errRow = rows.find((r) => r.key === "error");
    expect(errRow?.isError).toBe(true);
    expect(errRow?.value).toBe("Meta API: Invalid parameter");
    const detailsRow = rows.find((r) => r.key === "details");
    expect(detailsRow?.value).toBe(`{"code":100}`);
  });

  it("hides already_executed noise field", () => {
    const rows = humanExecutionRows({
      id: "c1",
      already_executed: true,
    });
    expect(rows.find((r) => r.key === "already_executed")).toBeUndefined();
    expect(rows).toHaveLength(1);
  });

  it("marks *_id fields as isId", () => {
    const rows = humanExecutionRows({
      campaign_id: "123",
      adset_id: "456",
      ad_id: "789",
      creative_id: "abc",
    });
    expect(rows.every((r) => r.isId === true)).toBe(true);
  });

  it("skips null/undefined values", () => {
    const rows = humanExecutionRows({
      id: "c1",
      details: null,
      status: undefined as unknown as string,
    });
    expect(rows.map((r) => r.key)).toEqual(["id"]);
  });
});

describe("humanPayloadRows — new_creative plain Hebrew", () => {
  // The agent emits raw enum tokens (MESSAGE_PAGE, stories, emotion, ...) that
  // are unreadable to a non-technical business owner. The formatter is the
  // single place that turns those into plain Hebrew before reaching the UI.
  it("translates new_creative payload labels and enum values", () => {
    const rows = humanPayloadRows({
      angle: "comparison",
      cta: "MESSAGE_PAGE",
      placement: "stories",
      headline: "שיחה אחת — כיוון ברור",
      description: "ואטסאפ ל-Aiweon",
      primary_text: "מותג? AI יכול להציע משפיענים. נדבר.",
    });
    const byKey = Object.fromEntries(rows.map((r) => [r.key, r]));
    expect(byKey.angle.label).toBe("סגנון/זווית הפנייה");
    expect(byKey.angle.value).toBe("השוואה");
    expect(byKey.cta.label).toBe("כפתור פעולה");
    expect(byKey.cta.value).toBe("שלח הודעה לעמוד");
    expect(byKey.placement.label).toBe("היכן יוצג");
    expect(byKey.placement.value).toBe("סטוריז");
    expect(byKey.headline.label).toBe("כותרת");
    expect(byKey.primary_text.label).toBe("טקסט ראשי");
    // Free-text fields keep their original Hebrew copy unchanged.
    expect(byKey.headline.value).toBe("שיחה אחת — כיוון ברור");
  });

  it("hides internal-state fields from the operator view", () => {
    const rows = humanPayloadRows({
      headline: "ok",
      model_tier: "fast",
      image_status: "to_be_generated",
      image_url: "http://x",
      aspect_ratio: "9:16",
    });
    const keys = rows.map((r) => r.key);
    expect(keys).toEqual(["headline"]);
  });
});

describe("humanImpactRows — case-insensitive keys + value translation", () => {
  it("translates lowercase expected_* keys for new_creative", () => {
    const rows = humanImpactRows({
      expected_placement_coverage_change: "adds_stories_reels",
      expected_cpm_floor_reduction_pct: 15,
    });
    const byLabel = Object.fromEntries(rows.map((r) => [r.label, r]));
    expect(
      byLabel["שינוי במיקומים שבהם המודעה מופיעה"]?.value,
    ).toBe("מוסיף סטוריז וריילז");
    expect(
      byLabel["ירידה צפויה במחיר חשיפה מינימלי"]?.value,
    ).toBe("+15%");
  });

  it("humanizes unknown keys instead of leaving raw snake_case", () => {
    const rows = humanImpactRows({ some_new_metric_pct: 7 });
    expect(rows[0].label).toBe("some new metric pct");
  });
});
