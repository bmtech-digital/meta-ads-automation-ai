import type { CreativeAsset } from "@/lib/db/types";
import type { AdInsightsRow, MetaAdWithCreative } from "@/lib/meta";

export type CreativeUsage = Record<string, MetaAdWithCreative[]>;

export interface OrganicPost {
  source: "facebook" | "instagram";
  id: string;
  caption: string | null;
  thumbnail: string | null;
  video_url: string | null;
  permalink: string | null;
  timestamp: string;
  isVideo: boolean;
}

export type PriorityKind = "asset" | "organic";

export interface PriorityItem {
  kind: PriorityKind;
  id: string;
  score: number;
  reasons: string[];
  asset?: CreativeAsset;
  post?: OrganicPost;
}

const ACTIVE_AD_STATUSES = new Set([
  "ACTIVE",
  "CAMPAIGN_PAUSED",
  "ADSET_PAUSED",
  "IN_PROCESS",
  "WITH_ISSUES",
]);

export function isLiveAd(status: string | null | undefined): boolean {
  return !!status && ACTIVE_AD_STATUSES.has(status);
}

export function readNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

export function isAssetLive(asset: CreativeAsset, usage: CreativeUsage): boolean {
  if (!asset.meta_creative_id) return false;
  const ads = usage[asset.meta_creative_id] ?? [];
  return ads.some((ad) => isLiveAd(ad.ad_effective_status));
}

export function liveSignalSets(
  assets: CreativeAsset[],
  usage: CreativeUsage,
): { liveServiceTags: Set<string>; liveAngles: Set<string> } {
  const liveServiceTags = new Set<string>();
  const liveAngles = new Set<string>();
  for (const a of assets) {
    if (!isAssetLive(a, usage)) continue;
    if (a.service_tag) liveServiceTags.add(a.service_tag);
    if (a.marketing_angle) liveAngles.add(a.marketing_angle);
  }
  return { liveServiceTags, liveAngles };
}

function daysSince(iso: string): number {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return Infinity;
  return (Date.now() - t) / (1000 * 60 * 60 * 24);
}

export function scoreAsset(
  asset: CreativeAsset,
  liveServiceTags: Set<string>,
  liveAngles: Set<string>,
  galleryServiceTags: Set<string>,
  galleryAngles: Set<string>,
): { score: number; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];

  if (asset.service_tag && liveServiceTags.has(asset.service_tag)) {
    score += 30;
    reasons.push(`חופף לתיוג חי "${asset.service_tag}" — ממלא דיוורסיפיקציה ל-Andromeda`);
  }
  if (asset.service_tag && galleryServiceTags.has(asset.service_tag) && !liveServiceTags.has(asset.service_tag)) {
    score += 25;
    reasons.push(`תיוג "${asset.service_tag}" עוד לא נוסה חי — gap`);
  }
  if (asset.marketing_angle && galleryAngles.has(asset.marketing_angle) && !liveAngles.has(asset.marketing_angle)) {
    score += 25;
    reasons.push(`angle "${asset.marketing_angle}" עוד לא נוסה חי — gap`);
  }
  if (asset.kind === "video" && asset.duration_seconds != null) {
    const d = Number(asset.duration_seconds);
    if (d >= 9 && d <= 15) {
      score += 15;
      reasons.push("וידאו 9-15 שניות (טווח Andromeda האוהב)");
    }
  }
  const ctr = readNumber(asset.performance_snapshot?.ctr);
  if (ctr != null && ctr < 0.5) {
    score -= 40;
    reasons.push(`CTR קודם נמוך (${ctr.toFixed(2)}%)`);
  }
  if (asset.created_at) {
    const days = daysSince(asset.created_at);
    if (days <= 7) {
      score += 10;
      reasons.push("נכס חדש (פחות משבוע)");
    }
  }

  return { score, reasons };
}

export function scoreOrganicPost(post: OrganicPost): { score: number; reasons: string[] } {
  // Engagement-based scoring deferred (requires per-post insights API calls).
  // Base score so organic posts surface alongside untested assets.
  const reasons: string[] = ["פוסט אורגני — מועמד לקידום"];
  let score = 20;
  const days = daysSince(post.timestamp);
  if (days <= 14) {
    score += 5;
    reasons.push("פורסם בשבועיים האחרונים");
  }
  return { score, reasons };
}

