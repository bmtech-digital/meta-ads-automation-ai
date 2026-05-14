import "server-only";
import { decryptToken, encryptToken } from "./crypto";
import type { Business, DataClient, MetaConnectionRow } from "./db/types";
import {
  isMetaAppConfigured,
  loadMetaAppConfig,
} from "./meta-app-config";
import { extendToLongLivedToken } from "./meta-graph";

/**
 * Meta token resolver.
 *
 * Single path: the user connects via OAuth (/integrations → Connect Meta),
 * the long-lived token gets encrypted into `meta_connections`, and every Meta
 * read on the web side decrypts that row to talk to Graph.
 *
 * The legacy `META_ACCESS_TOKEN` env var path (system_user_token mode) was
 * removed from the web in favor of OAuth-only, per operator request: a
 * manually-uploaded env token is the kind of thing nobody remembers to rotate
 * and that silently goes stale 60 days later. Keeping one code path means
 * fewer ways for the dashboard to read from "the wrong token" — every Meta
 * call now uses the OAuth-discovered, operator-selected assets.
 *
 * Page Access Tokens (for Page-scoped Graph endpoints) are still resolved via
 * the existing /me/accounts derivation in `meta.ts`; once a Page Access Token
 * is cached on a `meta_pages` row it can be decrypted directly.
 */

export class MetaConnectionRequired extends Error {
  constructor(public business_id: string) {
    super(
      `business ${business_id} has no active Meta connection — operator must run /integrations → Connect Meta`,
    );
    this.name = "MetaConnectionRequired";
  }
}

export class MetaConnectionExpired extends Error {
  constructor(public business_id: string, public expiredAt: string) {
    super(
      `Meta connection for business ${business_id} expired at ${expiredAt} — re-authorization required`,
    );
    this.name = "MetaConnectionExpired";
  }
}

export interface ResolvedToken {
  /** The plaintext access token to send as `access_token=...` to Graph. */
  token: string;
  /** Kept for audit-log compatibility; always 'user_token' now. */
  source: "user_token";
  /** The OAuth connection row this token came from. */
  connection: MetaConnectionRow;
}

/** Refresh when the connection is within this window of expiry (10 days). */
const REFRESH_WINDOW_MS = 10 * 24 * 60 * 60 * 1000;

/**
 * Resolve the user-scoped OAuth token for a business. Throws specific error
 * classes so route handlers can map them to UX (reconnect CTA vs server error).
 *
 * Connection lookup is keyed by the business's `meta_ad_account_id`, not by
 * business id. Multi-business setups have one Meta OAuth handshake whose
 * `meta_ad_accounts` rows cover N businesses; the right connection for a
 * given business is the one whose ad-account list contains the business's ad
 * account.
 *
 * Auto-refresh: if the token is within ~10 days of expiry but still valid,
 * we proactively call Meta's `fb_exchange_token` to swap it for a fresh
 * long-lived one. The new token is encrypted, persisted on the connection,
 * and the expiry is mirrored onto every linked business. Operator never
 * sees a 60-day countdown drift past zero — this is the effective
 * "no manual reconnect" behavior the operator asked for.
 *
 * If refresh fails (e.g. Meta app config missing, network error), we fall
 * back to the existing token. As long as it hasn't expired yet, it still
 * works; the operator gets one more chance on the next request.
 */
export async function getTokenForBusiness(
  db: DataClient,
  business: Business,
): Promise<ResolvedToken> {
  let connection = await db.getConnectionByAdAccountId(
    business.meta_ad_account_id,
  );
  if (!connection || connection.status === "revoked") {
    throw new MetaConnectionRequired(business.id);
  }
  if (connection.token_expires_at) {
    const expMs = Date.parse(connection.token_expires_at);
    if (!Number.isNaN(expMs)) {
      if (expMs <= Date.now()) {
        // Already past expiry — refresh won't help, operator must reconnect.
        throw new MetaConnectionExpired(
          business.id,
          connection.token_expires_at,
        );
      }
      if (expMs - Date.now() < REFRESH_WINDOW_MS) {
        const currentToken = decryptToken(connection.long_lived_token_encrypted);
        const refreshed = await tryRefreshConnection(db, connection, currentToken);
        if (refreshed) connection = refreshed;
      }
    }
  }

  const token = decryptToken(connection.long_lived_token_encrypted);
  return { token, source: "user_token", connection };
}

/**
 * Best-effort token refresh. Returns the updated `MetaConnectionRow` on
 * success; `null` on any failure (logged, not thrown — the caller still has
 * a valid-until-expiry token to use).
 *
 * `fb_exchange_token` is idempotent: Meta returns the same long-lived token
 * (with a refreshed expiry) when called on an already-long-lived token, so
 * concurrent refresh calls are safe.
 */
async function tryRefreshConnection(
  db: DataClient,
  connection: MetaConnectionRow,
  currentToken: string,
): Promise<MetaConnectionRow | null> {
  if (!isMetaAppConfigured()) return null;
  try {
    const config = loadMetaAppConfig();
    const result = await extendToLongLivedToken({
      appId: config.appId,
      appSecret: config.appSecret,
      shortLivedToken: currentToken,
    });
    const newExpiresIso = result.expiresAt
      ? new Date(result.expiresAt).toISOString()
      : null;
    await db.refreshConnectionToken(connection.id, {
      long_lived_token_encrypted: encryptToken(result.token),
      token_expires_at: newExpiresIso,
    });
    return {
      ...connection,
      long_lived_token_encrypted: encryptToken(result.token),
      token_expires_at: newExpiresIso,
    };
  } catch (e) {
    console.warn(
      `[meta-tokens] proactive token refresh failed for connection ${connection.id}: ${
        e instanceof Error ? e.message : "unknown"
      }`,
    );
    return null;
  }
}

/**
 * Probe-only variant — returns null on any failure instead of throwing.
 * Useful for readiness checks where the caller just wants to know "is there
 * a usable token right now" without distinguishing failure modes.
 */
export async function tryGetTokenForBusiness(
  db: DataClient,
  business: Business,
): Promise<ResolvedToken | null> {
  try {
    return await getTokenForBusiness(db, business);
  } catch {
    return null;
  }
}
