import "server-only";

const GRAPH_VERSION = "v21.0";
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;

export class MetaApiError extends Error {
  constructor(
    message: string,
    public code?: number,
    public type?: string,
  ) {
    super(message);
    this.name = "MetaApiError";
  }
}

function getToken(): string {
  const t = process.env.META_ACCESS_TOKEN;
  if (!t) throw new MetaApiError("META_ACCESS_TOKEN is not set in env");
  return t;
}

async function graph<T>(
  path: string,
  params: Record<string, string> = {},
  tokenOverride?: string,
): Promise<T> {
  const token = tokenOverride ?? getToken();
  const qp = new URLSearchParams({ access_token: token, ...params });
  const url = `${GRAPH_BASE}/${path}?${qp.toString()}`;
  const res = await fetch(url, { cache: "no-store" });
  const body = (await res.json()) as {
    data?: T;
    error?: { message: string; code: number; type: string };
  } & Record<string, unknown>;
  if (!res.ok || body.error) {
    const err = body.error ?? {
      message: `HTTP ${res.status}`,
      code: res.status,
      type: "Unknown",
    };
    throw new MetaApiError(err.message, err.code, err.type);
  }
  return body as unknown as T;
}

/**
 * Resolve a Page Access Token from the user-scoped META_ACCESS_TOKEN. Many
 * Page-scoped endpoints (`{page}/published_posts`, `instagram_business_account`)
 * return error #210 ("page access token is required") when called with a User
 * Access Token, even if the user is admin and the token has the right scopes.
 *
 * `/me/accounts` returns each managed page with its long-lived page token —
 * we look up the matching page and return its token. Requires
 * `pages_show_list` on the user token.
 */
const pageTokenCache = new Map<string, { token: string; expires: number }>();

async function getPageAccessToken(pageId: string): Promise<string> {
  const cached = pageTokenCache.get(pageId);
  if (cached && cached.expires > Date.now()) return cached.token;

  const out = await graph<{
    data: Array<{ id: string; access_token: string }>;
  }>("me/accounts", { fields: "id,access_token", limit: "200" });
  const found = (out.data ?? []).find((p) => p.id === pageId);
  if (!found) {
    throw new MetaApiError(
      `page ${pageId} not in /me/accounts — the user behind META_ACCESS_TOKEN is not admin of this page, or pages_show_list is missing from the token's scopes`,
      400,
      "PageNotAccessible",
    );
  }
  pageTokenCache.set(pageId, {
    token: found.access_token,
    expires: Date.now() + 5 * 60 * 1000,
  });
  return found.access_token;
}

export interface MetaCampaign {
  id: string;
  name: string;
  status: "ACTIVE" | "PAUSED" | "DELETED" | "ARCHIVED";
  effective_status: string;
  objective: string;
  daily_budget?: string;
  lifetime_budget?: string;
  created_time: string;
  updated_time: string;
}

export interface MetaInsights {
  spend?: string;
  impressions?: string;
  clicks?: string;
  ctr?: string;
  cpm?: string;
  cpc?: string;
  frequency?: string;
  reach?: string;
  actions?: Array<{ action_type: string; value: string }>;
  cost_per_action_type?: Array<{ action_type: string; value: string }>;
  date_start?: string;
  date_stop?: string;
}

export interface AdInsightsRow extends MetaInsights {
  ad_id: string;
}

export async function getAdAccountInfo(adAccountId: string): Promise<{
  id: string;
  name: string;
  account_status: number;
  currency: string;
  timezone_name: string;
}> {
  const out = await graph<{
    id: string;
    name: string;
    account_status: number;
    currency: string;
    timezone_name: string;
  }>(adAccountId, { fields: "id,name,account_status,currency,timezone_name" });
  return out;
}

export async function listCampaigns(
  adAccountId: string,
): Promise<MetaCampaign[]> {
  const out = await graph<{ data: MetaCampaign[] }>(
    `${adAccountId}/campaigns`,
    {
      fields:
        "id,name,status,effective_status,objective,daily_budget,lifetime_budget,created_time,updated_time",
      limit: "100",
    },
  );
  return out.data ?? [];
}

export interface MetaAdSummary {
  id: string;
  name: string;
  effective_status: string;
  campaign_id: string;
}

export async function listAdsForAccount(
  adAccountId: string,
): Promise<MetaAdSummary[]> {
  const out = await graph<{ data: MetaAdSummary[] }>(`${adAccountId}/ads`, {
    fields: "id,name,effective_status,campaign_id",
    limit: "500",
  });
  return out.data ?? [];
}

