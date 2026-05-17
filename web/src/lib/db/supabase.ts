import "server-only";
import type { DataClient } from "./types";

/**
 * Stub adapter. Activated when WEB_DB_MODE=supabase — lit up after decisions-log §1.4
 * closes on Supabase as the remote target. Shape mirrors local-postgres.ts so the
 * switch is a config change, not a refactor.
 *
 * Intentional throw: if someone flips WEB_DB_MODE=supabase before wiring this,
 * they see the failure immediately instead of falling through to a silent bug.
 */

function notImplemented(op: string): never {
  throw new Error(
    `[supabase adapter] ${op}() not implemented. ` +
      `Set WEB_DB_MODE=local-postgres, or wire @supabase/ssr here once decisions-log §1.4 resolves.`,
  );
}

export const supabaseClient: DataClient = {
  mode: "supabase",
  getBusinessById: async () => notImplemented("getBusinessById"),
  getFirstBusiness: async () => notImplemented("getFirstBusiness"),
  listBusinesses: async () => notImplemented("listBusinesses"),
  findBusinessByAdAccountId: async () =>
    notImplemented("findBusinessByAdAccountId"),
  createBusinessForAdAccount: async () =>
    notImplemented("createBusinessForAdAccount"),
  getConnectionByAdAccountId: async () =>
    notImplemented("getConnectionByAdAccountId"),
  updateBusinessSettings: async () => notImplemented("updateBusinessSettings"),
  updateBusinessProfile: async () => notImplemented("updateBusinessProfile"),
  updateSeasonalHints: async () => notImplemented("updateSeasonalHints"),
  getLatestBudgetHealthDecision: async () =>
    notImplemented("getLatestBudgetHealthDecision"),
  recordBudgetHealthSnapshot: async () =>
    notImplemented("recordBudgetHealthSnapshot"),
  getBusinessKnowledge: async () => notImplemented("getBusinessKnowledge"),
  upsertBusinessKnowledge: async () =>
    notImplemented("upsertBusinessKnowledge"),
  setPrimaryKpi: async () => notImplemented("setPrimaryKpi"),
  getLatestHeartbeats: async () => notImplemented("getLatestHeartbeats"),
  listPendingApprovals: async () => notImplemented("listPendingApprovals"),
  getApprovalById: async () => notImplemented("getApprovalById"),
  createPromotionApproval: async () =>
    notImplemented("createPromotionApproval"),
  createPixelVerificationApproval: async () =>
    notImplemented("createPixelVerificationApproval"),
  markTrackingVerified: async () => notImplemented("markTrackingVerified"),
  setKpiTarget: async () => notImplemented("setKpiTarget"),
  getLatestKpiResearch: async () => notImplemented("getLatestKpiResearch"),
  setMonthlyBrief: async () => notImplemented("setMonthlyBrief"),
  listDecisionsForApproval: async () =>
    notImplemented("listDecisionsForApproval"),
  listDecisionsForRun: async () => notImplemented("listDecisionsForRun"),
  approveApproval: async () => notImplemented("approveApproval"),
  rejectApproval: async () => notImplemented("rejectApproval"),
  unapproveApproval: async () => notImplemented("unapproveApproval"),
  answerApproval: async () => notImplemented("answerApproval"),
  getOnboardingSnapshot: async () => notImplemented("getOnboardingSnapshot"),
  beginOnboardingIfNeeded: async () =>
    notImplemented("beginOnboardingIfNeeded"),
  listHistory: async () => notImplemented("listHistory"),
  listAgentActivity: async () => notImplemented("listAgentActivity"),
  listGalleryAssets: async () => notImplemented("listGalleryAssets"),
  getGalleryAssetById: async () => notImplemented("getGalleryAssetById"),
  createGalleryAsset: async () => notImplemented("createGalleryAsset"),
  softDeleteGalleryAsset: async () => notImplemented("softDeleteGalleryAsset"),
  getActiveConnectionForBusiness: async () =>
    notImplemented("getActiveConnectionForBusiness"),
  findConnectionsByMetaUserId: async () =>
    notImplemented("findConnectionsByMetaUserId"),
  getConnectionWithAssets: async () =>
    notImplemented("getConnectionWithAssets"),
  upsertConnection: async () => notImplemented("upsertConnection"),
  markConnectionRevoked: async () => notImplemented("markConnectionRevoked"),
  refreshConnectionToken: async () => notImplemented("refreshConnectionToken"),
  upsertPage: async () => notImplemented("upsertPage"),
  upsertIgAccount: async () => notImplemented("upsertIgAccount"),
  upsertAdAccount: async () => notImplemented("upsertAdAccount"),
  setSelectedPage: async () => notImplemented("setSelectedPage"),
  setIgAccountSelected: async () => notImplemented("setIgAccountSelected"),
  setSelectedAdAccount: async () => notImplemented("setSelectedAdAccount"),
  setBusinessMetaIds: async () => notImplemented("setBusinessMetaIds"),
  setBusinessAuthInfo: async () => notImplemented("setBusinessAuthInfo"),
  autofillBusinessKnowledge: async () =>
    notImplemented("autofillBusinessKnowledge"),
  insertOAuthState: async () => notImplemented("insertOAuthState"),
  consumeOAuthState: async () => notImplemented("consumeOAuthState"),
  recordMetaApiCall: async () => notImplemented("recordMetaApiCall"),
  setAgentMode: async () => notImplemented("setAgentMode"),
  getMonthlyReport: async () => notImplemented("getMonthlyReport"),
  listReportableMonths: async () => notImplemented("listReportableMonths"),
  listAbTests: async () => notImplemented("listAbTests"),
  getAbTestById: async () => notImplemented("getAbTestById"),
  listAudiences: async () => notImplemented("listAudiences"),
  setAudienceServiceTag: async () => notImplemented("setAudienceServiceTag"),
  getAudienceFlowStatus: async () => notImplemented("getAudienceFlowStatus"),
  listLeads: async () => notImplemented("listLeads"),
  gradeLead: async () => notImplemented("gradeLead"),
  listActivePlans: async () => notImplemented("listActivePlans"),
  ping: async () => notImplemented("ping"),
};