export function buildPriorityQueue(
  assets: CreativeAsset[],
  usage: CreativeUsage,
): PriorityItem[] {
  const { liveServiceTags, liveAngles } = liveSignalSets(assets, usage);

  const galleryServiceTags = new Set<string>();
  const galleryAngles = new Set<string>();
  for (const a of assets) {
    if (a.service_tag) galleryServiceTags.add(a.service_tag);
    if (a.marketing_angle) galleryAngles.add(a.marketing_angle);
  }

  const items: PriorityItem[] = [];

  for (const asset of assets) {
    if (isAssetLive(asset, usage)) continue;
    if (asset.meta_creative_id) continue; // attached to ad but not currently live
    const { score, reasons } = scoreAsset(
      asset,
      liveServiceTags,
      liveAngles,
      galleryServiceTags,
      galleryAngles,
    );
    items.push({ kind: "asset", id: asset.id, score, reasons, asset });
  }

  items.sort((a, b) => b.score - a.score);
  return items;
}

export interface LiveCampaignGroup {
  id: string;
  name: string;
  effective_status: string | null;
  assets: CreativeAsset[];
}

export function groupLiveByCampaign(
  assets: CreativeAsset[],
  usage: CreativeUsage,
): LiveCampaignGroup[] {
  const byCampaign = new Map<string, LiveCampaignGroup>();
  for (const asset of assets) {
    if (!asset.meta_creative_id) continue;
    const ads = usage[asset.meta_creative_id] ?? [];
    for (const ad of ads) {
      if (!isLiveAd(ad.ad_effective_status)) continue;
      if (!ad.campaign_id) continue;
      const prev = byCampaign.get(ad.campaign_id);
      if (prev) {
        if (!prev.assets.includes(asset)) prev.assets.push(asset);
      } else {
        byCampaign.set(ad.campaign_id, {
          id: ad.campaign_id,
          name: ad.campaign_name ?? ad.campaign_id,
          effective_status: ad.campaign_effective_status,
          assets: [asset],
        });
      }
    }
  }
  return Array.from(byCampaign.values()).sort((a, b) => b.assets.length - a.assets.length);
}

/**
 * A creative pulled from Meta directly — represents one ad creative in a live
 * ad. May or may not be linked to a row in our `creative_gallery` table:
 * `galleryAsset` is non-null only if the ad's creative was uploaded via our
 * app and we already track it. Creatives created native in Ads Manager have
 * `galleryAsset === null` but still surface in the Live section.
 */
export type PerformanceGrade = "A" | "B" | "C" | "D" | "learning";

export interface LivePerformance {
  score: number;
  grade: PerformanceGrade;
  reasons: string[];
  metrics: {
    impressions: number | null;
    ctr: number | null;
    hook_rate: number | null;
    frequency: number | null;
    spend: number | null;
    conversions: number | null;
  };
}

export interface LiveMetaCreative {
  creative_id: string;
  name: string | null;
  thumbnail_url: string | null;
  image_url: string | null;
  video_id: string | null;
  video_source_url: string | null;
  ad_id: string;
  ad_status: string;
  campaign_id: string;
  campaign_name: string;
  campaign_status: string | null;
  galleryAsset: CreativeAsset | null;
  performance: LivePerformance | null;
}

function actionValue(
  actions: Array<{ action_type: string; value: string }> | undefined,
  type: string,
): number | null {
  if (!actions) return null;
  const found = actions.find((a) => a.action_type === type);
  return found ? Number(found.value) : null;
}

function sumActions(
  actions: Array<{ action_type: string; value: string }> | undefined,
  types: string[],
): number {
  if (!actions) return 0;
  return actions.reduce(
    (sum, a) => sum + (types.includes(a.action_type) ? Number(a.value) : 0),
    0,
  );
}

