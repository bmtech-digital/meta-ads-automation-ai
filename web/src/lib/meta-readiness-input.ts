import "server-only";
import type {
  Business,
  ConnectionWithAssets,
  BusinessKnowledge,
} from "./db/types";
import type {
  AssetSnapshot,
  ConnectionSnapshot,
  InternalDataSnapshot,
  ReadinessInput,
} from "./meta-capabilities";

/**
 * Convert raw DB rows + business knowledge into the snapshot shape
 * `checkReadiness` expects. Pure — no I/O. Lives in its own file because
 * the mapping logic is non-trivial and would clutter the page handler.
 *
 * `tracking_verified` on business_knowledge is the gate that powers the
 * `pixel_capi_verified` dimension (Day-Zero guardrail per migration 008 §2).
 * When false, publishInstagramContent + createOrUpdateMetaCampaign are
 * blocked even if scopes + roles are perfect.
 */
export function buildReadinessInput(input: {
  business: Business;
  withAssets: ConnectionWithAssets | null;
  knowledge: BusinessKnowledge | null;
}): ReadinessInput {
  const trackingVerified = input.knowledge?.tracking_verified ?? false;
  const conn = input.withAssets?.connection ?? null;

  const connectionSnapshot: ConnectionSnapshot | null = conn
    ? {
        status: conn.status,
        grantedScopes: conn.granted_scopes,
        granularScopes: conn.granular_scopes,
        tokenExpiresAtMs: conn.token_expires_at
          ? Date.parse(conn.token_expires_at)
          : null,
      }
    : null;

  const assets: AssetSnapshot[] = [];
  for (const p of input.withAssets?.pages ?? []) {
    assets.push({
      kind: "facebook_page",
      id: p.page_id,
      selected: p.selected,
      // tasks contains role strings like ["ADMIN","ADVERTISE","MODERATE",...]
      role: p.tasks,
      business_id_meta: p.business_id_meta,
    });
  }
  for (const ig of input.withAssets?.igAccounts ?? []) {
    assets.push({
      kind: "instagram_business_account",
      id: ig.ig_user_id,
      selected: ig.selected,
      role: null,
      business_id_meta: ig.business_id_meta,
    });
  }
  for (const a of input.withAssets?.adAccounts ?? []) {
    assets.push({
      kind: "ad_account",
      id: a.ad_account_id,
      selected: a.selected,
      role: a.user_role,
      business_id_meta: a.business_id_meta,
    });
  }
  // Pixel is referenced as a required asset but isn't its own DB row — we
  // surface it as "selected" when tracking_verified is true, otherwise it
  // appears as missing in the readiness report. This keeps the capability
  // layer's required_assets contract honest without forcing a meta_pixels
  // table prematurely.
  //
  // business_id_meta is inherited from the selected ad account — the pixel
  // lives in the same BM. Without this inheritance, BM-scoped granular
  // scopes like `business_management` fail their check on the synthetic
  // pixel asset (target_ids are BM ids; our pixel.id is a sentinel string,
  // not a BM id). Same fix shape as the ad_account/page/IG rows: scope
  // grants travel with BM membership.
  if (trackingVerified) {
    const selectedAd = input.withAssets?.adAccounts.find((a) => a.selected);
    assets.push({
      kind: "pixel",
      id: "tracking-verified",
      selected: true,
      role: null,
      business_id_meta: selectedAd?.business_id_meta ?? null,
    });
  }

  const internalData: InternalDataSnapshot = {
    business_profile: input.knowledge !== null,
    gallery_media: true, // gallery always exists; emptiness is handled at capability level if needed
    campaign_history: true, // Meta-derived; we don't pre-validate
    pixel_capi_verified: trackingVerified,
  };

  return {
    agentMode: input.business.agent_mode,
    connection: connectionSnapshot,
    assets,
    internalData,
  };
}
