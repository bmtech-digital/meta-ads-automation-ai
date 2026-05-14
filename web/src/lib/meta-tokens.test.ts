import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  _resetCryptoCache,
  encryptToken,
} from "./crypto";
import {
  MetaConnectionExpired,
  MetaConnectionRequired,
  getTokenForBusiness,
  tryGetTokenForBusiness,
} from "./meta-tokens";
import type {
  Business,
  DataClient,
  MetaConnectionRow,
} from "./db/types";

const TEST_KEY = Buffer.alloc(32, 7).toString("base64");

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

function mkConnection(overrides: Partial<MetaConnectionRow> = {}): MetaConnectionRow {
  return {
    id: "c1",
    business_id: "b1",
    meta_user_id: "mu1",
    meta_user_name: "Test User",
    long_lived_token_encrypted: encryptToken("active-user-token-xyz"),
    token_expires_at: "2099-01-01T00:00:00Z",
    granted_scopes: ["public_profile"],
    granular_scopes: [],
    status: "active",
    last_health_check_at: null,
    connected_by_user_id: null,
    external_crm_ref: null,
    created_at: "2026-05-01T00:00:00Z",
    updated_at: "2026-05-01T00:00:00Z",
    ...overrides,
  };
}

function mkDb(
  overrides: Partial<DataClient> = {},
): DataClient {
  // Build a stub satisfying DataClient — every method that isn't overridden
  // is a placeholder that would fail loudly if called. The resolver only
  // touches getActiveConnectionForBusiness, so that's the one we wire.
  const unused = (() => {
    throw new Error("unexpected DataClient call in test");
  }) as never;
  return {
    mode: "local-postgres",
    getBusinessById: unused as DataClient["getBusinessById"],
    getFirstBusiness: unused as DataClient["getFirstBusiness"],
    updateBusinessSettings: unused as DataClient["updateBusinessSettings"],
    updateBusinessProfile: unused as DataClient["updateBusinessProfile"],
    updateSeasonalHints: unused as DataClient["updateSeasonalHints"],
    getLatestBudgetHealthDecision:
      unused as DataClient["getLatestBudgetHealthDecision"],
    getBusinessKnowledge: unused as DataClient["getBusinessKnowledge"],
    upsertBusinessKnowledge: unused as DataClient["upsertBusinessKnowledge"],
    setPrimaryKpi: unused as DataClient["setPrimaryKpi"],
    getLatestHeartbeats: unused as DataClient["getLatestHeartbeats"],
    listPendingApprovals: unused as DataClient["listPendingApprovals"],
    getApprovalById: unused as DataClient["getApprovalById"],
    createPromotionApproval: unused as DataClient["createPromotionApproval"],
    listDecisionsForApproval: unused as DataClient["listDecisionsForApproval"],
    listDecisionsForRun: unused as DataClient["listDecisionsForRun"],
    approveApproval: unused as DataClient["approveApproval"],
    rejectApproval: unused as DataClient["rejectApproval"],
    unapproveApproval: unused as DataClient["unapproveApproval"],
    listHistory: unused as DataClient["listHistory"],
    listAgentActivity: unused as DataClient["listAgentActivity"],
    listGalleryAssets: unused as DataClient["listGalleryAssets"],
    getGalleryAssetById: unused as DataClient["getGalleryAssetById"],
    createGalleryAsset: unused as DataClient["createGalleryAsset"],
    softDeleteGalleryAsset: unused as DataClient["softDeleteGalleryAsset"],
    getActiveConnectionForBusiness: unused as DataClient["getActiveConnectionForBusiness"],
    findConnectionsByMetaUserId: unused as DataClient["findConnectionsByMetaUserId"],
    getConnectionWithAssets: unused as DataClient["getConnectionWithAssets"],
    upsertConnection: unused as DataClient["upsertConnection"],
    markConnectionRevoked: unused as DataClient["markConnectionRevoked"],
    refreshConnectionToken: unused as DataClient["refreshConnectionToken"],
    upsertPage: unused as DataClient["upsertPage"],
    upsertIgAccount: unused as DataClient["upsertIgAccount"],
    upsertAdAccount: unused as DataClient["upsertAdAccount"],
    setSelectedPage: unused as DataClient["setSelectedPage"],
    setIgAccountSelected: unused as DataClient["setIgAccountSelected"],
    createPixelVerificationApproval: unused as DataClient["createPixelVerificationApproval"],
    markTrackingVerified: unused as DataClient["markTrackingVerified"],
    setKpiTarget: unused as DataClient["setKpiTarget"],
    setMonthlyBrief: unused as DataClient["setMonthlyBrief"],
    getLatestKpiResearch: unused as DataClient["getLatestKpiResearch"],
    setSelectedAdAccount: unused as DataClient["setSelectedAdAccount"],
    setBusinessMetaIds: unused as DataClient["setBusinessMetaIds"],
    setBusinessAuthInfo: unused as DataClient["setBusinessAuthInfo"],
    listBusinesses: unused as DataClient["listBusinesses"],
    findBusinessByAdAccountId: unused as DataClient["findBusinessByAdAccountId"],
    createBusinessForAdAccount: unused as DataClient["createBusinessForAdAccount"],
    getConnectionByAdAccountId: unused as DataClient["getConnectionByAdAccountId"],
    autofillBusinessKnowledge: unused as DataClient["autofillBusinessKnowledge"],
    insertOAuthState: unused as DataClient["insertOAuthState"],
    consumeOAuthState: unused as DataClient["consumeOAuthState"],
    recordMetaApiCall: unused as DataClient["recordMetaApiCall"],
    setAgentMode: unused as DataClient["setAgentMode"],
    getMonthlyReport: unused as DataClient["getMonthlyReport"],
    listReportableMonths: unused as DataClient["listReportableMonths"],
    listAbTests: unused as DataClient["listAbTests"],
    getAbTestById: unused as DataClient["getAbTestById"],
    listAudiences: unused as DataClient["listAudiences"],
    setAudienceServiceTag: unused as DataClient["setAudienceServiceTag"],
    getAudienceFlowStatus: unused as DataClient["getAudienceFlowStatus"],
    listLeads: unused as DataClient["listLeads"],
    gradeLead: unused as DataClient["gradeLead"],
    listActivePlans: unused as DataClient["listActivePlans"],
    ping: unused as DataClient["ping"],
    ...overrides,
  };
}