/**
 * Score a live creative by its real Meta insights. Returns A/B/C/D grade,
 * a numeric score, and human-readable reasons. Designed to drive both UI
 * affordance ("which creative is winning?") and agent decisions ("which to
 * scale, kill, or duplicate-with-variation?").
 *
 * Rules grounded in CAMPAIGN_EVALUATION.md and PERSONALITY.md — no generic
 * advice; every score component traces back to a number from Meta.
 */
export function scoreLivePerformance(
  insights: AdInsightsRow | null,
  isVideo: boolean,
): LivePerformance {
  if (!insights) {
    return {
      score: 0,
      grade: "learning",
      reasons: ["אין נתוני ביצועים מ-Meta עדיין"],
      metrics: {
        impressions: null,
        ctr: null,
        hook_rate: null,
        frequency: null,
        spend: null,
        conversions: null,
      },
    };
  }

  const impressions = insights.impressions ? Number(insights.impressions) : 0;
  const ctr = insights.ctr ? Number(insights.ctr) : null;
  const frequency = insights.frequency ? Number(insights.frequency) : null;
  const spend = insights.spend ? Number(insights.spend) : 0;
  const conversions = sumActions(insights.actions, [
    "purchase",
    "lead",
    "complete_registration",
    "submit_application",
    "schedule",
    "contact",
  ]);

  // Hook rate = 3-sec views / impressions. In Graph v21 the 3-sec count
  // lives in the standard `actions` array as `video_view` (Meta's default
  // video event taxonomy).
  const video3sec = actionValue(insights.actions, "video_view");
  const hookRate =
    isVideo && video3sec != null && impressions > 0
      ? (video3sec / impressions) * 100
      : null;

  // Below sample size threshold — withhold judgment. Per Andromeda guidance,
  // < 1000 impressions isn't enough signal to decide anything.
  if (impressions < 1000) {
    return {
      score: 0,
      grade: "learning",
      reasons: [`עדיין לומד — רק ${Math.round(impressions)} חשיפות (פחות מ-1,000)`],
      metrics: {
        impressions,
        ctr,
        hook_rate: hookRate,
        frequency,
        spend,
        conversions,
      },
    };
  }

  const reasons: string[] = [];
  let score = 0;

  if (ctr != null) {
    if (ctr >= 1.5) {
      score += 30;
      reasons.push(`CTR גבוה (${ctr.toFixed(2)}%) — מנצח`);
    } else if (ctr >= 1.0) {
      score += 15;
      reasons.push(`CTR סביר (${ctr.toFixed(2)}%)`);
    } else if (ctr >= 0.5) {
      score -= 10;
      reasons.push(`CTR נמוך (${ctr.toFixed(2)}%) — מתחת לממוצע`);
    } else {
      score -= 30;
      reasons.push(`CTR גרוע (${ctr.toFixed(2)}%) — לשקול לכבות`);
    }
  }

  if (isVideo && hookRate != null) {
    if (hookRate >= 30) {
      score += 25;
      reasons.push(`Hook rate גבוה (${hookRate.toFixed(0)}%) — תפס תשומת לב`);
    } else if (hookRate >= 15) {
      score += 10;
      reasons.push(`Hook rate בינוני (${hookRate.toFixed(0)}%)`);
    } else {
      score -= 25;
      reasons.push(`Hook rate נמוך (${hookRate.toFixed(0)}%) — הקדמה לא עובדת`);
    }
  }

  if (frequency != null) {
    if (frequency > 5) {
      score -= 30;
      reasons.push(`Frequency ${frequency.toFixed(1)} — קהל רווי, צריך קהל חדש`);
    } else if (frequency > 3) {
      score -= 15;
      reasons.push(`Frequency ${frequency.toFixed(1)} — תחילת רווייה`);
    }
  }

  if (spend > 50 && conversions === 0) {
    score -= 20;
    reasons.push(`₪${spend.toFixed(0)} הוצאה ללא Conversions`);
  }

  const grade: PerformanceGrade =
    score >= 50 ? "A" : score >= 25 ? "B" : score >= 0 ? "C" : "D";

  return {
    score,
    grade,
    reasons,
    metrics: { impressions, ctr, hook_rate: hookRate, frequency, spend, conversions },
  };
}

export interface LiveMetaCampaignGroup {
  id: string;
  name: string;
  effective_status: string | null;
  creatives: LiveMetaCreative[];
}

