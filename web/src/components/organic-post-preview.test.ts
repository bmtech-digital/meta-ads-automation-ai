import { describe, it, expect } from "vitest";
import { isPublishTaskType } from "./organic-post-preview";

describe("isPublishTaskType", () => {
  it.each([
    "publish_fb_post",
    "publish_ig_post",
    "publish_ig_story",
    "publish_ig_reel",
  ])("recognizes %s", (taskType) => {
    expect(isPublishTaskType(taskType)).toBe(true);
  });

  it.each([
    "new_campaign",
    "new_creative",
    "scale_up",
    "verify_pixel_capi",
    "budget_change",
    "",
    "publish_tiktok_post",
  ])("rejects non-publish task type %s", (taskType) => {
    expect(isPublishTaskType(taskType)).toBe(false);
  });
});
