"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { CreativeAsset, CreativeAssetSource } from "@/lib/db/types";
import type { MetaAdWithCreative } from "@/lib/meta";
import { isLiveAd, lifecycleOf, readNumber, type CreativeUsage, type Lifecycle } from "./scoring";

const SOURCE_LABEL_HE: Record<CreativeAssetSource, string> = {
  imagen: "Imagen",
  gemini: "Gemini",
  manual_upload: "העלאה ידנית",
};

const LIFECYCLE_BADGE: Record<Lifecycle, { label: string; className: string }> = {
  draft: { label: "טיוטה", className: "bg-slate-200 text-slate-800" },
  live: { label: "חי", className: "bg-emerald-100 text-emerald-900" },
  winning: { label: "מנצח", className: "bg-emerald-200 text-emerald-950 ring-1 ring-emerald-400" },
  fatiguing: { label: "מתעייף", className: "bg-amber-200 text-amber-950 ring-1 ring-amber-400" },
  killed: { label: "כבוי", className: "bg-slate-300 text-slate-700" },
};

const LIFECYCLE_BORDER: Record<Lifecycle, string> = {
  draft: "ring-1 ring-border",
  live: "ring-1 ring-emerald-300/60",
  winning: "ring-2 ring-emerald-400",
  fatiguing: "ring-2 ring-amber-400",
  killed: "ring-1 ring-slate-300/60 opacity-70",
};

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
    return (
      <div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">
        {asset.kind}
      </div>
    );
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
            ? {
                1: "MEDIA_ERR_ABORTED",
                2: "MEDIA_ERR_NETWORK",
                3: "MEDIA_ERR_DECODE — codec לא נתמך",
                4: "MEDIA_ERR_SRC_NOT_SUPPORTED — קובץ או codec לא נתמכים",
              }[err.code] ?? `code ${err.code}`
            : "unknown_error";
          setVideoError(codeLabel);
        }}
        className="h-full w-full bg-slate-900 object-cover"
      />
    );
  }

  return (
    <div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">
      {asset.kind}
    </div>
  );
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
      const res = await fetch(`/api/gallery/${asset.id}/delete`, { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: res.statusText }));
        setErr(body.error ?? "delete_failed");
        return;
      }
      router.refresh();
    });
  }

  const lifecycleBadge = LIFECYCLE_BADGE[lifecycle];

  return (
    <div className="flex flex-col gap-2">
      <Card
        className={`group relative overflow-hidden rounded-xl border-0 ${LIFECYCLE_BORDER[lifecycle]} shadow-sm transition-shadow hover:shadow-md`}
      >
        <div className="relative aspect-square w-full bg-muted">
          <MediaThumbnail asset={asset} />

          {isNew(asset) ? (
            <span className="absolute start-2 top-2 rounded-md bg-orange-500 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white shadow">
              NEW
            </span>
          ) : null}

          <span
            className={`absolute end-2 top-2 rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${lifecycleBadge.className}`}
          >
            {lifecycleBadge.label}
          </span>
        </div>
      </Card>

      <div className="flex flex-col gap-1.5 px-1">
        <div className="flex items-baseline justify-between gap-2">
          {asset.storage_url ? (
            <a
              href={asset.storage_url}
              target="_blank"
              rel="noopener noreferrer"
              className="truncate text-sm font-medium text-foreground hover:underline"
              title={`${asset.original_filename ?? asset.id} — לחץ לפתיחה בכרטיסיה חדשה`}
            >
              {asset.original_filename ?? "—"}
            </a>
          ) : (
            <h4
              className="truncate text-sm font-medium text-foreground"
              title={asset.original_filename ?? asset.id}
            >
              {asset.original_filename ?? "—"}
            </h4>
          )}
          {asset.aspect_ratio ? (
            <span className="shrink-0 text-[10px] font-mono text-muted-foreground">
              {asset.aspect_ratio}
            </span>
          ) : null}
        </div>

        {(asset.service_tag || asset.marketing_angle || asset.generated_by) ? (
          <div className="flex flex-wrap gap-1 text-[10px]">
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
                className="inline-flex items-center gap-1 rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] text-emerald-900 hover:bg-emerald-100 dark:bg-emerald-950/40 dark:text-emerald-300"
                title={`${c.name} · ${c.effective_status ?? ""}`}
              >
                <span className="truncate max-w-[140px]">{c.name}</span>
                <span className="opacity-60 font-mono">#{shortCampaignId(c.id)}</span>
                <ExternalLink className="h-2.5 w-2.5 opacity-60" />
              </a>
            ))}
          </div>
        ) : null}

        {(ctr != null || hookRate != null || spend != null) ? (
          <div className="flex flex-wrap gap-2 rounded bg-muted/40 px-2 py-1 text-[10px] font-mono text-muted-foreground">
            {ctr != null ? <span>CTR {ctr.toFixed(2)}%</span> : null}
            {hookRate != null ? <span>Hook {hookRate.toFixed(0)}%</span> : null}
            {spend != null ? <span>Spend ₪{spend.toFixed(0)}</span> : null}
          </div>
        ) : null}

        {footer}

        {err ? <p className="text-[11px] text-red-600">{err}</p> : null}
        {showDelete ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={onDelete}
            disabled={pending || !!asset.meta_creative_id}
            title={asset.meta_creative_id ? "נכס חי במטא — לא ניתן למחוק" : undefined}
            className="h-7 justify-start gap-1 px-1 text-[11px] text-muted-foreground hover:text-foreground"
          >
            <Trash2 className="h-3 w-3" />
            {pending ? "מוחק..." : "מחק"}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