/**
 * Build the "באוויר עכשיו · פרסומות חיות" view from Meta data — every live
 * ad's creative shows up regardless of whether it's also in our gallery.
 * Each creative is cross-referenced against `assets` so we can render a
 * "מהגלרייה שלנו" badge when there's a match. When `adInsights` is provided,
 * each creative also gets a performance score derived from real Meta stats.
 */
export function groupLiveMetaCreativesByCampaign(
  usage: CreativeUsage,
  assets: CreativeAsset[],
  adInsights: Record<string, AdInsightsRow> = {},
  videoSources: Record<string, string> = {},
): LiveMetaCampaignGroup[] {
  const assetByCreativeId = new Map<string, CreativeAsset>();
  for (const a of assets) {
    if (a.meta_creative_id) assetByCreativeId.set(a.meta_creative_id, a);
  }

  const byCampaign = new Map<string, LiveMetaCampaignGroup>();

  for (const adsForCreative of Object.values(usage)) {
    for (const ad of adsForCreative) {
      if (!isLiveAd(ad.ad_effective_status)) continue;
      if (!ad.campaign_id || !ad.creative_id) continue;

      let group = byCampaign.get(ad.campaign_id);
      if (!group) {
        group = {
          id: ad.campaign_id,
          name: ad.campaign_name ?? ad.campaign_id,
          effective_status: ad.campaign_effective_status,
          creatives: [],
        };
        byCampaign.set(ad.campaign_id, group);
      }

      if (group.creatives.some((c) => c.creative_id === ad.creative_id)) continue;

      const insights = adInsights[ad.ad_id] ?? null;
      const isVideo = !!ad.creative_video_id;
      const performance = insights ? scoreLivePerformance(insights, isVideo) : null;

      group.creatives.push({
        creative_id: ad.creative_id,
        name: ad.creative_name,
        thumbnail_url: ad.creative_thumbnail_url,
        image_url: ad.creative_image_url,
        video_id: ad.creative_video_id,
        video_source_url: ad.creative_video_id
          ? videoSources[ad.creative_video_id] ?? null
          : null,
        ad_id: ad.ad_id,
        ad_status: ad.ad_effective_status,
        campaign_id: ad.campaign_id,
        campaign_name: ad.campaign_name ?? ad.campaign_id,
        campaign_status: ad.campaign_effective_status,
        galleryAsset: assetByCreativeId.get(ad.creative_id) ?? null,
        performance,
      });
    }
  }

  // Sort creatives within each campaign by performance score (winners first).
  for (const group of byCampaign.values()) {
    group.creatives.sort((a, b) => {
      const sa = a.performance?.score ?? -Infinity;
      const sb = b.performance?.score ?? -Infinity;
      return sb - sa;
    });
  }

  return Array.from(byCampaign.values()).sort(
    (a, b) => b.creatives.length - a.creatives.length,
  );
}

/**
 * Andromeda fatigue: cost-per-result is 2× the campaign baseline. We don't yet
 * track per-asset CPR baselines, so this is a placeholder — returns false until
 * `performance_snapshot.cpr` and a campaign baseline are wired.
 */
export function isFatiguing(asset: CreativeAsset): boolean {
  const cpr = readNumber(asset.performance_snapshot?.cpr);
  const baseline = readNumber(asset.performance_snapshot?.cpr_baseline);
  if (cpr == null || baseline == null || baseline <= 0) return false;
  return cpr >= 2 * baseline;
}

export function isWinning(asset: CreativeAsset): boolean {
  const ctr = readNumber(asset.performance_snapshot?.ctr);
  if (ctr == null) return false;
  return ctr >= 1.5;
}

export type Lifecycle = "draft" | "live" | "winning" | "fatiguing" | "killed";

export function lifecycleOf(asset: CreativeAsset, usage: CreativeUsage): Lifecycle {
  if (asset.deleted_at) return "killed";
  if (!asset.meta_creative_id) return "draft";
  const live = isAssetLive(asset, usage);
  if (!live) return "killed";
  if (isFatiguing(asset)) return "fatiguing";
  if (isWinning(asset)) return "winning";
  return "live";
}
