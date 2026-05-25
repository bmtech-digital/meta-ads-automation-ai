"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowUpLeft, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import type {
  LiveMetaCampaignGroup,
  LiveMetaCreative,
} from "./scoring";

/**
 * Cover Story — the single highest-scoring live creative across all active
 * campaigns. The whole composition reads like the cover spread of a
 * magazine: a marquee Roman numeral ("I."), an "Above-the-fold" kicker,
 * a portrait frame with the creative, a metric anatomy that names each
 * number, and a one-sentence dek explaining the agent's recommendation.
 *
 * The duplicate CTA writes a `new_creative` approval per target campaign;
 * nothing publishes until the operator approves each one, per HITL.
 */
export function LeadingCreativeHero({
  groups,
}: {
  groups: LiveMetaCampaignGroup[];
}) {
  const winner = useMemo(() => pickWinner(groups), [groups]);
  const otherCampaignCount = useMemo(() => {
    if (!winner) return 0;
    return groups.filter((g) => g.id !== winner.campaign_id).length;
  }, [groups, winner]);

  if (!winner || !winner.performance) return null;
  if (winner.performance.grade === "learning") return null;

  const m = winner.performance.metrics;
  const rawThumb = winner.thumbnail_url ?? winner.image_url;
  const thumb = rawThumb
    ? `/api/gallery/organic-thumbnail?src=meta&url=${encodeURIComponent(rawThumb)}`
    : null;
  const isVideo = !!winner.video_id;
  const displayName = winner.name
    ? extractDisplayName(winner.name)
    : `Creative · #${winner.creative_id.slice(-6)}`;

  return (
    <section className="relative">
      {/* Top kicker bar — date stripe + section name */}
      <div className="mb-5 flex flex-wrap items-baseline gap-x-4 gap-y-1 font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
        <span className="text-brand-400">Cover Story</span>
        <span aria-hidden className="h-px w-8 bg-border" />
        <span>Performance leader · this week</span>
        <span aria-hidden className="ms-auto h-px w-12 bg-border" />
        <span className="mono-ltr">SCORE · {winner.performance.score}</span>
      </div>

      <div className="grid grid-cols-1 gap-x-10 gap-y-8 lg:grid-cols-[auto_minmax(0,420px)_minmax(0,1fr)] lg:items-stretch">
        {/* Marquee numeral — the visual anchor */}
        <div className="hidden flex-col items-end justify-start gap-3 ps-0 pe-2 lg:flex">
          <span
            aria-hidden
            className="font-editorial text-[160px] font-medium leading-[0.78] tracking-[-0.04em] text-brand-400/85"
          >
            I.
          </span>
          <span className="font-mono text-[9.5px] uppercase tracking-[0.22em] text-muted-foreground">
            issue · {currentIssueShort()}
          </span>
        </div>

        {/* Portrait frame */}
        <figure className="group relative w-full overflow-hidden rounded-md border border-border bg-card shadow-ds-md">
          <div className="relative aspect-[4/5] w-full overflow-hidden">
            {thumb ? (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={thumb}
                  alt={displayName}
                  className="h-full w-full object-cover transition-transform duration-700 ease-out group-hover:scale-[1.02]"
                  referrerPolicy="no-referrer"
                  loading="lazy"
                />
                <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-background/55 via-transparent to-transparent" />
              </>
            ) : (
              <HeroPlaceholder kindLabel={isVideo ? "Video" : "Static"} />
            )}
          </div>

          {/* Plate caption */}
          <figcaption className="flex items-center justify-between gap-3 border-t border-border bg-card px-4 py-2.5 text-[10.5px]">
            <span className="font-mono uppercase tracking-[0.18em] text-muted-foreground">
              Plate 01 · {isVideo ? "video" : "still"}
            </span>
            <span className="mono-ltr text-muted-foreground">
              #{winner.creative_id.slice(-10)}
            </span>
          </figcaption>
        </figure>

        {/* Editorial body */}
        <div className="flex flex-col gap-7 lg:py-1">
          <div className="flex flex-col gap-2">
            <span className="font-mono text-[10.5px] uppercase tracking-[0.18em] text-muted-foreground">
              הקריאייטיב המוביל השבוע
            </span>
            <h2
              className="line-clamp-3 font-display text-[26px] font-semibold leading-[1.15] tracking-[-0.02em] text-foreground lg:text-[30px]"
              title={winner.name ?? winner.creative_id}
              dir="auto"
            >
              {displayName}
            </h2>
            <p
              className="font-editorial text-[14px] italic leading-snug text-muted-foreground"
              dir="auto"
            >
              קמפיין: <span className="not-italic">{winner.campaign_name}</span>
              <span className="mx-2 text-border">·</span>
              <span className="mono-ltr not-italic">#{winner.campaign_id.slice(-8)}</span>
            </p>
          </div>

          {/* Metric anatomy — labelled diagram style */}
          <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
            {m.spend != null && m.spend > 0 ? (
              <MetricCell label="הוצאה" value={`₪${m.spend.toFixed(0)}`} />
            ) : null}
            {m.hook_rate != null ? (
              <MetricCell
                label="Hook"
                value={`${m.hook_rate.toFixed(0)}%`}
                hint={m.hook_rate >= 30 ? "מעל הסף 30%" : undefined}
              />
            ) : null}
            {m.ctr != null ? (
              <MetricCell
                label="CTR"
                value={`${m.ctr.toFixed(2)}%`}
                hint={m.ctr >= 1.5 ? "מעל הממוצע" : undefined}
              />
            ) : null}
            {m.impressions != null && m.impressions >= 1000 ? (
              <MetricCell
                label="חשיפות"
                value={m.impressions.toLocaleString("en")}
              />
            ) : null}
          </dl>

          {winner.performance.reasons.length > 0 ? (
            <p
              className="max-w-prose text-[13.5px] leading-relaxed text-muted-foreground"
              dir="auto"
            >
              {buildHeroBlurb(winner, otherCampaignCount)}
            </p>
          ) : null}

          <div className="flex flex-wrap items-center gap-3 pt-1">
            {otherCampaignCount > 0 ? (
              <DuplicateButton
                creativeId={winner.creative_id}
                campaignId={winner.campaign_id}
                targetCount={otherCampaignCount}
              />
            ) : (
              <span className="text-[12px] text-muted-foreground">
                אין קמפיינים פעילים נוספים לשכפול אליהם
              </span>
            )}
            <Link
              href={`https://www.facebook.com/adsmanager/manage/ads/edit?selected_ad_ids=${winner.ad_id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="group/details inline-flex items-center gap-1.5 text-[12.5px] font-medium text-foreground transition-colors hover:text-brand-400"
            >
              פרטים מלאים ב-Ads Manager
              <ArrowUpLeft className="h-3.5 w-3.5 transition-transform group-hover/details:-translate-x-0.5 group-hover/details:-translate-y-0.5" />
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}

function MetricCell({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="border-t border-border pt-3">
      <dt className="font-mono text-[9.5px] uppercase tracking-[0.18em] text-muted-foreground">
        {label}
      </dt>
      <dd className="mono-ltr mt-1.5 text-[26px] font-medium leading-none tracking-[-0.025em] tabular-nums text-foreground">
        {value}
      </dd>
      {hint ? (
        <span className="mt-1.5 inline-block font-editorial text-[10.5px] italic text-success">
          ↑ {hint}
        </span>
      ) : null}
    </div>
  );
}

function HeroPlaceholder({ kindLabel }: { kindLabel: string }) {
  return (
    <div className="flex h-full w-full items-center justify-center bg-muted">
      <div className="flex flex-col items-center gap-3 text-muted-foreground">
        <span className="font-editorial text-[64px] italic" aria-hidden>
          ?
        </span>
        <span className="font-mono text-[10.5px] uppercase tracking-[0.22em]">
          {kindLabel}
        </span>
      </div>
    </div>
  );
}

function DuplicateButton({
  creativeId,
  campaignId,
  targetCount,
}: {
  creativeId: string;
  campaignId: string;
  targetCount: number;
}) {
  const [state, setState] = useState<"idle" | "pending" | "sent" | "error">(
    "idle",
  );
  const [err, setErr] = useState<string | null>(null);

  async function onClick() {
    setState("pending");
    setErr(null);
    try {
      const res = await fetch("/api/gallery/duplicate-winner", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source_creative_id: creativeId,
          source_campaign_id: campaignId,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setErr(body.error ?? `HTTP ${res.status}`);
        setState("error");
        return;
      }
      setState("sent");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "request_failed");
      setState("error");
    }
  }

  if (state === "sent") {
    return (
      <Link
        href="/approvals"
        className="inline-flex items-center gap-1.5 rounded-md border border-success/30 bg-success/10 px-3.5 py-2 text-[12.5px] font-medium text-success hover:bg-success/15"
      >
        ✓ נשלח לאישור — פתח את התור
      </Link>
    );
  }

  return (
    <Button
      type="button"
      variant="brand"
      size="sm"
      onClick={onClick}
      disabled={state === "pending"}
      className="gap-1.5"
      title={err ?? `יוצר ${targetCount} הצעות אישור — אחת לכל קמפיין פעיל אחר`}
    >
      <Copy className="h-3.5 w-3.5" />
      {state === "pending"
        ? "שולח..."
        : state === "error"
          ? `שגיאה: ${err ?? "..."}`
          : `שכפל ל-${targetCount} קמפיינים`}
    </Button>
  );
}

function pickWinner(
  groups: LiveMetaCampaignGroup[],
): LiveMetaCreative | null {
  let best: LiveMetaCreative | null = null;
  for (const g of groups) {
    for (const c of g.creatives) {
      const score = c.performance?.score ?? -Infinity;
      const bestScore = best?.performance?.score ?? -Infinity;
      if (score > bestScore) {
        best = c;
        continue;
      }
      if (score === bestScore && score > -Infinity) {
        const spend = c.performance?.metrics.spend ?? 0;
        const bestSpend = best?.performance?.metrics.spend ?? 0;
        if (spend > bestSpend) best = c;
      }
    }
  }
  return best;
}

// Creative names from the agent often have a date-stamp + hex ID suffix —
// strip it so the title reads as headline copy.
function extractDisplayName(raw: string): string {
  return raw
    .replace(/[\s\-_·]*\d{4}-\d{2}-\d{2}[\s\-_·]*[0-9a-f]{16,}\s*$/i, "")
    .replace(/[\s\-_·]*[0-9a-f]{20,}\s*$/i, "")
    .trim();
}

function buildHeroBlurb(
  winner: LiveMetaCreative,
  otherCampaignCount: number,
): string {
  const m = winner.performance!.metrics;
  const parts: string[] = [];
  if (otherCampaignCount > 0) {
    parts.push(
      `הסוכן מציע לשכפל את הקריאייטיב הזה ל-${otherCampaignCount} קמפיינים נוספים.`,
    );
  }
  if (m.ctr != null && m.ctr >= 1.5) {
    parts.push(`CTR ${m.ctr.toFixed(2)}% — מעל הממוצע (1.0%).`);
  }
  if (m.hook_rate != null && m.hook_rate >= 30) {
    parts.push(`Hook rate ${m.hook_rate.toFixed(0)}% — מעל הסף של 30%.`);
  }
  return parts.join(" ");
}

function currentIssueShort(): string {
  const d = new Date();
  const months = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];
  return `${months[d.getMonth()]} ${String(d.getFullYear()).slice(-2)}`;
}
