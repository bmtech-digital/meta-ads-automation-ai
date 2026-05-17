"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { CreativeAsset, CreativeAssetSource } from "@/lib/db/types";
import type { MetaAdWithCreative } from "@/lib/meta";
import {
  isLiveAd,
  lifecycleOf,
  readNumber,
  type CreativeUsage,
  type Lifecycle,
} from "./scoring";

const SOURCE_LABEL_HE: Record<CreativeAssetSource, string> = {
  imagen: "Imagen",
  gemini: "Gemini",
  manual_upload: "העלאה ידנית",
};

/**
 * Lifecycle badge classes — semantic-color tokens, not hardcoded greens/ambers.
 * Live + winning share the same hue family (emerald) so the user reads them as
 * "good state"; the difference is glow intensity (winning carries the halo).
 * fatiguing → warning (amber), draft + killed → muted. All values stay aligned
 * with `Lifecycle` types in scoring.ts — agent contract is the labels, not the
 * colors.
 */
const LIFECYCLE_BADGE: Record<
  Lifecycle,
  { label: string; className: string }
> = {
  draft: {
    label: "טיוטה",
    className:
      "bg-muted/70 text-muted-foreground border border-border/80",
  },
  live: {
    label: "חי",
    className:
      "bg-emerald-500/15 text-emerald-700 border border-emerald-500/30 dark:text-emerald-300",
  },
  winning: {
    label: "מנצח",
    className:
      "bg-emerald-500/20 text-emerald-700 border border-emerald-500/55 shadow-[0_0_10px_-2px_hsl(150_60%_45%/0.45)] dark:text-emerald-200",
  },
  fatiguing: {
    label: "מתעייף",
    className:
      "bg-amber-500/15 text-amber-700 border border-amber-500/40 dark:text-amber-300",
  },
  killed: {
    label: "כבוי",
    className:
      "bg-muted/40 text-muted-foreground/80 border border-border/60",
  },
};

/**
 * Outer ring — barely-there hairline that subtly anchors the tile's
 * lifecycle. Winning earns a soft outer halo (in addition to the badge halo)
 * so it pops at a glance when the operator scans the grid.
 */
const LIFECYCLE_BORDER: Record<Lifecycle, string> = {
  draft: "ring-1 ring-border/60",
  live: "ring-1 ring-emerald-500/25",
  winning:
    "ring-1 ring-emerald-500/45 shadow-[0_0_28px_-8px_hsl(150_60%_45%/0.35)]",
  fatiguing: "ring-1 ring-amber-500/35",
  killed: "ring-1 ring-border/40 opacity-65",
};

/**
 * Six brand-compatible hues for placeholder tiles. Each asset deterministically
 * picks one based on its id hash — gives the grid visual variety without
 * looking random or zoo-like. Matches the mockup's "color story" feel.
 */
const TILE_PALETTE = [
  { h: 28, s: 91, l: 54 }, // brand orange
  { h: 280, s: 55, l: 56 }, // purple
  { h: 180, s: 50, l: 45 }, // teal
  { h: 230, s: 55, l: 60 }, // indigo
  { h: 340, s: 65, l: 58 }, // pink
  { h: 40, s: 75, l: 52 }, // gold
] as const;

function paletteFromId(id: string): { h: number; s: number; l: number } {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) | 0;
  }
  return TILE_PALETTE[Math.abs(hash) % TILE_PALETTE.length];
}

function shortCampaignId(id: string): string {
  return id.length <= 9 ? id : `…${id.slice(-9)}`;
}

function isNew(asset: CreativeAsset): boolean {
  if (!asset.created_at) return false;
  const t = new Date(asset.created_at).getTime();
  if (!Number.isFinite(t)) return false;
  const days = (Date.now() - t) / (1000 * 60 * 60 * 24);
  return days <= 7;
}

interface AssetCampaign {
  id: string;
  name: string;
  effective_status: string | null;
}

