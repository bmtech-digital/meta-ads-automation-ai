/**
 * Meta capability layer — per `docs/plans/meta-integration-readiness.md` §3.
 *
 * Pure module. No Graph calls, no DB calls. Imports nothing from `meta.ts`.
 * Takes a snapshot of a connection + selected assets + business mode and
 * returns a readiness verdict per capability.
 *
 * This is the single source of truth for "can the agent do X right now?"
 * Every Meta-touching code path (web route, agent tool, UI badge) must
 * consult `checkReadiness` rather than re-deriving the answer from raw scopes.
 *
 * Three reasons readiness is more than "has the scope":
 *   1. Granular scopes — Meta lets users grant a scope for some assets and
 *      decline for others. `pages_show_list` for one page only isn't enough
 *      if the agent needs the *selected* page.
 *   2. Asset-level role — `ads_management` granted ≠ user has Advertiser
 *      role on the selected ad account. Both must hold.
 *   3. Agent mode gates — even if scope+role are fine, an `insight`-mode
 *      business cannot trigger a write capability. Mode > scope.
 */

export type AgentMode = "insight" | "draft" | "action";
export type AssetKind =
  | "facebook_page"
  | "instagram_business_account"
  | "ad_account"
  | "pixel";
export type InternalDataKind =
  | "business_profile"
  | "gallery_media"
  | "campaign_history";
export type TokenType = "user" | "page";

export type CapabilityId =
  | "connectMetaAccount"
  | "listFacebookPages"
  | "readInstagramBusinessAccount"
  | "readPageInsights"
  | "readInstagramInsights"
  | "readAdsPerformance"
  | "verifyPixelCAPI"
  | "prepareCampaignDraft"
  | "publishFacebookPost"
  | "publishInstagramContent"
  | "createOrUpdateMetaCampaign"
  | "whatsappMessagingFuture";

export const META_SCOPE_GROUPS = {
  base: ["public_profile", "email"],
  facebookPagesRead: ["pages_show_list", "pages_read_engagement"],
  facebookPagesManage: ["pages_manage_metadata"],
  facebookPublish: ["pages_manage_posts"],
  instagramBasic: [
    "instagram_basic",
    "pages_show_list",
    "pages_read_engagement",
  ],
  instagramPublish: ["instagram_content_publish"],
  instagramInsights: ["instagram_manage_insights"],
  adsRead: ["ads_read"],
  adsManage: ["ads_management", "business_management"],
  whatsappFuture: [
    "whatsapp_business_management",
    "whatsapp_business_messaging",
    "business_management",
  ],
} as const;

export interface CapabilitySpec {
  requiredScopes: string[];
  requiredAssets: AssetKind[];
  requiredInternalData?: InternalDataKind[];
  modes: AgentMode[];
  requiresUserApproval: boolean;
  tokenType: TokenType;
  /** App Review submission tier (1..4) or null if no Meta scope is needed. */
  metaAppReviewTier: 1 | 2 | 3 | 4 | null;
  /** Other capabilities that must also be ready before this one is usable. */
  blockedBy?: CapabilityId[];
  /** UI label (Hebrew). Kept here so the capability surface is one file. */
  label: string;
}

