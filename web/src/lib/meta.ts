import "server-only";

const GRAPH_VERSION = "v21.0";
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;

export class MetaApiError extends Error {
  constructor(message: string, public code?: number, public type?: string) {
    super(message);
    this.name = "MetaApiError";
  }
}

function getToken(): string {
  const t = process.env.META_ACCESS_TOKEN;
  if (!t) throw new MetaApiError("META_ACCESS_TOKEN is not set in env");
  return t;
}

async function graph<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  const token = getToken();
  const qp = new URLSearchParams({ access_token: token, ...params });
  const url = `${GRAPH_BASE}/${path}?${qp.toString()}`;
  const res = await fetch(url, { cache: "no-store" });
  const body = (await res.json()) as { data?: T; error?: { message: string; code: number; type: string } } & Record<string, unknown>;
  if (!res.ok || body.error) {
    const err = body.error ?? { message: `HTTP ${res.status}`, code: res.status, type: "Unknown" };
    throw new MetaApiError(err.message, err.code, err.type);
  }
  return body as unknown as T;
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

export async function getAdAccountInfo(adAccountId: string): Promise<{
  id: string;
  name: string;
  account_status: number;
  currency: string;
  timezone_name: string;
}> {
  const out = await graph<{ id: string; name: string; account_status: number; currency: string; timezone_name: string }>(
    adAccountId,
    { fields: "id,name,account_status,currency,timezone_name" },
  );
  return out;
}

export async function listCampaigns(adAccountId: string): Promise<MetaCampaign[]> {
  const out = await graph<{ data: MetaCampaign[] }>(`${adAccountId}/campaigns`, {
    fields: "id,name,status,effective_status,objective,daily_budget,lifetime_budget,created_time,updated_time",
    limit: "100",
  });
  return out.data ?? [];
}

export interface MetaAdSummary {
  id: string;
  name: string;
  effective_status: string;
  campaign_id: string;
}

export async function listAdsForAccount(adAccountId: string): Promise<MetaAdSummary[]> {
  const out = await graph<{ data: MetaAdSummary[] }>(`${adAccountId}/ads`, {
    fields: "id,name,effective_status,campaign_id",
    limit: "500",
  });
  return out.data ?? [];
}

export interface MetaAdSetSummary {
  id: string;
  campaign_id: string;
  effective_status: string;
  daily_budget?: string;
  lifetime_budget?: string;
}

export async function listAdSetsForAccount(adAccountId: string): Promise<MetaAdSetSummary[]> {
  const out = await graph<{ data: MetaAdSetSummary[] }>(`${adAccountId}/adsets`, {
    fields: "id,campaign_id,effective_status,daily_budget,lifetime_budget",
    limit: "500",
  });
  return out.data ?? [];
}

export type DatePreset = "today" | "yesterday" | "last_7d" | "last_30d" | "last_90d" | "maximum";

export type DateRange =
  | { kind: "preset"; preset: DatePreset }
  | { kind: "custom"; since: string; until: string };

export const DEFAULT_DATE_RANGE: DateRange = { kind: "preset", preset: "last_7d" };

const VALID_PRESETS: DatePreset[] = ["today", "yesterday", "last_7d", "last_30d", "last_90d", "maximum"];
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function parseDateRange(params: {
  range?: string;
  since?: string;
  until?: string;
}): DateRange {
  if (params.since && params.until && ISO_DATE_RE.test(params.since) && ISO_DATE_RE.test(params.until)) {
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
    fields: "spend,impressions,clicks,ctr,cpm,cpc,frequency,reach,actions,cost_per_action_type",
    ...dateRangeParams(range),
  });
  return out.data && out.data.length > 0 ? out.data[0] : null;
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

export function formatMoney(value: string | undefined, currency: string): string {
  if (!value) return "—";
  const n = Number(value);
  if (Number.isNaN(n)) return "—";
  const symbol = currency === "USD" ? "$" : currency === "ILS" ? "₪" : `${currency} `;
  return `${symbol}${n.toFixed(2)}`;
}

export function formatCents(cents: string | undefined, currency: string): string {
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

export function findAction(insights: MetaInsights | null, actionType: string): string | null {
  if (!insights?.actions) return null;
  const found = insights.actions.find((a) => a.action_type === actionType);
  return found?.value ?? null;
}
