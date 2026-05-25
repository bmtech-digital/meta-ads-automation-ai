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
 * Lifecycle — small mono-caps inline marker beside the frame index. Reads
 * like a print "status code" rather than a coloured stamp. Only winning
 * adds a thin underline accent in brand amber.
 */
const LIFECYCLE_LABEL: Record<
  Lifecycle,
  { he: string; tone: string }
> = {
  draft: { he: "draft", tone: "text-muted-foreground" },
  live: { he: "live", tone: "text-success" },
  winning: { he: "winner", tone: "text-success" },
  fatiguing: { he: "fatigue", tone: "text-warning" },
  killed: { he: "killed", tone: "text-muted-foreground/70" },
};

/**
 * Single quiet placeholder. Every tile without a thumbnail reads as the
 * same muted surface with a serif "?" — like a missing-plate slug in a
 * print contact sheet.
 */
function TilePlaceholder({ asset }: { asset: CreativeAsset }) {
  const kindLabel =
    asset.kind === "video"
      ? asset.duration_seconds != null
        ? `Video · ${Math.round(Number(asset.duration_seconds))}s`
        : "Video"
      : asset.kind === "image"
        ? "Still"
        : asset.kind;
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-muted text-muted-foreground">
      <span aria-hidden className="font-editorial text-[44px] italic">
        ?
      </span>
      <span className="font-mono text-[10px] uppercase tracking-[0.18em]">
        {kindLabel}
      </span>
    </div>
  );
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

function formatAssetDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  try {
    return new Date(iso).toLocaleDateString("he-IL", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return null;
  }
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

function MediaThumbnail({ asset }: MediaThumbnailProps) {
  const [videoError, setVideoError] = useState<string | null>(null);

  if (!asset.storage_url) return <TilePlaceholder asset={asset} />;

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
        <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-muted px-4 py-3 text-center text-[11px] text-foreground">
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-warning">
            לא ניתן לנגן
          </span>
          <span className="font-mono text-[9.5px] text-muted-foreground" dir="auto">
            {videoError}
          </span>
          <a
            href={asset.storage_url}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-sm border border-border bg-card px-2 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-foreground hover:bg-secondary"
          >
            פתח קובץ ↗
          </a>
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
        className="h-full w-full bg-muted object-cover"
      />
    );
  }

  return <TilePlaceholder asset={asset} />;
}

interface AssetTileProps {
  asset: CreativeAsset;
  ads: MetaAdWithCreative[];
  usage: CreativeUsage;
  index?: number;
  showCampaignChip?: boolean;
  showDelete?: boolean;
  footer?: React.ReactNode;
}