export const META_CAPABILITIES: Record<CapabilityId, CapabilitySpec> = {
  connectMetaAccount: {
    requiredScopes: [...META_SCOPE_GROUPS.base],
    requiredAssets: [],
    modes: ["insight", "draft", "action"],
    requiresUserApproval: false,
    tokenType: "user",
    metaAppReviewTier: 1,
    label: "חיבור חשבון Meta",
  },
  listFacebookPages: {
    requiredScopes: [...META_SCOPE_GROUPS.facebookPagesRead],
    requiredAssets: ["facebook_page"],
    modes: ["insight", "draft", "action"],
    requiresUserApproval: false,
    tokenType: "user",
    metaAppReviewTier: 1,
    label: "קריאת רשימת דפים",
  },
  readInstagramBusinessAccount: {
    requiredScopes: [...META_SCOPE_GROUPS.instagramBasic],
    requiredAssets: ["instagram_business_account"],
    modes: ["insight", "draft", "action"],
    requiresUserApproval: false,
    tokenType: "page",
    metaAppReviewTier: 1,
    label: "חיבור חשבון Instagram עסקי",
  },
  readPageInsights: {
    requiredScopes: [...META_SCOPE_GROUPS.facebookPagesRead],
    requiredAssets: ["facebook_page"],
    modes: ["insight", "draft", "action"],
    requiresUserApproval: false,
    tokenType: "page",
    metaAppReviewTier: 1,
    label: "תובנות דף Facebook",
  },
  readInstagramInsights: {
    requiredScopes: [
      ...META_SCOPE_GROUPS.instagramBasic,
      ...META_SCOPE_GROUPS.instagramInsights,
    ],
    requiredAssets: ["instagram_business_account"],
    modes: ["insight", "draft", "action"],
    requiresUserApproval: false,
    tokenType: "page",
    metaAppReviewTier: 1,
    label: "תובנות Instagram",
  },
  readAdsPerformance: {
    requiredScopes: [...META_SCOPE_GROUPS.adsRead],
    requiredAssets: ["ad_account"],
    modes: ["insight", "draft", "action"],
    requiresUserApproval: false,
    tokenType: "user",
    metaAppReviewTier: 1,
    label: "קריאת ביצועי מודעות",
  },
  verifyPixelCAPI: {
    requiredScopes: [...META_SCOPE_GROUPS.adsRead, "business_management"],
    requiredAssets: ["ad_account", "pixel"],
    modes: ["insight", "draft", "action"],
    requiresUserApproval: false,
    tokenType: "user",
    metaAppReviewTier: 1,
    label: "אימות Pixel + CAPI",
  },
  prepareCampaignDraft: {
    // Reads campaign history from Meta + internal data. Honest about the
    // ads_read dependency (the original plan had requiredScopes:[] which was
    // wrong — without history the draft is blind).
    requiredScopes: [...META_SCOPE_GROUPS.adsRead],
    requiredAssets: ["ad_account"],
    requiredInternalData: [
      "business_profile",
      "gallery_media",
      "campaign_history",
    ],
    modes: ["draft", "action"],
    requiresUserApproval: true,
    tokenType: "user",
    metaAppReviewTier: 1,
    label: "טיוטת קמפיין",
  },
  publishFacebookPost: {
    requiredScopes: [...META_SCOPE_GROUPS.facebookPublish],
    requiredAssets: ["facebook_page"],
    modes: ["action"],
    requiresUserApproval: true,
    tokenType: "page",
    metaAppReviewTier: 2,
    label: "פרסום פוסט בפייסבוק",
  },
  publishInstagramContent: {
    requiredScopes: [...META_SCOPE_GROUPS.instagramPublish],
    requiredAssets: ["instagram_business_account"],
    modes: ["action"],
    requiresUserApproval: true,
    tokenType: "page",
    metaAppReviewTier: 2,
    blockedBy: ["verifyPixelCAPI"],
    label: "פרסום ב-Instagram",
  },
  createOrUpdateMetaCampaign: {
    requiredScopes: [...META_SCOPE_GROUPS.adsManage],
    requiredAssets: ["ad_account"],
    modes: ["action"],
    requiresUserApproval: true,
    tokenType: "user",
    metaAppReviewTier: 3,
    blockedBy: ["verifyPixelCAPI"],
    label: "יצירה/עדכון קמפיין במנהל המודעות",
  },
  whatsappMessagingFuture: {
    requiredScopes: [...META_SCOPE_GROUPS.whatsappFuture],
    requiredAssets: [],
    modes: [],
    requiresUserApproval: true,
    tokenType: "user",
    metaAppReviewTier: 4,
    label: "WhatsApp (עתידי)",
  },
};

// ---- Readiness check ---------------------------------------------------

export type ReadinessStatus =
  | "ready"
  | "needs_permission"
  | "needs_asset"
  | "needs_role"
  | "needs_internal_data"
  | "wrong_mode"
  | "blocked"
  | "expired"
  | "revoked"
  | "future_only";

export interface ReadinessReport {
  capability: CapabilityId;
  status: ReadinessStatus;
  missingScopes: string[];
  missingAssets: AssetKind[];
  missingInternalData: InternalDataKind[];
  reason: string;
  blockedByCapabilities?: CapabilityId[];
}

/**
 * One granular_scopes row as Meta returns it from /me?fields=granular_scopes.
 * `target_ids` is absent when the scope is granted globally (no per-asset
 * restriction); present (possibly empty) when the user limited it.
 */
export interface GranularScope {
  scope: string;
  target_ids?: string[];
}

export interface ConnectionSnapshot {
  status: "active" | "partial" | "expired" | "revoked";
  /** All scopes granted at user level. */
  grantedScopes: string[];
  /** Per-asset overrides; if a scope appears here, it's restricted to the listed ids. */
  granularScopes: GranularScope[];
  /** Unix ms; null/0 means no expiry (system_user_token). */
  tokenExpiresAtMs: number | null;
}