beforeEach(() => {
  process.env.META_ENCRYPTION_KEY_BASE64 = TEST_KEY;
  _resetCryptoCache();
});

describe("OAuth token resolution", () => {
  it("decrypts the active connection token", async () => {
    const conn = mkConnection();
    const db = mkDb({
      getConnectionByAdAccountId: vi.fn().mockResolvedValue(conn),
    });
    const result = await getTokenForBusiness(
      db,
      mkBusiness({ meta_auth_mode: "user_token" }),
    );
    expect(result.token).toBe("active-user-token-xyz");
    expect(result.source).toBe("user_token");
    expect(result.connection?.id).toBe("c1");
  });

  it("throws MetaConnectionRequired when no active connection", async () => {
    const db = mkDb({
      getConnectionByAdAccountId: vi.fn().mockResolvedValue(null),
    });
    await expect(
      getTokenForBusiness(db, mkBusiness({ meta_auth_mode: "user_token" })),
    ).rejects.toBeInstanceOf(MetaConnectionRequired);
  });

  it("throws MetaConnectionRequired when connection is revoked", async () => {
    const conn = mkConnection({ status: "revoked" });
    const db = mkDb({
      getConnectionByAdAccountId: vi.fn().mockResolvedValue(conn),
    });
    await expect(
      getTokenForBusiness(db, mkBusiness({ meta_auth_mode: "user_token" })),
    ).rejects.toBeInstanceOf(MetaConnectionRequired);
  });

  it("throws MetaConnectionExpired when token_expires_at is in the past", async () => {
    const conn = mkConnection({ token_expires_at: "2020-01-01T00:00:00Z" });
    const db = mkDb({
      getConnectionByAdAccountId: vi.fn().mockResolvedValue(conn),
    });
    await expect(
      getTokenForBusiness(db, mkBusiness({ meta_auth_mode: "user_token" })),
    ).rejects.toBeInstanceOf(MetaConnectionExpired);
  });

  it("accepts a null token_expires_at (treated as no expiry)", async () => {
    const conn = mkConnection({ token_expires_at: null });
    const db = mkDb({
      getConnectionByAdAccountId: vi.fn().mockResolvedValue(conn),
    });
    const result = await getTokenForBusiness(
      db,
      mkBusiness({ meta_auth_mode: "user_token" }),
    );
    expect(result.token).toBe("active-user-token-xyz");
  });
});

describe("tryGetTokenForBusiness", () => {
  it("returns null on any failure", async () => {
    const db = mkDb({
      getConnectionByAdAccountId: vi.fn().mockResolvedValue(null),
    });
    const result = await tryGetTokenForBusiness(
      db,
      mkBusiness({ meta_auth_mode: "user_token" }),
    );
    expect(result).toBeNull();
  });

  it("returns the token on success", async () => {
    const conn = mkConnection();
    const db = mkDb({
      getConnectionByAdAccountId: vi.fn().mockResolvedValue(conn),
    });
    const result = await tryGetTokenForBusiness(
      db,
      mkBusiness({ meta_auth_mode: "user_token" }),
    );
    expect(result?.token).toBe("active-user-token-xyz");
  });
});