export interface MetaAdWithCreative {
  ad_id: string;
  ad_name: string;
  ad_effective_status: string;
  creative_id: string | null;
  creative_name: string | null;
  creative_thumbnail_url: string | null;
  creative_image_url: string | null;
  creative_video_id: string | null;
  adset_id: string | null;
  campaign_id: string | null;
  campaign_name: string | null;
  campaign_effective_status: string | null;
}

interface RawAdWithCreative {
  id: string;
  name: string;
  effective_status: string;
  creative?: {
    id?: string;
    name?: string;
    thumbnail_url?: string;
    image_url?: string;
    video_id?: string;
  };
  adset?: { id?: string };
  campaign?: { id?: string; name?: string; effective_status?: string };
}

/**
 * Pull every ad in the account with its creative content + parent campaign in
 * a single Graph call. Used to populate the "באוויר עכשיו" gallery from Meta
 * directly, regardless of whether each creative was uploaded via our app or
 * created native in Ads Manager. We expand:
 *   - `creative{id,name,thumbnail_url,image_url,video_id}` — content for the tile
 *   - `adset{id}` — for adset-level filters
 *   - `campaign{id,name,effective_status}` — for grouping
 * Avoids fan-out (would be one request per ad otherwise).
 */
export async function listAdsWithCreativeAndCampaign(
  adAccountId: string,
): Promise<MetaAdWithCreative[]> {
  const out = await graph<{ data: RawAdWithCreative[] }>(`${adAccountId}/ads`, {
    fields:
      "id,name,effective_status,creative{id,name,thumbnail_url,image_url,video_id},adset{id},campaign{id,name,effective_status}",
    limit: "500",
  });
  return (out.data ?? []).map((a) => ({
    ad_id: a.id,
    ad_name: a.name,
    ad_effective_status: a.effective_status,
    creative_id: a.creative?.id ?? null,
    creative_name: a.creative?.name ?? null,
    creative_thumbnail_url: a.creative?.thumbnail_url ?? null,
    creative_image_url: a.creative?.image_url ?? null,
    creative_video_id: a.creative?.video_id ?? null,
    adset_id: a.adset?.id ?? null,
    campaign_id: a.campaign?.id ?? null,
    campaign_name: a.campaign?.name ?? null,
    campaign_effective_status: a.campaign?.effective_status ?? null,
  }));
}

export interface MetaAdSetSummary {
  id: string;
  campaign_id: string;
  effective_status: string;
  daily_budget?: string;
  lifetime_budget?: string;
}

export async function listAdSetsForAccount(
  adAccountId: string,
): Promise<MetaAdSetSummary[]> {
  const out = await graph<{ data: MetaAdSetSummary[] }>(
    `${adAccountId}/adsets`,
    {
      fields: "id,campaign_id,effective_status,daily_budget,lifetime_budget",
      limit: "500",
    },
  );
  return out.data ?? [];
}

export type DatePreset =
  | "today"
  | "yesterday"
  | "last_7d"
  | "last_30d"
  | "last_90d"
  | "maximum";

export type DateRange =
  | { kind: "preset"; preset: DatePreset }
  | { kind: "custom"; since: string; until: string };

export const DEFAULT_DATE_RANGE: DateRange = {
  kind: "preset",
  preset: "last_7d",
};

const VALID_PRESETS: DatePreset[] = [
  "today",
  "yesterday",
  "last_7d",
  "last_30d",
  "last_90d",
  "maximum",
];
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function parseDateRange(params: {
  range?: string;
  since?: string;
  until?: string;
}): DateRange {
  if (
    params.since &&
    params.until &&
    ISO_DATE_RE.test(params.since) &&
    ISO_DATE_RE.test(params.until)
  ) {
    return { kind: "custom", since: params.since, until: params.until };
  }
  const p = params.range as DatePreset | undefined;
  if (p && VALID_PRESETS.includes(p)) return { kind: "preset", preset: p };
  return DEFAULT_DATE_RANGE;
}

function dateRangeParams(r: DateRange): Record<string, string> {
  if (r.kind === "preset") return { date_preset: r.preset };
  return { time_range: JSON.stringify({ since: r.since, until: r.until }) };
}

export async function getCampaignInsights(
  campaignId: string,
  range: DateRange = DEFAULT_DATE_RANGE,
): Promise<MetaInsights | null> {
  const out = await graph<{ data: MetaInsights[] }>(`${campaignId}/insights`, {
    fields:
      "spend,impressions,clicks,ctr,cpm,cpc,frequency,reach,actions,cost_per_action_type",
    ...dateRangeParams(range),
  });
  return out.data && out.data.length > 0 ? out.data[0] : null;
}