export interface AssetSnapshot {
  kind: AssetKind;
  id: string;
  selected: boolean;
  /**
   * For ad_account: 1=Admin, 2=Advertiser, 3=Analyst (Meta's user_role).
   * For facebook_page: an array of tasks like ["ADMIN","ADVERTISE",...].
   * For instagram_business_account / pixel: null (role inherited from page/ad_account).
   */
  role?: number | string[] | null;
  /**
   * BM id that owns this asset (null for personal / unowned). Used by the
   * granular-scope check: scopes like `business_management` are granted with
   * `target_ids` as BM ids, so checking the asset's BM membership against
   * those target_ids is the only correct way to detect "scope granted for
   * this asset's BM."
   */
  business_id_meta?: string | null;
}

export interface InternalDataSnapshot {
  business_profile: boolean;
  gallery_media: boolean;
  campaign_history: boolean;
  /** Whether tracking_verified flips green per business_knowledge (Day-Zero guardrail). */
  pixel_capi_verified: boolean;
}

export interface ReadinessInput {
  agentMode: AgentMode;
  /** OAuth connection snapshot; null before the operator clicks Connect Meta. */
  connection: ConnectionSnapshot | null;
  assets: AssetSnapshot[];
  internalData: InternalDataSnapshot;
  /** Current time injected for tests. */
  nowMs?: number;
}

/** A user_role on ad_account is sufficient at Advertiser (2) or Admin (1). Analyst (3) is read-only. */
const AD_ACCOUNT_WRITE_ROLES = new Set([1, 2]);

function hasGrantedScope(
  conn: ConnectionSnapshot,
  scope: string,
  selectedAssets: AssetSnapshot[],
): boolean {
  if (!conn.grantedScopes.includes(scope)) return false;
  // If the user limited this scope to specific targets, the selected assets
  // must all be in that target set. No selected assets + granular scope means
  // "ready in principle, no asset to act on" — handled by the missingAssets
  // dimension, not here.
  const granular = conn.granularScopes.find((g) => g.scope === scope);
  if (!granular || !granular.target_ids) return true;
  if (selectedAssets.length === 0) return true;
  const targets = granular.target_ids;
  // Meta's granular scope `target_ids` are the entity IDs the scope was
  // granted FOR. The entity kind depends on the scope: `pages_*` → page ids,
  // `instagram_*` → IG ids, ad scopes → ad-account ids, `business_management`
  // → BM ids. Our `AssetSnapshot.id` is the asset's own id, and
  // `business_id_meta` is its owning BM. Accept a match on either — covers
  // both entity-scoped and BM-scoped grants without needing per-scope
  // knowledge of which id-kind Meta returns.
  return selectedAssets.every((asset) => {
    if (targets.includes(asset.id)) return true;
    if (asset.business_id_meta && targets.includes(asset.business_id_meta)) {
      return true;
    }
    return false;
  });
}

function selectedAssetsForKinds(
  assets: AssetSnapshot[],
  kinds: AssetKind[],
): AssetSnapshot[] {
  return assets.filter((a) => kinds.includes(a.kind) && a.selected);
}

function assetRoleSufficient(asset: AssetSnapshot, kind: AssetKind): boolean {
  if (kind === "ad_account") {
    return (
      typeof asset.role === "number" && AD_ACCOUNT_WRITE_ROLES.has(asset.role)
    );
  }
  if (kind === "facebook_page") {
    if (!Array.isArray(asset.role)) return false;
    return asset.role.includes("ADMIN") || asset.role.includes("MANAGE");
  }
  // IG + pixel inherit from the linked page/ad_account; if the row exists,
  // role is sufficient.
  return true;
}

