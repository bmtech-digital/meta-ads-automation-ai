import { describe, it, expect } from "vitest";
import { humanExecutionRows } from "./approvals-display";

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
    expect(keys).toEqual(["id", "type", "daily_budget_usd", "daily_budget_agorot"]);
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