/**
 * Pull ad-level insights for every ad in the account in a single Graph call.
 * Returns a map keyed by ad_id so callers can join against listAds output.
 *
 * Used by the gallery's "באוויר עכשיו" section to score live creatives by
 * actual performance (CTR, hook rate, frequency, spend).
 *
 * Default window is `maximum` (lifetime) — many ads run for months, and
 * narrow windows like 7d/30d miss the bigger picture. The agent's decision
 * loop wants the *overall* signal per creative, not a recency snapshot.
 */
const INSIGHTS_DEFAULT_RANGE: DateRange = {
  kind: "preset",
  preset: "maximum",
};

/**
 * Resolve video `source` URLs for a batch of video_ids in parallel. Used to
 * play the actual video inline on the gallery's "באוויר עכשיו" tiles —
 * thumbnails alone aren't enough when the user clicks Play.
 *
 * Each video lives on its Page's CDN and the `source` URL requires a Page
 * Access Token to read. Returns a map keyed by video_id; missing entries
 * mean we couldn't resolve the source (token scope, deleted video, etc.) —
 * the tile falls back to a thumbnail.
 */
export async function listVideoSources(
  videoIds: string[],
  pageId?: string,
): Promise<Record<string, string>> {
  if (videoIds.length === 0) return {};
  const tokenOverride = pageId ? await getPageAccessToken(pageId) : undefined;
  const results = await Promise.all(
    videoIds.map(async (vid) => {
      try {
        const out = await graph<{ source?: string; permalink_url?: string }>(
          vid,
          { fields: "source,permalink_url" },
          tokenOverride,
        );
        return [vid, out.source ?? null] as const;
      } catch {
        return [vid, null] as const;
      }
    }),
  );
  const map: Record<string, string> = {};
  for (const [vid, src] of results) {
    if (src) map[vid] = src;
  }
  return map;
}

export async function listAdInsights(
  adAccountId: string,
  range: DateRange = INSIGHTS_DEFAULT_RANGE,
): Promise<Record<string, AdInsightsRow>> {
  try {
    const out = await graph<{ data: AdInsightsRow[] }>(
      `${adAccountId}/insights`,
      {
        level: "ad",
        // `video_3_sec_watched_actions` was rejected as invalid by Graph v21.
        // The 3-sec view count lives in the `actions` array as `video_view`
        // (Meta's standard event taxonomy: video_view = 3-second view).
        fields:
          "ad_id,impressions,clicks,ctr,spend,cpm,cpc,frequency,reach,actions,cost_per_action_type",
        limit: "500",
        ...dateRangeParams(range),
      },
    );
    const map: Record<string, AdInsightsRow> = {};
    for (const row of out.data ?? []) {
      if (row.ad_id) map[row.ad_id] = row;
    }
    if (Object.keys(map).length === 0) {
      console.warn(
        `[meta.listAdInsights] empty result for ${adAccountId} on ${JSON.stringify(range)} — ` +
          "either no ads ran in the window, or token lacks ads_read scope",
      );
    }
    return map;
  } catch (e) {
    console.warn(
      `[meta.listAdInsights] failed for ${adAccountId}: ${e instanceof Error ? e.message : "unknown"}`,
    );
    return {};
  }
}

export async function listCampaignsWithInsights(
  adAccountId: string,
  range: DateRange = DEFAULT_DATE_RANGE,
): Promise<Array<MetaCampaign & { insights: MetaInsights | null }>> {
  const campaigns = await listCampaigns(adAccountId);
  const results = await Promise.all(
    campaigns.map(async (c) => {
      try {
        const insights = await getCampaignInsights(c.id, range);
        return { ...c, insights };
      } catch {
        return { ...c, insights: null };
      }
    }),
  );
  return results;
}

export function formatMoney(
  value: string | undefined,
  currency: string,
): string {
  if (!value) return "—";
  const n = Number(value);
  if (Number.isNaN(n)) return "—";
  const symbol =
    currency === "USD" ? "$" : currency === "ILS" ? "₪" : `${currency} `;
  return `${symbol}${n.toFixed(2)}`;
}

export function formatCents(
  cents: string | undefined,
  currency: string,
): string {
  if (!cents) return "—";
  const n = Number(cents);
  if (Number.isNaN(n)) return "—";
  return formatMoney(String(n / 100), currency);
}

export function formatPct(value: string | undefined): string {
  if (!value) return "—";
  const n = Number(value);
  if (Number.isNaN(n)) return "—";
  return `${n.toFixed(2)}%`;
}

