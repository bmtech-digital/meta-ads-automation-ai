import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { META_GRAPH_BASE } from "./meta-app-config";

/**
 * Graph API client for **OAuth-time** calls — token exchange, asset discovery,
 * permission inspection. Separate from `meta.ts` (which is used at request
 * time with a resolved business token) because:
 *
 *   - Different token sources (here we have a freshly-exchanged token, not a
 *     stored one)
 *   - Different error semantics (here token errors during exchange should
 *     bubble as 4xx to the user; in meta.ts they're 500 to the agent)
 *   - Different observability needs (every call here is a one-shot during
 *     connect, vs meta.ts which is per-page-load)
 *
 * All functions return *raw* Graph shapes — the route handlers Zod-validate
 * via `schemas/meta-connection.ts` before persisting.
 */

export class MetaGraphError extends Error {
  constructor(
    message: string,
    public code?: number,
    public type?: string,
    public subcode?: number,
    public fbtraceId?: string,
  ) {
    super(message);
    this.name = "MetaGraphError";
  }
}

interface MetaErrorEnvelope {
  message: string;
  code: number;
  type: string;
  error_subcode?: number;
  fbtrace_id?: string;
}

async function graphGet<T>(
  path: string,
  params: Record<string, string>,
  signal?: AbortSignal,
): Promise<T> {
  const qp = new URLSearchParams(params);
  const url = `${META_GRAPH_BASE}/${path}?${qp.toString()}`;
  const res = await fetch(url, { cache: "no-store", signal });
  const body = (await res.json()) as
    | (T & { error?: MetaErrorEnvelope })
    | { error: MetaErrorEnvelope };
  const errObj = (body as { error?: MetaErrorEnvelope }).error;
  if (!res.ok || errObj) {
    const e = errObj ?? {
      message: `HTTP ${res.status}`,
      code: res.status,
      type: "Unknown",
    };
    throw new MetaGraphError(
      e.message,
      e.code,
      e.type,
      e.error_subcode,
      e.fbtrace_id,
    );
  }
  return body as T;
}

// ---- Token exchange -------------------------------------------------------

interface TokenExchangeResponse {
  access_token: string;
  token_type: string;
  expires_in?: number;
}

/**
 * Exchange the `code` from the OAuth callback for a **short-lived** user
 * access token. Validity: ~1 hour.
 */
export async function exchangeCodeForToken(input: {
  appId: string;
  appSecret: string;
  redirectUri: string;
  code: string;
}): Promise<{ token: string; expiresAt: number | null }> {
  const out = await graphGet<TokenExchangeResponse>("oauth/access_token", {
    client_id: input.appId,
    client_secret: input.appSecret,
    redirect_uri: input.redirectUri,
    code: input.code,
  });
  return {
    token: out.access_token,
    expiresAt: out.expires_in ? Date.now() + out.expires_in * 1000 : null,
  };
}

/**
 * Extend a short-lived token to a **long-lived** one (~60 days). Per Meta
 * docs, this exchange is idempotent: calling it on an already-long-lived
 * token returns the same token with the existing expiry. Safe to call.
 */
export async function extendToLongLivedToken(input: {
  appId: string;
  appSecret: string;
  shortLivedToken: string;
}): Promise<{ token: string; expiresAt: number | null }> {
  const out = await graphGet<TokenExchangeResponse>("oauth/access_token", {
    grant_type: "fb_exchange_token",
    client_id: input.appId,
    client_secret: input.appSecret,
    fb_exchange_token: input.shortLivedToken,
  });
  return {
    token: out.access_token,
    expiresAt: out.expires_in ? Date.now() + out.expires_in * 1000 : null,
  };
}

// ---- Token introspection --------------------------------------------------

interface DebugTokenResponse {
  data: {
    app_id: string;
    is_valid: boolean;
    expires_at: number;
    data_access_expires_at?: number;
    scopes?: string[];
    user_id?: string;
    // granular_scopes is returned ON THE DEBUG_TOKEN RESPONSE — not on /me as
    // I originally assumed. Meta v21 rejects `fields=granular_scopes` on /me
    // with "nonexisting field" (#100). The canonical surface is here.
    granular_scopes?: Array<{ scope: string; target_ids?: string[] }>;
  };
}

