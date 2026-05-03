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
  updateBusinessSettings: async () => notImplemented("updateBusinessSettings"),
  updateSeasonalHints: async () => notImplemented("updateSeasonalHints"),
  getLatestBudgetHealthDecision: async () => notImplemented("getLatestBudgetHealthDecision"),
  getBusinessKnowledge: async () => notImplemented("getBusinessKnowledge"),
  upsertBusinessKnowledge: async () => notImplemented("upsertBusinessKnowledge"),
  setPrimaryKpi: async () => notImplemented("setPrimaryKpi"),
  getLatestHeartbeats: async () => notImplemented("getLatestHeartbeats"),
  listPendingApprovals: async () => notImplemented("listPendingApprovals"),
  getApprovalById: async () => notImplemented("getApprovalById"),
  listDecisionsForApproval: async () => notImplemented("listDecisionsForApproval"),
  listDecisionsForRun: async () => notImplemented("listDecisionsForRun"),
  approveApproval: async () => notImplemented("approveApproval"),
  rejectApproval: async () => notImplemented("rejectApproval"),
  unapproveApproval: async () => notImplemented("unapproveApproval"),
  listHistory: async () => notImplemented("listHistory"),
  listGalleryAssets: async () => notImplemented("listGalleryAssets"),
  getGalleryAssetById: async () => notImplemented("getGalleryAssetById"),
  createGalleryAsset: async () => notImplemented("createGalleryAsset"),
  softDeleteGalleryAsset: async () => notImplemented("softDeleteGalleryAsset"),
  ping: async () => notImplemented("ping"),
};
