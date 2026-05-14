import "server-only";
import { META_SCOPE_GROUPS } from "./meta-capabilities";

/**
 * Central Meta App config — App ID/Secret + redirect URIs + per-tier scopes.
 *
 * Per `docs/plans/meta-integration-readiness.md` §5, we submit scopes in
 * 4 tiers. The OAuth `scope` parameter at tier N includes every scope from
 * tiers 1..N, because once a user authorizes scopes they stay granted for
 * subsequent re-auths — there's no penalty to asking for the full set the
 * App has been approved for.
 *
 * The "current" tier is read from env (`META_REVIEW_TIER`, default 1) so we
 * can flip from tier 1 → 2 → 3 without code change as Meta approves.
 */

const GRAPH_VERSION = "v21.0";

export const META_GRAPH_VERSION = GRAPH_VERSION;
export const META_GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;
export const META_OAUTH_DIALOG = `https://www.facebook.com/${GRAPH_VERSION}/dialog/oauth`;

export type ReviewTier = 1 | 2 | 3 | 4;

export interface MetaAppConfig {
  appId: string;
  appSecret: string;
  /** Public-facing origin (e.g. https://app.aiweon.co.il). Used to build redirect/webhook URLs. */
  publicOrigin: string;
  /** Review tier currently approved (per `decisions-log §1.12`). Drives scope set. */
  currentTier: ReviewTier;
}

/**
 * Read the Meta App config from env. Throws clear errors per missing var
 * so the operator sees what to set instead of a cryptic NaN downstream.
 */
export function loadMetaAppConfig(): MetaAppConfig {
  const appId = process.env.META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;
  const publicOrigin =
    process.env.META_PUBLIC_ORIGIN ?? process.env.NEXT_PUBLIC_APP_ORIGIN;
  // Default to Tier 3 — the App owner (Aiweon) can grant any scope to their
  // own App in dev/standard mode without App Review. Requesting Tier 1 only
  // means capabilities like publishFacebookPost + createOrUpdateMetaCampaign
  // are permanently stuck at "needs_permission". Tier 4 (WhatsApp) stays
  // opt-in because it's a separate App Review track.
  const tier = Number(process.env.META_REVIEW_TIER ?? "3");

  if (!appId)
    throw new Error("META_APP_ID is not set (App Settings → Basic in Meta Dashboard)");
  if (!appSecret)
    throw new Error(
      "META_APP_SECRET is not set — store in env locally, GCP Secret Manager in prod",
    );
  if (!publicOrigin)
    throw new Error(
      "META_PUBLIC_ORIGIN is not set — e.g. http://localhost:3100 (dev) or https://app.aiweon.co.il (prod)",
    );
  if (![1, 2, 3, 4].includes(tier))
    throw new Error(`META_REVIEW_TIER must be 1..4 (got ${tier})`);

  return {
    appId,
    appSecret,
    publicOrigin: publicOrigin.replace(/\/$/, ""),
    currentTier: tier as ReviewTier,
  };
}

/** Returns true iff all four env vars are usable. Doesn't throw — for readiness probes. */
export function isMetaAppConfigured(): boolean {
  try {
    loadMetaAppConfig();
    return true;
  } catch {
    return false;
  }
}

// ---- Redirect / webhook URLs ----------------------------------------------

export function oauthRedirectUri(config: MetaAppConfig): string {
  return `${config.publicOrigin}/api/meta/oauth/callback`;
}

export function deauthorizeCallbackUri(config: MetaAppConfig): string {
  return `${config.publicOrigin}/api/meta/deauthorize`;
}

export function dataDeletionCallbackUri(config: MetaAppConfig): string {
  return `${config.publicOrigin}/api/meta/data-deletion`;
}

// ---- Scopes per tier ------------------------------------------------------

const TIER_1_SCOPES: string[] = Array.from(
  new Set([
    ...META_SCOPE_GROUPS.base,
    ...META_SCOPE_GROUPS.facebookPagesRead,
    ...META_SCOPE_GROUPS.instagramBasic,
    ...META_SCOPE_GROUPS.instagramInsights,
    ...META_SCOPE_GROUPS.adsRead,
    "business_management",
  ]),
);

const TIER_2_SCOPES: string[] = Array.from(
  new Set([
    ...TIER_1_SCOPES,
    ...META_SCOPE_GROUPS.facebookPublish,
    ...META_SCOPE_GROUPS.instagramPublish,
  ]),
);

const TIER_3_SCOPES: string[] = Array.from(
  new Set([...TIER_2_SCOPES, ...META_SCOPE_GROUPS.adsManage]),
);

const TIER_4_SCOPES: string[] = Array.from(
  new Set([...TIER_3_SCOPES, ...META_SCOPE_GROUPS.whatsappFuture]),
);

const SCOPES_BY_TIER: Record<ReviewTier, string[]> = {
  1: TIER_1_SCOPES,
  2: TIER_2_SCOPES,
  3: TIER_3_SCOPES,
  4: TIER_4_SCOPES,
};

/** Scopes to request at the OAuth dialog for the current tier. Includes all lower tiers. */
export function scopesForTier(tier: ReviewTier): string[] {
  return SCOPES_BY_TIER[tier];
}

export function scopeStringForTier(tier: ReviewTier): string {
  return scopesForTier(tier).join(",");
}