export interface DebugTokenInfo {
  appId: string;
  userId: string | null;
  isValid: boolean;
  expiresAtMs: number | null;
  dataAccessExpiresAtMs: number | null;
  scopes: string[];
  granularScopes: Array<{ scope: string; target_ids?: string[] }>;
}

/**
 * Call `/debug_token` with the App's access token (`appId|appSecret`) to
 * validate a user token + read its expiry + scopes server-side. More
 * trustworthy than asking the user's token about itself.
 */
export async function debugToken(input: {
  appId: string;
  appSecret: string;
  inputToken: string;
}): Promise<DebugTokenInfo> {
  const out = await graphGet<DebugTokenResponse>("debug_token", {
    input_token: input.inputToken,
    access_token: `${input.appId}|${input.appSecret}`,
  });
  return {
    appId: out.data.app_id,
    userId: out.data.user_id ?? null,
    isValid: out.data.is_valid,
    expiresAtMs: out.data.expires_at ? out.data.expires_at * 1000 : null,
    dataAccessExpiresAtMs: out.data.data_access_expires_at
      ? out.data.data_access_expires_at * 1000
      : null,
    scopes: out.data.scopes ?? [],
    granularScopes: out.data.granular_scopes ?? [],
  };
}

// ---- User profile + permissions -------------------------------------------

export interface MetaMe {
  id: string;
  name: string | null;
}

export async function getMe(token: string): Promise<MetaMe> {
  const out = await graphGet<{ id: string; name?: string }>("me", {
    fields: "id,name",
    access_token: token,
  });
  return { id: out.id, name: out.name ?? null };
}

interface PermissionsResponse {
  data: Array<{
    permission: string;
    status: "granted" | "declined" | "expired";
  }>;
}

export async function getGrantedScopes(token: string): Promise<string[]> {
  const out = await graphGet<PermissionsResponse>("me/permissions", {
    access_token: token,
  });
  return out.data
    .filter((p) => p.status === "granted")
    .map((p) => p.permission);
}

/**
 * Granular scopes used to be obtainable as a field on /me, but Meta v21 no
 * longer exposes that path — querying `fields=granular_scopes` returns
 * "(#100) Tried accessing nonexisting field". The canonical source today is
 * the `debug_token` response's `granular_scopes` array. Use
 * `debugToken(...)` and read `granularScopes` from the result instead.
 *
 * This stub kept here so older callers fail at compile time with a clear
 * message rather than at runtime against Meta's API.
 */
export async function getGranularScopes(): Promise<never> {
  throw new MetaGraphError(
    "getGranularScopes is removed — read granular_scopes from debugToken() response instead",
  );
}

// ---- Assets ---------------------------------------------------------------

export interface MetaPageDiscovery {
  id: string;
  name: string;
  access_token: string;
  category: string | null;
  tasks: string[];
  /** BM id that owns this Page; null when personal/unknown. Used for filtering by selected ad account. */
  business_id: string | null;
}

/**
 * List the Pages the user is admin of, with each Page's long-lived
 * **Page Access Token**. Page tokens derived from a long-lived user token
 * are themselves non-expiring.
 *
 * `business{id}` returns the Business Manager that owns the Page (when one
 * does). The UI uses this to filter Pages by the selected Ad Account's BM.
 */
export async function getMyPages(token: string): Promise<MetaPageDiscovery[]> {
  const out = await graphGet<{
    data: Array<{
      id: string;
      name: string;
      access_token: string;
      category?: string;
      tasks?: string[];
      business?: { id: string };
    }>;
  }>("me/accounts", {
    fields: "id,name,access_token,category,tasks,business",
    limit: "200",
    access_token: token,
  });
  return out.data.map((p) => ({
    id: p.id,
    name: p.name,
    access_token: p.access_token,
    category: p.category ?? null,
    tasks: p.tasks ?? [],
    business_id: p.business?.id ?? null,
  }));
}

export interface MetaAdAccountDiscovery {
  id: string;
  name: string | null;
  currency: string | null;
  timezone_name: string | null;
  /**
   * Numeric user_role is deprecated by Meta (error #12 since ~v18). Modern
   * Marketing API exposes roles via `tasks` — string array like
   * ["ANALYZE", "ADVERTISE", "MANAGE"]. We translate to a numeric code
   * compatible with the capability layer:
   *   1 = MANAGE (admin write)
   *   2 = ADVERTISE (campaign write)
   *   3 = ANALYZE (read-only)
   *   null = unknown / no tasks returned
   */
  user_role: number | null;
  tasks: string[];
  business_id: string | null;
}

