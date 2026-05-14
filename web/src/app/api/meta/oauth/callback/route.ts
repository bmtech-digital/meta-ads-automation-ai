import { NextResponse } from "next/server";
import {
  ACTIVE_BUSINESS_COOKIE,
  ACTIVE_BUSINESS_COOKIE_OPTIONS,
} from "@/lib/active-business";
import { encryptToken, verifyOAuthState } from "@/lib/crypto";
import { getDataClient } from "@/lib/db";
import {
  isMetaAppConfigured,
  loadMetaAppConfig,
  oauthRedirectUri,
} from "@/lib/meta-app-config";
import {
  debugToken,
  exchangeCodeForToken,
  extendToLongLivedToken,
  getGrantedScopes,
  getInstagramAccountForPage,
  getMe,
  getMyAdAccounts,
  getMyPages,
  getOwnedInstagramAccounts,
  MetaGraphError,
} from "@/lib/meta-graph";

/**
 * GET /api/meta/oauth/callback
 *
 * The browser lands here after the user authorizes (or declines) at Meta.
 *
 * Steps:
 *   1. Validate state — HMAC signature + DB single-use row.
 *   2. Handle decline: `?error=...` from Meta → redirect to /integrations with error.
 *   3. Exchange code → short-lived token → long-lived token.
 *   4. `debug_token` to confirm validity + read expiry server-side.
 *   5. `GET /me` for meta_user_id + name.
 *   6. `GET /me/permissions` for granted scopes.
 *   7. `GET /me?fields=granular_scopes` for per-asset grants.
 *   8. `GET /me/accounts` for Pages + Page tokens.
 *   9. `GET /me/adaccounts` for ad accounts + roles.
 *  10. For each page, fetch the linked IG business account (via Page token).
 *  11. Encrypt all tokens, persist `meta_connections` + assets.
 *  12. Redirect to /integrations?connected=1.
 *
 * Failure modes redirect to /integrations with a query-string error so the
 * UI can render a Hebrew explanation.
 */
