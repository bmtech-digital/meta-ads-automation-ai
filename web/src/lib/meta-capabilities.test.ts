import { describe, it, expect } from "vitest";
import {
  checkCapability,
  checkReadiness,
  readinessSummary,
  META_CAPABILITIES,
  META_SCOPE_GROUPS,
  type ReadinessInput,
  type AssetSnapshot,
  type ConnectionSnapshot,
  type InternalDataSnapshot,
} from "./meta-capabilities";

const NOW = new Date("2026-05-11T12:00:00Z").getTime();

function fullScopes(): string[] {
  return [
    ...META_SCOPE_GROUPS.base,
    ...META_SCOPE_GROUPS.facebookPagesRead,
    ...META_SCOPE_GROUPS.facebookPagesManage,
    ...META_SCOPE_GROUPS.facebookPublish,
    ...META_SCOPE_GROUPS.instagramBasic,
    ...META_SCOPE_GROUPS.instagramPublish,
    ...META_SCOPE_GROUPS.instagramInsights,
    ...META_SCOPE_GROUPS.adsRead,
    ...META_SCOPE_GROUPS.adsManage,
  ];
}

function mkConnection(
  overrides: Partial<ConnectionSnapshot> = {},
): ConnectionSnapshot {
  return {
    status: "active",
    grantedScopes: fullScopes(),
    granularScopes: [],
    tokenExpiresAtMs: NOW + 30 * 24 * 60 * 60 * 1000,
    ...overrides,
  };
}

function mkAssets(): AssetSnapshot[] {
  return [
    {
      kind: "facebook_page",
      id: "page-123",
      selected: true,
      role: ["ADMIN", "ADVERTISE"],
    },
    {
      kind: "instagram_business_account",
      id: "ig-456",
      selected: true,
      role: null,
    },
    { kind: "ad_account", id: "act_789", selected: true, role: 1 },
    { kind: "pixel", id: "pixel-1", selected: true, role: null },
  ];
}

function mkInternal(
  overrides: Partial<InternalDataSnapshot> = {},
): InternalDataSnapshot {
  return {
    business_profile: true,
    gallery_media: true,
    campaign_history: true,
    pixel_capi_verified: true,
    ...overrides,
  };
}

function mkInput(overrides: Partial<ReadinessInput> = {}): ReadinessInput {
  return {
    agentMode: "action",
    connection: mkConnection(),
    assets: mkAssets(),
    internalData: mkInternal(),
    nowMs: NOW,
    ...overrides,
  };
}

describe("checkCapability — mode gate (fail fast)", () => {
  it("blocks publish in insight mode", () => {
    const r = checkCapability(
      "publishInstagramContent",
      mkInput({ agentMode: "insight" }),
    );
    expect(r.status).toBe("wrong_mode");
  });
  it("allows readAdsPerformance in all modes", () => {
    for (const mode of ["insight", "draft", "action"] as const) {
      const r = checkCapability("readAdsPerformance", mkInput({ agentMode: mode }));
      expect(r.status).toBe("ready");
    }
  });
  it("blocks prepareCampaignDraft in insight mode (draft-only)", () => {
    const r = checkCapability(
      "prepareCampaignDraft",
      mkInput({ agentMode: "insight" }),
    );
    expect(r.status).toBe("wrong_mode");
  });
});

describe("checkCapability — token state", () => {
  it("flags expired token as expired", () => {
    const r = checkCapability(
      "readAdsPerformance",
      mkInput({
        connection: mkConnection({ tokenExpiresAtMs: NOW - 1 }),
      }),
    );
    expect(r.status).toBe("expired");
  });

  it("flags revoked connection", () => {
    const r = checkCapability(
      "readAdsPerformance",
      mkInput({ connection: mkConnection({ status: "revoked" }) }),
    );
    expect(r.status).toBe("revoked");
  });

  it("flags missing connection (no OAuth yet) as revoked", () => {
    const r = checkCapability(
      "readAdsPerformance",
      mkInput({ connection: null }),
    );
    expect(r.status).toBe("revoked");
  });
});

describe("checkCapability — asset presence + role", () => {
  it("flags missing facebook_page for publishFacebookPost", () => {
    const assets = mkAssets().filter((a) => a.kind !== "facebook_page");
    const r = checkCapability("publishFacebookPost", mkInput({ assets }));
    expect(r.status).toBe("needs_asset");
    expect(r.missingAssets).toContain("facebook_page");
  });

  it("flags insufficient role on ad_account (Analyst = 3)", () => {
    const assets = mkAssets().map((a) =>
      a.kind === "ad_account" ? { ...a, role: 3 } : a,
    );
    const r = checkCapability("createOrUpdateMetaCampaign", mkInput({ assets }));
    expect(r.status).toBe("needs_role");
  });

  it("accepts Advertiser role (2) on ad_account", () => {
    const assets = mkAssets().map((a) =>
      a.kind === "ad_account" ? { ...a, role: 2 } : a,
    );
    const r = checkCapability("createOrUpdateMetaCampaign", mkInput({ assets }));
    expect(r.status).toBe("ready");
  });

  it("flags facebook_page without ADMIN/MANAGE task as insufficient role", () => {
    const assets = mkAssets().map((a) =>
      a.kind === "facebook_page" ? { ...a, role: ["ANALYZE"] } : a,
    );
    const r = checkCapability("publishFacebookPost", mkInput({ assets }));
    expect(r.status).toBe("needs_role");
  });
});