function tasksToRole(tasks: string[]): number | null {
  if (tasks.includes("MANAGE")) return 1;
  if (tasks.includes("ADVERTISE")) return 2;
  if (tasks.includes("ANALYZE")) return 3;
  return null;
}

export async function getMyAdAccounts(
  token: string,
): Promise<MetaAdAccountDiscovery[]> {
  const out = await graphGet<{
    data: Array<{
      id: string;
      name?: string;
      currency?: string;
      timezone_name?: string;
      // AdAccount exposes the current user's roles under `user_tasks`. The
      // older `tasks` field on AdAccount returns empty in modern Graph; the
      // `tasks` name is for Page objects, not AdAccount.
      user_tasks?: string[];
      business?: { id: string };
    }>;
  }>("me/adaccounts", {
    fields: "id,name,currency,timezone_name,user_tasks,business",
    limit: "200",
    access_token: token,
  });
  return out.data.map((a) => {
    const tasks = a.user_tasks ?? [];
    return {
      id: a.id,
      name: a.name ?? null,
      currency: a.currency ?? null,
      timezone_name: a.timezone_name ?? null,
      user_role: tasksToRole(tasks),
      tasks,
      business_id: a.business?.id ?? null,
    };
  });
}

// ---- Account-level spend (budget utilization) -------------------------

export interface MetaAccountSpend {
  /** ILS as a JS number — we accept floating-point arithmetic for ~₪ values; precision isn't load-bearing for budget decisions. */
  spend_this_month: number;
  /** Number of campaigns with status='ACTIVE' that contributed to spend. Helps the
   *  recommendation engine distinguish "no campaigns at all" from "campaigns
   *  exist but spent nothing." */
  active_campaign_count: number;
  /** Currency code as Meta returns it (typically the ad account's currency). */
  currency: string | null;
}

/**
 * Pull MTD spend + active-campaign count for an ad account in a single
 * insights call. We deliberately use `date_preset=this_month` (Meta-side
 * calendar boundary) instead of computing days locally — the ad account's
 * own timezone determines what "this month" means for spend.
 *
 * Account-level insights (`level=account`) summarize across all campaigns.
 * For the active-campaign count we make a second small request to
 * `/{ad_account}/campaigns?effective_status=["ACTIVE"]` — cheap.
 */
export async function getAdAccountSpendThisMonth(input: {
  adAccountId: string;
  userToken: string;
}): Promise<MetaAccountSpend> {
  const [insightsRes, campaignsRes] = await Promise.allSettled([
    graphGet<{
      data: Array<{ spend?: string; account_currency?: string }>;
    }>(`${input.adAccountId}/insights`, {
      level: "account",
      fields: "spend,account_currency",
      date_preset: "this_month",
      access_token: input.userToken,
    }),
    graphGet<{
      data: Array<{ id: string; effective_status?: string }>;
    }>(`${input.adAccountId}/campaigns`, {
      // effective_status is a filter list; passing it as JSON string is how
      // Graph wants it. ACTIVE means "currently spending or capable of."
      effective_status: '["ACTIVE"]',
      fields: "id,effective_status",
      limit: "200",
      access_token: input.userToken,
    }),
  ]);
  const insightsRow =
    insightsRes.status === "fulfilled" ? insightsRes.value.data[0] : undefined;
  const activeCount =
    campaignsRes.status === "fulfilled"
      ? campaignsRes.value.data.length
      : 0;
  return {
    spend_this_month: insightsRow?.spend ? Number(insightsRow.spend) : 0,
    active_campaign_count: activeCount,
    currency: insightsRow?.account_currency ?? null,
  };
}

// ---- Pixel discovery (Day-Zero / verifyPixelCAPI) ---------------------

export interface MetaPixelDiscovery {
  pixel_id: string;
  name: string | null;
  /** ISO timestamp of the last event Meta recorded. Null if pixel never fired. */
  last_fired_time: string | null;
  /** Hours since last event; null when never fired. Used to grade freshness. */
  hours_since_last_fired: number | null;
  data_use_setting: string | null;
  owner_business_id: string | null;
  owner_business_name: string | null;
  is_unavailable: boolean;
}