export function AssetTile({
  asset,
  ads,
  usage,
  index,
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
  const dateLabel = formatAssetDate(asset.created_at);

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

  const lifecycleLabel = LIFECYCLE_LABEL[lifecycle];
  const isWinner = lifecycle === "winning";
  const isLearning =
    lifecycle === "live" && ctr == null && hookRate == null && spend == null;
  const hasMetrics = ctr != null || hookRate != null || spend != null;

  return (
    <article className="group flex flex-col gap-3">
      {/* Frame — hairline border, no rings. Hover shifts the border to a
          full strength, with no shadow, like turning the page of a folio. */}
      <div className="relative aspect-square w-full overflow-hidden rounded-sm border border-border/60 bg-card transition-colors duration-200 hover:border-border">
        <MediaThumbnail asset={asset} />

        {isNew(asset) ? (
          <span className="absolute end-2 top-2 inline-flex items-center rounded-sm border border-brand-400/40 bg-brand-400/15 px-1.5 py-[2px] font-mono text-[9.5px] font-semibold uppercase tracking-[0.18em] text-brand-400">
            new
          </span>
        ) : null}

        {isWinner ? (
          <span className="absolute start-2 top-2 rounded-sm border border-success/35 bg-success/15 px-1.5 py-[2px] font-mono text-[9.5px] font-semibold uppercase tracking-[0.18em] text-success">
            winner
          </span>
        ) : null}
      </div>

      <div className="flex flex-col gap-1.5 px-0.5">
        {/* Index + lifecycle stamp row */}
        <div className="flex items-baseline justify-between gap-3 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
          <div className="flex items-baseline gap-2.5">
            {typeof index === "number" ? (
              <span className="mono-ltr tabular-nums text-muted-foreground/85">
                № {String(index).padStart(2, "0")}
              </span>
            ) : null}
            <span
              className={`${lifecycleLabel.tone} ${isWinner ? "border-b border-brand-400 pb-0.5" : ""}`}
            >
              {lifecycleLabel.he}
            </span>
          </div>
          {asset.aspect_ratio ? (
            <span className="mono-ltr">{asset.aspect_ratio}</span>
          ) : null}
        </div>

        {/* Title — filename or generated name */}
        {asset.storage_url ? (
          <a
            href={asset.storage_url}
            target="_blank"
            rel="noopener noreferrer"
            className="truncate text-[13px] font-medium leading-snug text-foreground hover:underline"
            title={`${asset.original_filename ?? asset.id} — פתח בכרטיסיה חדשה`}
          >
            {asset.original_filename ?? "—"}
          </a>
        ) : (
          <h4
            className="truncate text-[13px] font-medium leading-snug text-foreground"
            title={asset.original_filename ?? asset.id}
          >
            {asset.original_filename ?? "—"}
          </h4>
        )}

        {/* Editorial subline — date + ratios in serif italic */}
        {dateLabel ? (
          <span className="font-editorial text-[11px] italic text-muted-foreground">
            {dateLabel}
          </span>
        ) : null}

        {/* Status row — one line max */}
        {isLearning ? (
          <div className="mt-0.5 inline-flex items-center gap-1.5 self-start font-mono text-[10px] uppercase tracking-[0.16em] text-warning">
            <span
              aria-hidden
              className="h-1.5 w-1.5 animate-pulse-soft rounded-full bg-warning"
            />
            <span>אוסף נתונים</span>
            <span className="text-muted-foreground/70">· &lt;1k impr</span>
          </div>
        ) : hasMetrics ? (
          <div className="mono-ltr mt-0.5 flex flex-wrap items-baseline gap-x-3 font-mono text-[10.5px] tabular-nums text-muted-foreground">
            {ctr != null ? (
              <span>
                CTR <span className="text-foreground">{ctr.toFixed(2)}%</span>
              </span>
            ) : null}
            {hookRate != null ? (
              <span>
                Hook{" "}
                <span className="text-foreground">{hookRate.toFixed(0)}%</span>
              </span>
            ) : null}
            {spend != null ? (
              <span>
                ₪<span className="text-foreground">{spend.toFixed(0)}</span>
              </span>
            ) : null}
          </div>
        ) : lifecycle === "draft" ? (
          <span className="font-editorial text-[11px] italic text-muted-foreground/85">
            עוד לא רץ — צריך לחבר לקמפיין
          </span>
        ) : null}

        {/* Hover-revealed chips — tags + campaigns */}
        <div className="flex flex-col gap-1 opacity-0 transition-opacity duration-150 group-hover:opacity-100">
          {asset.service_tag || asset.marketing_angle || asset.generated_by ? (
            <div className="flex flex-wrap gap-1 font-mono text-[9.5px] uppercase tracking-[0.16em]">
              {asset.service_tag ? (
                <span className="rounded-sm border border-border bg-muted px-1.5 py-[2px] text-muted-foreground">
                  {asset.service_tag}
                </span>
              ) : null}
              {asset.marketing_angle ? (
                <span className="rounded-sm border border-border bg-muted px-1.5 py-[2px] text-muted-foreground">
                  {asset.marketing_angle}
                </span>
              ) : null}
              {asset.generated_by ? (
                <span className="rounded-sm border border-border bg-muted px-1.5 py-[2px] text-muted-foreground">
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
                  className="inline-flex items-center gap-1 rounded-sm border border-border bg-muted px-1.5 py-[2px] font-mono text-[9.5px] uppercase tracking-[0.14em] text-muted-foreground hover:border-foreground/30 hover:text-foreground"
                  title={`${c.name} · ${c.effective_status ?? ""}`}
                >
                  <span className="max-w-[140px] truncate normal-case tracking-normal">
                    {c.name}
                  </span>
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

        {err ? (
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-destructive">
            {err}
          </p>
        ) : null}
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
            className="h-6 justify-start gap-1 px-0 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100"
          >
            <Trash2 className="h-3 w-3" />
            {pending ? "מוחק..." : "מחק"}
          </Button>
        ) : null}
      </div>
    </article>
  );
}