export function checkCapability(
  capabilityId: CapabilityId,
  input: ReadinessInput,
): ReadinessReport {
  const spec = META_CAPABILITIES[capabilityId];
  const report: ReadinessReport = {
    capability: capabilityId,
    status: "ready",
    missingScopes: [],
    missingAssets: [],
    missingInternalData: [],
    reason: "",
  };

  // 0. WhatsApp etc — declared but not implemented.
  if (spec.modes.length === 0) {
    report.status = "future_only";
    report.reason = "יכולת עתידית — לא זמינה כרגע";
    return report;
  }

  // 1. Mode gate (cheapest, fail fast).
  if (!spec.modes.includes(input.agentMode)) {
    report.status = "wrong_mode";
    report.reason = `דורש מצב ${spec.modes.join("/")} (כרגע: ${input.agentMode})`;
    return report;
  }

  // 2. Token state — OAuth is the only path now.
  const now = input.nowMs ?? Date.now();
  if (!input.connection || input.connection.status === "revoked") {
    report.status = "revoked";
    report.reason = "אין חיבור פעיל ל-Meta — לחץ \"התחבר ל-Meta\" ב-/integrations";
    return report;
  }
  if (
    input.connection.tokenExpiresAtMs &&
    input.connection.tokenExpiresAtMs <= now
  ) {
    report.status = "expired";
    report.reason = "הטוקן פג — נדרש חיבור מחדש";
    return report;
  }

  // 3. Asset presence (selected=true rows for each required kind).
  for (const kind of spec.requiredAssets) {
    const selected = input.assets.filter(
      (a) => a.kind === kind && a.selected,
    );
    if (selected.length === 0) {
      report.missingAssets.push(kind);
    }
  }
  if (report.missingAssets.length > 0) {
    report.status = "needs_asset";
    report.reason = `חסר נכס: ${report.missingAssets.join(", ")}`;
    return report;
  }

  // 4. Asset-level role.
  for (const kind of spec.requiredAssets) {
    const selected = input.assets.find((a) => a.kind === kind && a.selected);
    if (selected && !assetRoleSufficient(selected, kind)) {
      report.status = "needs_role";
      report.reason = `אין הרשאת ניהול על ${kind} שנבחר`;
      return report;
    }
  }

  // 5. Scope check (granular-aware).
  const relevantAssets = selectedAssetsForKinds(
    input.assets,
    spec.requiredAssets,
  );
  for (const scope of spec.requiredScopes) {
    if (!hasGrantedScope(input.connection, scope, relevantAssets)) {
      report.missingScopes.push(scope);
    }
  }
  if (report.missingScopes.length > 0) {
    report.status = "needs_permission";
    report.reason = `חסרות הרשאות: ${report.missingScopes.join(", ")}`;
    return report;
  }

  // 6. Internal data.
  for (const dataKind of spec.requiredInternalData ?? []) {
    if (!input.internalData[dataKind]) {
      report.missingInternalData.push(dataKind);
    }
  }
  if (report.missingInternalData.length > 0) {
    report.status = "needs_internal_data";
    report.reason = `חסר מידע פנימי: ${report.missingInternalData.join(", ")}`;
    return report;
  }

  // 7. Blocked-by chain.
  if (spec.blockedBy && spec.blockedBy.length > 0) {
    // verifyPixelCAPI uses internalData.pixel_capi_verified as its sentinel —
    // a dedicated short-circuit so the blockedBy chain doesn't need to
    // recursively call checkCapability for the most common gate.
    if (spec.blockedBy.includes("verifyPixelCAPI")) {
      if (!input.internalData.pixel_capi_verified) {
        report.status = "blocked";
        report.blockedByCapabilities = ["verifyPixelCAPI"];
        report.reason = "Pixel/CAPI לא מאומתים — Day-Zero guardrail חוסם";
        return report;
      }
    }
  }

  // 8. Partial connection status — token works but some scopes/assets are off.
  if (input.connection.status === "partial") {
    // If we got here, the specific scopes/assets this capability needs are
    // present even though the connection overall is partial. That's fine —
    // partial means "some other capability is degraded", not this one.
  }

  report.status = "ready";
  report.reason = "מוכן";
  return report;
}

/**
 * Run checkCapability across all capabilities. Returns a map keyed by
 * CapabilityId so the UI can iterate or pluck specific entries.
 */
export function checkReadiness(
  input: ReadinessInput,
): Record<CapabilityId, ReadinessReport> {
  const out = {} as Record<CapabilityId, ReadinessReport>;
  for (const id of Object.keys(META_CAPABILITIES) as CapabilityId[]) {
    out[id] = checkCapability(id, input);
  }
  return out;
}

/**
 * Reduce a readiness map to the Hebrew status badges shown in the
 * `/integrations` dashboard. Distinct from `checkReadiness` so the UI doesn't
 * import status enums directly.
 */
export function readinessSummary(
  reports: Record<CapabilityId, ReadinessReport>,
): {
  ready: CapabilityId[];
  needsAttention: Array<{ id: CapabilityId; status: ReadinessStatus; reason: string }>;
  futureOnly: CapabilityId[];
} {
  const ready: CapabilityId[] = [];
  const needsAttention: Array<{
    id: CapabilityId;
    status: ReadinessStatus;
    reason: string;
  }> = [];
  const futureOnly: CapabilityId[] = [];

  for (const id of Object.keys(reports) as CapabilityId[]) {
    const r = reports[id];
    if (r.status === "ready") {
      ready.push(id);
    } else if (r.status === "future_only") {
      futureOnly.push(id);
    } else {
      needsAttention.push({ id, status: r.status, reason: r.reason });
    }
  }
  return { ready, needsAttention, futureOnly };
}