/**
 * Fetch all pixels attached to an ad account. Used by the
 * verifyPixelCAPI capability — surfaces the list to the human, who confirms
 * Pixel/CAPI/AEM/domain are all set up before flipping `tracking_verified`.
 *
 * We deliberately don't query `/{pixel}/stats` (high latency, rate-limited,
 * surface complexity not warranted for v1). Last-fired-time is the
 * single signal most diagnostic of "is this pixel actually receiving traffic."
 *
 * Requires `ads_read` scope and Advertiser+ role on the ad account.
 */
export async function getPixelsForAdAccount(input: {
  adAccountId: string;
  userToken: string;
}): Promise<MetaPixelDiscovery[]> {
  const out = await graphGet<{
    data: Array<{
      id: string;
      name?: string;
      last_fired_time?: string;
      data_use_setting?: string;
      owner_business?: { id: string; name?: string };
      is_unavailable?: boolean;
    }>;
  }>(`${input.adAccountId}/adspixels`, {
    fields:
      "id,name,last_fired_time,data_use_setting,owner_business{id,name},is_unavailable",
    limit: "50",
    access_token: input.userToken,
  });
  const nowMs = Date.now();
  return out.data.map((p) => {
    const lastFired = p.last_fired_time ?? null;
    const hours = lastFired
      ? Math.round((nowMs - Date.parse(lastFired)) / 3600000)
      : null;
    return {
      pixel_id: p.id,
      name: p.name ?? null,
      last_fired_time: lastFired,
      hours_since_last_fired: hours,
      data_use_setting: p.data_use_setting ?? null,
      owner_business_id: p.owner_business?.id ?? null,
      owner_business_name: p.owner_business?.name ?? null,
      is_unavailable: p.is_unavailable ?? false,
    };
  });
}

export interface MetaPageProfile {
  id: string;
  name: string;
  about: string | null;
  description: string | null;
  website: string | null;
  category: string | null;
  /** Location bag — Meta returns city, country, etc. We surface country for
   *  service_regions inference; the rest is informational. */
  country: string | null;
  city: string | null;
  phone: string | null;
}

/**
 * Fetch a Page's public profile. Used to auto-fill `business_knowledge`
 * (website, location hints, category) when the operator connects/syncs
 * — saves a lot of typing. Requires `pages_show_list` + a Page Access
 * Token.
 *
 * We only request fields we'd actually surface; Meta returns a lot more
 * on this endpoint if asked, but most of it isn't actionable for an
 * onboarding auto-fill.
 */
export async function getPageProfile(input: {
  pageId: string;
  pageAccessToken: string;
}): Promise<MetaPageProfile | null> {
  try {
    const out = await graphGet<{
      id: string;
      name: string;
      about?: string;
      description?: string;
      website?: string;
      category?: string;
      location?: {
        city?: string;
        country?: string;
      };
      phone?: string;
    }>(input.pageId, {
      fields: "id,name,about,description,website,category,location,phone",
      access_token: input.pageAccessToken,
    });
    return {
      id: out.id,
      name: out.name,
      about: out.about ?? null,
      description: out.description ?? null,
      website: out.website ?? null,
      category: out.category ?? null,
      country: out.location?.country ?? null,
      city: out.location?.city ?? null,
      phone: out.phone ?? null,
    };
  } catch (e) {
    console.warn(
      `[meta.getPageProfile] page=${input.pageId} failed: ${
        e instanceof Error ? e.message : "unknown"
      }`,
    );
    return null;
  }
}

export interface MetaIgDiscovery {
  ig_user_id: string;
  username: string | null;
}

export interface MetaBmOwnedIg {
  ig_user_id: string;
  username: string | null;
  business_id: string;
}

/**
 * Enumerate all Instagram business accounts **owned by a Business Manager**.
 * Required because some IGs are BM-owned but not linked to a Facebook Page —
 * the per-Page discovery path (`getInstagramAccountForPage`) misses them.
 *
 * Requires `business_management` scope on the user token. The BM must be one
 * the user has access to.
 *
 * Returns [] on failure (best-effort) so a single BM's failure doesn't block
 * the rest of the sync.
 */
