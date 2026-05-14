import { describe, it, expect } from "vitest";
import { isSetKpiTargetTask } from "./kpi-target-proposal";

describe("isSetKpiTargetTask", () => {
  it("recognizes set_kpi_target", () => {
    expect(isSetKpiTargetTask("set_kpi_target")).toBe(true);
  });

  it.each([
    "publish_fb_post",
    "new_campaign",
    "verify_pixel_capi",
    "budget_change",
    "",
    "set_kpi_targets", // close but no
  ])("rejects %s", (taskType) => {
    expect(isSetKpiTargetTask(taskType)).toBe(false);
  });
});