function useAssetCampaigns(ads: MetaAdWithCreative[]): AssetCampaign[] {
  return useMemo(() => {
    const byId = new Map<string, AssetCampaign>();
    for (const ad of ads) {
      if (!ad.campaign_id) continue;
      if (!isLiveAd(ad.ad_effective_status)) continue;
      if (byId.has(ad.campaign_id)) continue;
      byId.set(ad.campaign_id, {
        id: ad.campaign_id,
        name: ad.campaign_name ?? ad.campaign_id,
        effective_status: ad.campaign_effective_status,
      });
    }
    return Array.from(byId.values());
  }, [ads]);
}

/**
 * Diagonal-stripe placeholder shown when the asset has no thumbnail (or for
 * videos that haven't loaded a poster). Color is stable per-id so the same
 * asset always shows the same hue. Kind label sits centered with a muted
 * geometric mark above — same visual language as Campaigner.html mockup.
 */
function TilePlaceholder({
  asset,
}: {
  asset: CreativeAsset;
}) {
  const { h, s, l } = paletteFromId(asset.id);
  const kindLabel =
    asset.kind === "video"
      ? asset.duration_seconds != null
        ? `Video · ${Math.round(Number(asset.duration_seconds))}s`
        : "Video"
      : asset.kind === "image"
        ? "Static"
        : asset.kind;
  return (
    <div
      className="flex h-full w-full flex-col items-center justify-center text-[11px] font-mono uppercase tracking-[0.08em] text-muted-foreground/80"
      style={{
        backgroundImage: `repeating-linear-gradient(45deg, hsl(${h} ${s}% ${l}% / 0.08) 0 8px, transparent 8px 16px), linear-gradient(135deg, hsl(${h} ${s}% ${l}% / 0.18), hsl(${h} ${s}% ${l}% / 0.04))`,
      }}
    >
      <div
        className="mb-1 text-[18px]"
        style={{ color: `hsl(${h} ${s}% ${l}%)` }}
        aria-hidden
      >
        ◢◣
      </div>
      {kindLabel}
    </div>
  );
}

interface MediaThumbnailProps {
  asset: CreativeAsset;
}

/**
 * Renders the asset's image or video. For video we use the browser's native
 * controls with `preload="metadata"` — metadata loads on page render (a few
 * KB per file via HTTP Range), giving the user a duration readout and a
 * working play button without auto-playing. Errors (commonly: HEVC/.mov
 * files Chrome on Windows can't decode) surface inline with a fallback
 * "open file" link so the user can verify the file outside the inline player.
 */
function MediaThumbnail({ asset }: MediaThumbnailProps) {
  const [videoError, setVideoError] = useState<string | null>(null);

  if (!asset.storage_url) {
    return <TilePlaceholder asset={asset} />;
  }

  if (asset.kind === "image") {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={asset.storage_url}
        alt={asset.original_filename ?? "gallery asset"}
        className="h-full w-full object-cover"
      />
    );
  }

  if (asset.kind === "video") {
    if (videoError) {
      return (
        <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-slate-900 px-4 py-3 text-center text-[11px] text-slate-200">
          <span className="font-semibold text-amber-300">לא ניתן לנגן</span>
          <span className="text-[10px] text-slate-400" dir="auto">
            {videoError}
          </span>
          <a
            href={asset.storage_url}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded bg-white/10 px-2 py-1 text-[10px] text-white hover:bg-white/20"
          >
            פתח בכרטיסיה חדשה ↗
          </a>
          <span className="text-[9px] text-slate-500">
            לרוב: קובץ .mov מ-iPhone/Mac בקודק HEVC שלא נתמך ב-Chrome על Windows
          </span>
        </div>
      );
    }
    return (
      <video
        src={asset.storage_url}
        controls
        preload="metadata"
        playsInline
        onError={(e) => {
          const err = (e.currentTarget as HTMLVideoElement).error;
          const codeLabel = err
            ? ({
                1: "MEDIA_ERR_ABORTED",
                2: "MEDIA_ERR_NETWORK",
                3: "MEDIA_ERR_DECODE — codec לא נתמך",
                4: "MEDIA_ERR_SRC_NOT_SUPPORTED — קובץ או codec לא נתמכים",
              }[err.code] ?? `code ${err.code}`)
            : "unknown_error";
          setVideoError(codeLabel);
        }}
        className="h-full w-full bg-slate-900 object-cover"
      />
    );
  }

  return <TilePlaceholder asset={asset} />;
}