export async function GET(req: Request): Promise<NextResponse> {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const oauthError = url.searchParams.get("error");
  const oauthErrorReason = url.searchParams.get("error_reason");

  if (oauthError) {
    return redirectToIntegrations(req, {
      error: oauthErrorReason ?? oauthError,
    });
  }
  if (!code || !state) {
    return redirectToIntegrations(req, { error: "missing_code_or_state" });
  }

  // 1. Verify state — signature first (cheap, no DB).
  let statePayload: {
    app_user_id: string;
    business_id: string;
    nonce: string;
    ts: number;
  };
  try {
    statePayload = verifyOAuthState(state);
  } catch {
    return redirectToIntegrations(req, { error: "invalid_state" });
  }
  if (Date.now() - statePayload.ts > 10 * 60 * 1000) {
    return redirectToIntegrations(req, { error: "expired_state" });
  }

  // 2. Consume the DB row (single-use). Returns null if already consumed or expired.
  const db = getDataClient();
  const consumed = await db.consumeOAuthState(state);
  if (!consumed) {
    return redirectToIntegrations(req, { error: "state_already_used" });
  }
  if (consumed.business_id !== statePayload.business_id) {
    // Defense in depth: payload and DB row must agree.
    return redirectToIntegrations(req, { error: "state_business_mismatch" });
  }

  let config;
  try {
    config = loadMetaAppConfig();
  } catch (e) {
    return redirectToIntegrations(req, {
      error: e instanceof Error ? e.message : "meta_config_error",
    });
  }

  // 3-4. Token exchange + introspection.
  try {
    const short = await exchangeCodeForToken({
      appId: config.appId,
      appSecret: config.appSecret,
      redirectUri: oauthRedirectUri(config),
      code,
    });
    const long = await extendToLongLivedToken({
      appId: config.appId,
      appSecret: config.appSecret,
      shortLivedToken: short.token,
    });
    const debug = await debugToken({
      appId: config.appId,
      appSecret: config.appSecret,
      inputToken: long.token,
    });
    if (!debug.isValid) {
      return redirectToIntegrations(req, { error: "debug_token_invalid" });
    }

    // 5-6. Identity + scopes. Granular scopes come from the debug_token
    // response (Meta v21 dropped granular_scopes as a /me field).
    const [me, grantedScopes] = await Promise.all([
      getMe(long.token),
      getGrantedScopes(long.token),
    ]);
    const granularScopes = debug.granularScopes;

    // 8-9. Assets — best-effort. A failure on one Graph endpoint shouldn't
    // lose the whole connection. The user can re-sync later from the UI.
    const [pagesResult, adAccountsResult] = await Promise.allSettled([
      getMyPages(long.token),
      getMyAdAccounts(long.token),
    ]);
    const pages = pagesResult.status === "fulfilled" ? pagesResult.value : [];
    const adAccounts =
      adAccountsResult.status === "fulfilled" ? adAccountsResult.value : [];
    if (pagesResult.status === "rejected") {
      console.warn(
        `[oauth.callback] getMyPages failed: ${
          pagesResult.reason instanceof Error
            ? pagesResult.reason.message
            : "unknown"
        }`,
      );
    }
    if (adAccountsResult.status === "rejected") {
      console.warn(
        `[oauth.callback] getMyAdAccounts failed: ${
          adAccountsResult.reason instanceof Error
            ? adAccountsResult.reason.message
            : "unknown"
        }`,
      );
    }

    // 11. Persist connection first so we have a connection_id for assets.
    const tokenExpiresIso = debug.expiresAtMs
      ? new Date(debug.expiresAtMs).toISOString()
      : long.expiresAt
        ? new Date(long.expiresAt).toISOString()
        : null;

    const connection = await db.upsertConnection({
      business_id: statePayload.business_id,
      meta_user_id: me.id,
      meta_user_name: me.name,
      long_lived_token_encrypted: encryptToken(long.token),
      token_expires_at: tokenExpiresIso,
      granted_scopes: grantedScopes,
      granular_scopes: granularScopes,
      status: "active",
      connected_by_user_id: statePayload.app_user_id,
    });

    // 10 + 11. Pages → IG resolution per page → persist.
    const pageRows = await Promise.all(
      pages.map((p) =>
        db.upsertPage({
          connection_id: connection.id,
          page_id: p.id,
          page_name: p.name,
          page_access_token_encrypted: encryptToken(p.access_token),
          category: p.category,
          tasks: p.tasks,
          business_id_meta: p.business_id,
        }),
      ),
    );

    // IG discovery — Page-linked path (per-page → instagram_business_account).
    await Promise.all(
      pages.map(async (p, idx) => {
        try {
          const ig = await getInstagramAccountForPage({
            pageId: p.id,
            pageAccessToken: p.access_token,
          });
          if (ig) {
            await db.upsertIgAccount({
              connection_id: connection.id,
              ig_user_id: ig.ig_user_id,
              username: ig.username,
              linked_page_id: pageRows[idx].id,
              business_id_meta: pages[idx].business_id,
            });
          }
        } catch (e) {
          console.warn(
            `[oauth.callback] IG resolution failed for page ${p.id}: ${
              e instanceof Error ? e.message : "unknown"
            }`,
          );
        }
      }),
    );

    // IG discovery — BM-owned path (per-BM → owned_instagram_accounts).
    // Catches IGs that exist in a BM but aren't linked to any Page our user
    // has admin access to. Required for cases like a brand running 2 IG
    // handles under the same BM where only one is connected to a Page.
    const bmIds = new Set<string>();
    for (const a of adAccounts) if (a.business_id) bmIds.add(a.business_id);
    for (const p of pages) if (p.business_id) bmIds.add(p.business_id);
    const bmOwnedLists = await Promise.all(
      Array.from(bmIds).map((bmId) =>
        getOwnedInstagramAccounts({ bmId, userToken: long.token }),
      ),
    );
    for (const list of bmOwnedLists) {
      for (const ig of list) {
        await db.upsertIgAccount({
          connection_id: connection.id,
          ig_user_id: ig.ig_user_id,
          username: ig.username,
          linked_page_id: null,
          business_id_meta: ig.business_id,
        });
      }
    }

    // Ad accounts.
    const adRows = await Promise.all(
      adAccounts.map((a) =>
        db.upsertAdAccount({
          connection_id: connection.id,
          ad_account_id: a.id,
          account_name: a.name,
          currency: a.currency,
          timezone_name: a.timezone_name,
          user_role: a.user_role,
          business_id_meta: a.business_id,
        }),
      ),
    );

    // Auto-provision: one `businesses` row per discovered ad account, so the
    // operator can switch between client accounts from the nav dropdown.
    // Idempotent — `createBusinessForAdAccount` upserts on ad_account_id.
    // Tracks which one to land on after the redirect: prefer the originating
    // business (the one the operator was already in), falling back to the
    // first auto-provisioned row.
    const provisioned = await Promise.all(
      adAccounts.map((a) =>
        db.createBusinessForAdAccount({
          ad_account_id: a.id,
          name: a.name ?? a.id,
          timezone: a.timezone_name,
        }),
      ),
    );

    // Mirror the connection's token expiry + auth_mode onto every business
    // that shares this OAuth (the originating row + every auto-provisioned
    // one). Without this, the dashboard token banner reads
    // `business.meta_access_token_expires_at` and shows "לא חובר עדיין" for
    // every business except the one the OAuth was originally tied to —
    // misleading since they all share the same connection.
    const businessesToFlip = new Set<string>([
      statePayload.business_id,
      ...provisioned.map((b) => b.id),
    ]);
    await Promise.all(
      Array.from(businessesToFlip).map((id) =>
        db.setBusinessAuthInfo(id, {
          auth_mode: "user_token",
          access_token_expires_at: tokenExpiresIso,
        }),
      ),
    );

    let landingBusinessId = statePayload.business_id;
    const originatingStillInList = provisioned.some(
      (b) => b.id === landingBusinessId,
    );
    if (!originatingStillInList && provisioned[0]) {
      landingBusinessId = provisioned[0].id;
    }

    const res = redirectToIntegrations(req, { connected: "1" });
    res.cookies.set(
      ACTIVE_BUSINESS_COOKIE,
      landingBusinessId,
      ACTIVE_BUSINESS_COOKIE_OPTIONS,
    );
    return res;
  } catch (e) {
    const msg =
      e instanceof MetaGraphError
        ? `graph_${e.code ?? "unknown"}_${e.type ?? "Unknown"}`
        : e instanceof Error
          ? e.message
          : "unknown";
    console.error(`[oauth.callback] failure for ${statePayload.business_id}:`, e);
    return redirectToIntegrations(req, { error: msg });
  }
}

function redirectToIntegrations(
  req: Request,
  params: Record<string, string>,
): NextResponse {
  // META_PUBLIC_ORIGIN is the host-visible origin (e.g. http://localhost:3100).
  // `req.url.origin` is the container-internal origin (http://localhost:3000)
  // when running in Docker — using it sends the browser to a port that isn't
  // exposed on the host. Prefer the configured public origin when available.
  let origin: string;
  if (isMetaAppConfigured()) {
    origin = loadMetaAppConfig().publicOrigin;
  } else {
    origin = new URL(req.url).origin;
  }
  const qs = new URLSearchParams(params).toString();
  return NextResponse.redirect(`${origin}/integrations?${qs}`, 303);
}