export async function getOwnedInstagramAccounts(input: {
  bmId: string;
  userToken: string;
}): Promise<MetaBmOwnedIg[]> {
  // Try both the legacy ("owned_instagram_accounts") and the newer
  // ("instagram_business_accounts") edges — Meta exposes both, and which one
  // returns useful data depends on how the assets were originally added to
  // the BM. Dedupe by id.
  const seen = new Map<string, MetaBmOwnedIg>();

  for (const edge of ["owned_instagram_accounts", "instagram_business_accounts"]) {
    try {
      const out = await graphGet<{
        data: Array<{ id: string; username?: string }>;
      }>(`${input.bmId}/${edge}`, {
        fields: "id,username",
        limit: "200",
        access_token: input.userToken,
      });
      const got = out.data ?? [];
      console.log(
        `[meta.getOwnedInstagramAccounts] bm=${input.bmId} edge=${edge} returned ${got.length} IGs`,
      );
      for (const ig of got) {
        if (!seen.has(ig.id)) {
          seen.set(ig.id, {
            ig_user_id: ig.id,
            username: ig.username ?? null,
            business_id: input.bmId,
          });
        }
      }
    } catch (e) {
      console.warn(
        `[meta.getOwnedInstagramAccounts] bm=${input.bmId} edge=${edge} failed: ${
          e instanceof Error ? e.message : "unknown"
        }`,
      );
    }
  }
  return Array.from(seen.values());
}

/**
 * Resolve the Instagram business account linked to a Page. Uses the
 * **Page Access Token** because `instagram_business_account` returns
 * empty when called with the User Access Token (Graph #210 family).
 */
export async function getInstagramAccountForPage(input: {
  pageId: string;
  pageAccessToken: string;
}): Promise<MetaIgDiscovery | null> {
  const out = await graphGet<{
    instagram_business_account?: { id: string; username?: string };
  }>(input.pageId, {
    fields: "instagram_business_account{id,username}",
    access_token: input.pageAccessToken,
  });
  if (!out.instagram_business_account) return null;
  return {
    ig_user_id: out.instagram_business_account.id,
    username: out.instagram_business_account.username ?? null,
  };
}

// ---- Webhook signed_request validation ------------------------------------

/**
 * Parse and validate Meta's `signed_request` payload (used by deauthorize +
 * data-deletion webhooks). Format: `base64url(hmac).base64url(json)`.
 *
 * HMAC is computed over the JSON-encoded portion with the App Secret as key.
 * Spec: https://developers.facebook.com/docs/facebook-login/guides/advanced/oidc-token
 *
 * Returns the parsed payload (`user_id`, `algorithm`, `issued_at`, etc.) on
 * success. Throws on tampering, wrong secret, or malformed input — caller
 * should map to HTTP 400.
 */
export function parseSignedRequest(
  signedRequest: string,
  appSecret: string,
): { user_id: string; issued_at: number; algorithm: string } & Record<
  string,
  unknown
> {
  const parts = signedRequest.split(".");
  if (parts.length !== 2) {
    throw new MetaGraphError("signed_request: malformed (expected sig.payload)");
  }
  const [encodedSig, encodedPayload] = parts;
  const sig = Buffer.from(encodedSig, "base64url");
  const expected = createHmac("sha256", appSecret)
    .update(encodedPayload)
    .digest();
  if (
    sig.length !== expected.length ||
    !timingSafeEqual(sig, expected)
  ) {
    throw new MetaGraphError("signed_request: signature mismatch");
  }
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(
      Buffer.from(encodedPayload, "base64url").toString("utf8"),
    );
  } catch {
    throw new MetaGraphError("signed_request: invalid JSON payload");
  }
  if (typeof payload.algorithm !== "string" || !/HMAC-SHA256/i.test(payload.algorithm)) {
    throw new MetaGraphError(
      `signed_request: unexpected algorithm ${String(payload.algorithm)}`,
    );
  }
  if (typeof payload.user_id !== "string") {
    throw new MetaGraphError("signed_request: missing user_id");
  }
  return payload as {
    user_id: string;
    issued_at: number;
    algorithm: string;
  } & Record<string, unknown>;
}