interface AssetTileProps {
  asset: CreativeAsset;
  ads: MetaAdWithCreative[];
  usage: CreativeUsage;
  showCampaignChip?: boolean;
  showDelete?: boolean;
  footer?: React.ReactNode;
}

export function AssetTile({
  asset,
  ads,
  usage,
  showCampaignChip = true,
  showDelete = true,
  footer,
}: AssetTileProps) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  const campaigns = useAssetCampaigns(ads);
  const lifecycle = lifecycleOf(asset, usage);
  const ctr = readNumber(asset.performance_snapshot?.ctr);
  const hookRate = readNumber(asset.performance_snapshot?.hook_rate);
  const spend = readNumber(asset.performance_snapshot?.spend);

  async function onDelete() {
    if (!confirm("למחוק את הנכס?")) return;
    setErr(null);
    start(async () => {
      const res = await fetch(`/api/gallery/${asset.id}/delete`, {
        method: "POST",
      });
      if (!res.ok) {
        const body = await res
          .json()
          .catch(() => ({ error: res.statusText }));
        setErr(body.error ?? "delete_failed");
        return;
      }
      router.refresh();
    });
  }

  const lifecycleBadge = LIFECYCLE_BADGE[lifecycle];
  const isLearning =
    lifecycle === "live" && ctr == null && hookRate == null && spend == null;
  const hasMetrics = ctr != null || hookRate != null || spend != null;

  return (
    <div className="group flex flex-col gap-2.5">
      {/* Tile image / placeholder — aspect-square per brief mockup. The
          outer ring + halo cue lifecycle at a glance; on hover the tile lifts
          gently with a warm brand-tinted shadow. */}
      <div
        className={`relative aspect-square w-full overflow-hidden rounded-xl bg-card transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_18px_44px_-10px_hsl(28_91%_54%/0.30)] ${LIFECYCLE_BORDER[lifecycle]}`}
      >
        <MediaThumbnail asset={asset} />

        {isNew(asset) ? (
          <span className="absolute start-2 top-2 inline-flex items-center rounded-md bg-brand-500 px-1.5 py-[3px] text-[10px] font-bold uppercase tracking-[0.14em] text-white shadow-[0_2px_8px_hsl(28_91%_54%/0.55)]">
            NEW
          </span>
        ) : null}

        <span
          className={`absolute end-2 top-2 inline-flex items-center rounded-md px-2 py-[3px] text-[10px] font-semibold ${lifecycleBadge.className}`}
        >
          {lifecycleBadge.label}
        </span>
      </div>

      {/* Below-tile metadata — filename + status pill, tight column. Service
          tag / angle / source / campaign chips moved to a hover-revealed
          row so the resting state stays as clean as the mockup. */}
      <div className="flex flex-col gap-1.5 px-0.5">
        <div className="flex items-baseline justify-between gap-2">
          {asset.storage_url ? (
            <a
              href={asset.storage_url}
              target="_blank"
              rel="noopener noreferrer"
              className="truncate text-[13px] font-medium text-foreground hover:underline"
              title={`${asset.original_filename ?? asset.id} — לחץ לפתיחה בכרטיסיה חדשה`}
            >
              {asset.original_filename ?? "—"}
            </a>
          ) : (
            <h4
              className="truncate text-[13px] font-medium text-foreground"
              title={asset.original_filename ?? asset.id}
            >
              {asset.original_filename ?? "—"}
            </h4>
          )}
          {asset.aspect_ratio ? (
            <span className="mono-ltr shrink-0 text-[10px] text-muted-foreground/80">
              {asset.aspect_ratio}
            </span>
          ) : null}
        </div>

        {/* Primary status row — learning pill / metrics / draft hint. One row,
            never two. Keeps the grid quiet so the eye scans down the column. */}
        {isLearning ? (
          <div className="inline-flex items-center gap-1.5 self-start rounded-md border border-brand-500/30 bg-brand-500/10 px-2 py-1 text-[10.5px] font-medium text-brand-700 dark:text-brand-300">
            <span
              aria-hidden
              className="inline-block h-1.5 w-1.5 animate-pulse-soft rounded-full bg-brand-500 shadow-[0_0_6px_hsl(28_91%_54%/0.7)]"
            />
            אוסף נתונים — פחות מ-1,000 חשיפות
          </div>
        ) : hasMetrics ? (
          <div className="mono-ltr flex flex-wrap items-center gap-x-3 gap-y-0.5 rounded-md bg-foreground/[0.04] px-2 py-1 text-[10.5px] text-muted-foreground">
            {ctr != null ? (
              <span>
                CTR <span className="text-foreground">{ctr.toFixed(2)}%</span>
              </span>
            ) : null}
            {hookRate != null ? (
              <span>
                Hook <span className="text-foreground">{hookRate.toFixed(0)}%</span>
              </span>
            ) : null}
            {spend != null ? (
              <span>
                <span className="text-foreground">₪{spend.toFixed(0)}</span>
              </span>
            ) : null}
          </div>
        ) : lifecycle === "draft" ? (
          <div className="text-[10.5px] text-muted-foreground/80">
            עוד לא רץ — צריך לחבר לקמפיין
          </div>
        ) : null}

        {/* Secondary chips — service tag / angle / source / campaigns. Visible
            on hover only so the grid stays clean. Operator can still see them
            on a per-tile basis without leaving the page. */}
        <div className="flex flex-col gap-1 opacity-0 transition-opacity duration-150 group-hover:opacity-100">
          {asset.service_tag || asset.marketing_angle || asset.generated_by ? (
            <div className="flex flex-wrap gap-1 text-[9.5px]">
              {asset.service_tag ? (
                <span className="rounded bg-blue-50 px-1.5 py-0.5 text-blue-800 dark:bg-blue-950/40 dark:text-blue-300">
                  {asset.service_tag}
                </span>
              ) : null}
              {asset.marketing_angle ? (
                <span className="rounded bg-amber-50 px-1.5 py-0.5 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
                  {asset.marketing_angle}
                </span>
              ) : null}
              {asset.generated_by ? (
                <span className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                  {SOURCE_LABEL_HE[asset.generated_by]}
                </span>
              ) : null}
            </div>
          ) : null}

          {showCampaignChip && campaigns.length > 0 ? (
            <div className="flex flex-wrap gap-1">
              {campaigns.map((c) => (
                <a
                  key={c.id}
                  href={`https://www.facebook.com/adsmanager/manage/campaigns?act=&selected_campaign_ids=${c.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 rounded bg-emerald-50 px-1.5 py-0.5 text-[9.5px] text-emerald-900 hover:bg-emerald-100 dark:bg-emerald-950/40 dark:text-emerald-300"
                  title={`${c.name} · ${c.effective_status ?? ""}`}
                >
                  <span className="max-w-[140px] truncate">{c.name}</span>
                  <span className="mono-ltr opacity-60">
                    #{shortCampaignId(c.id)}
                  </span>
                  <ExternalLink className="h-2.5 w-2.5 opacity-60" />
                </a>
              ))}
            </div>
          ) : null}
        </div>

        {footer}

        {err ? <p className="text-[11px] text-red-600">{err}</p> : null}
        {showDelete ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={onDelete}
            disabled={pending || !!asset.meta_creative_id}
            title={
              asset.meta_creative_id
                ? "נכס חי במטא — לא ניתן למחוק"
                : undefined
            }
            className="h-6 justify-start gap-1 px-1 text-[10.5px] text-muted-foreground/70 opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100"
          >
            <Trash2 className="h-3 w-3" />
            {pending ? "מוחק..." : "מחק"}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