describe("checkCapability — granular scopes", () => {
  it("treats unrestricted scope as granted everywhere", () => {
    const conn = mkConnection({
      // No granular entry for ads_read — means unrestricted.
      granularScopes: [{ scope: "pages_show_list", target_ids: ["other"] }],
    });
    const r = checkCapability(
      "readAdsPerformance",
      mkInput({ connection: conn }),
    );
    expect(r.status).toBe("ready");
  });

  it("rejects when granular scope excludes the selected asset", () => {
    const conn = mkConnection({
      granularScopes: [{ scope: "ads_read", target_ids: ["act_OTHER"] }],
    });
    const r = checkCapability(
      "readAdsPerformance",
      mkInput({ connection: conn }),
    );
    expect(r.status).toBe("needs_permission");
    expect(r.missingScopes).toContain("ads_read");
  });

  it("accepts when granular scope includes the selected asset", () => {
    const conn = mkConnection({
      granularScopes: [{ scope: "ads_read", target_ids: ["act_789"] }],
    });
    const r = checkCapability(
      "readAdsPerformance",
      mkInput({ connection: conn }),
    );
    expect(r.status).toBe("ready");
  });
});

describe("checkCapability — internal data + Pixel/CAPI gate", () => {
  it("prepareCampaignDraft needs business_profile/gallery_media/campaign_history", () => {
    const r = checkCapability(
      "prepareCampaignDraft",
      mkInput({
        agentMode: "draft",
        internalData: mkInternal({ business_profile: false }),
      }),
    );
    expect(r.status).toBe("needs_internal_data");
    expect(r.missingInternalData).toContain("business_profile");
  });

  it("createOrUpdateMetaCampaign is blocked when Pixel/CAPI unverified", () => {
    const r = checkCapability(
      "createOrUpdateMetaCampaign",
      mkInput({
        internalData: mkInternal({ pixel_capi_verified: false }),
      }),
    );
    expect(r.status).toBe("blocked");
    expect(r.blockedByCapabilities).toContain("verifyPixelCAPI");
  });

  it("publishInstagramContent is blocked when Pixel/CAPI unverified", () => {
    const r = checkCapability(
      "publishInstagramContent",
      mkInput({
        internalData: mkInternal({ pixel_capi_verified: false }),
      }),
    );
    expect(r.status).toBe("blocked");
  });
});

describe("checkCapability — future-only capabilities", () => {
  it("whatsappMessagingFuture is future_only regardless of input", () => {
    const r = checkCapability("whatsappMessagingFuture", mkInput());
    expect(r.status).toBe("future_only");
  });
});

describe("checkReadiness — full snapshot", () => {
  it("happy path: all green", () => {
    const all = checkReadiness(mkInput());
    expect(all.readAdsPerformance.status).toBe("ready");
    expect(all.publishFacebookPost.status).toBe("ready");
    expect(all.createOrUpdateMetaCampaign.status).toBe("ready");
    expect(all.whatsappMessagingFuture.status).toBe("future_only");
  });

  it("insight mode: writes blocked, reads green", () => {
    const all = checkReadiness(mkInput({ agentMode: "insight" }));
    expect(all.readAdsPerformance.status).toBe("ready");
    expect(all.prepareCampaignDraft.status).toBe("wrong_mode");
    expect(all.publishFacebookPost.status).toBe("wrong_mode");
    expect(all.createOrUpdateMetaCampaign.status).toBe("wrong_mode");
  });

  it("no OAuth connection: every capability flips to revoked", () => {
    const all = checkReadiness(mkInput({ connection: null }));
    expect(all.readAdsPerformance.status).toBe("revoked");
    expect(all.createOrUpdateMetaCampaign.status).toBe("revoked");
  });
});

describe("readinessSummary", () => {
  it("buckets by status", () => {
    const reports = checkReadiness(mkInput({ agentMode: "insight" }));
    const summary = readinessSummary(reports);
    expect(summary.ready).toContain("readAdsPerformance");
    expect(summary.futureOnly).toContain("whatsappMessagingFuture");
    expect(summary.needsAttention.some((n) => n.id === "publishFacebookPost")).toBe(
      true,
    );
  });
});

describe("META_CAPABILITIES — sanity", () => {
  it("every capability declares a non-empty label", () => {
    for (const id of Object.keys(META_CAPABILITIES)) {
      const spec = META_CAPABILITIES[id as keyof typeof META_CAPABILITIES];
      expect(spec.label.length).toBeGreaterThan(0);
    }
  });

  it("write capabilities require user approval", () => {
    const writes = ["publishFacebookPost", "publishInstagramContent", "createOrUpdateMetaCampaign"] as const;
    for (const id of writes) {
      expect(META_CAPABILITIES[id].requiresUserApproval).toBe(true);
    }
  });

  it("only action mode unlocks write capabilities", () => {
    const writes = ["publishFacebookPost", "publishInstagramContent", "createOrUpdateMetaCampaign"] as const;
    for (const id of writes) {
      expect(META_CAPABILITIES[id].modes).toEqual(["action"]);
    }
  });
});