export function findAction(
  insights: MetaInsights | null,
  actionType: string,
): string | null {
  if (!insights?.actions) return null;
  const found = insights.actions.find((a) => a.action_type === actionType);
  return found?.value ?? null;
}

// ---------- Organic posts (Facebook Page + Instagram business account) ----------

export interface FacebookPagePost {
  id: string;
  message: string | null;
  created_time: string;
  permalink_url: string | null;
  full_picture: string | null;
}

interface RawFacebookPost {
  id: string;
  message?: string;
  created_time: string;
  permalink_url?: string;
  full_picture?: string;
}

/**
 * Page posts via /{page_id}/published_posts. Returns the most recent posts
 * the Page itself published (excludes user posts on the wall). Uses a
 * Page Access Token resolved via /me/accounts — the user-scoped token is
 * rejected by Graph with error #210 on Page-scoped endpoints.
 *
 * Required scopes on the user token: `pages_show_list`, `pages_read_engagement`.
 */
export async function listPagePosts(
  pageId: string,
  limit = 50,
): Promise<FacebookPagePost[]> {
  const pageToken = await getPageAccessToken(pageId);
  const out = await graph<{ data: RawFacebookPost[] }>(
    `${pageId}/published_posts`,
    {
      fields: "id,message,created_time,permalink_url,full_picture",
      limit: String(limit),
    },
    pageToken,
  );
  return (out.data ?? []).map((p) => ({
    id: p.id,
    message: p.message ?? null,
    created_time: p.created_time,
    permalink_url: p.permalink_url ?? null,
    full_picture: p.full_picture ?? null,
  }));
}

/**
 * The IG business account id linked to a Facebook Page, or null if none is
 * connected. Uses the Page Access Token — same #210 reason as listPagePosts.
 */
export async function getInstagramAccountIdForPage(
  pageId: string,
): Promise<string | null> {
  const pageToken = await getPageAccessToken(pageId);
  const out = await graph<{ instagram_business_account?: { id: string } }>(
    pageId,
    {
      fields: "instagram_business_account",
    },
    pageToken,
  );
  return out.instagram_business_account?.id ?? null;
}

export type InstagramMediaType = "IMAGE" | "VIDEO" | "CAROUSEL_ALBUM";

export interface InstagramMedia {
  id: string;
  caption: string | null;
  media_type: InstagramMediaType;
  media_url: string | null; // null for CAROUSEL_ALBUM (use first child)
  thumbnail_url: string | null; // populated for VIDEO
  permalink: string | null;
  timestamp: string;
}

interface RawIgMedia {
  id: string;
  caption?: string;
  media_type: InstagramMediaType;
  media_url?: string;
  thumbnail_url?: string;
  permalink?: string;
  timestamp: string;
  children?: {
    data: Array<{
      media_type: InstagramMediaType;
      media_url?: string;
      thumbnail_url?: string;
    }>;
  };
}

/**
 * IG business-account media. For CAROUSEL_ALBUM we surface the first child's
 * media_url so the tile has something to render. Uses the linked Page's
 * access token (when `linkedPageId` is provided) — IG endpoints behave more
 * reliably with the Page token than the User token.
 *
 * Required scopes on the user token: `instagram_basic`, `pages_show_list`.
 */
export async function listInstagramMedia(
  igUserId: string,
  limit = 50,
  linkedPageId?: string,
): Promise<InstagramMedia[]> {
  const tokenOverride = linkedPageId
    ? await getPageAccessToken(linkedPageId)
    : undefined;
  const out = await graph<{ data: RawIgMedia[] }>(
    `${igUserId}/media`,
    {
      fields:
        "id,caption,media_type,media_url,thumbnail_url,permalink,timestamp,children{media_type,media_url,thumbnail_url}",
      limit: String(limit),
    },
    tokenOverride,
  );
  return (out.data ?? []).map((m) => {
    let mediaUrl = m.media_url ?? null;
    let thumbUrl = m.thumbnail_url ?? null;
    if (m.media_type === "CAROUSEL_ALBUM" && m.children?.data?.[0]) {
      const first = m.children.data[0];
      mediaUrl = mediaUrl ?? first.media_url ?? null;
      thumbUrl = thumbUrl ?? first.thumbnail_url ?? null;
    }
    return {
      id: m.id,
      caption: m.caption ?? null,
      media_type: m.media_type,
      media_url: mediaUrl,
      thumbnail_url: thumbUrl,
      permalink: m.permalink ?? null,
      timestamp: m.timestamp,
    };
  });
}
