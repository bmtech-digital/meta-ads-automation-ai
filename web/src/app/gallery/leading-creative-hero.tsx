"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Sparkles, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import type {
  LiveMetaCampaignGroup,
  LiveMetaCreative,
} from "./scoring";

/**
 * Hero card — the single highest-scoring live creative across all active
 * campaigns, with key metrics and a one-click CTA to duplicate the winning
 * approach to other live campaigns.
 *
 * The card sits on the surface with a single 3px brand accent rule on the
 * leading edge (per design system §10 "Cards → Accent-rule"). No halo glow,
 * no neon ring. The "מנצח השבוע" eyebrow + a small Sparkles glyph carry the
 * "this is special" signal — colour and weight, not effects.
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
  const m = winner.performance.metrics;

  if (winner.performance.grade === "learning") return null;

  const rawThumb = winner.thumbnail_url ?? winner.image_url;
  const thumb = rawThumb
    ? `/api/gallery/organic-thumbnail?src=meta&url=${encodeURIComponent(rawThumb)}`
    : null;
  const isVideo = !!winner.video_id;
  const durationLabel = isVideo ? "Video" : "Static";

  return (
    <section className="relative overflow-hidden rounded-2xl border border-border bg-card shadow-ds-sm">
      {/* Accent rule on the leading edge — design system §10 Cards. */}
      <span
        aria-hidden
        className="absolute inset-y-0 start-0 w-[3px] bg-brand-400"
      />

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,360px)]">
        <div className="flex flex-col gap-5 p-6 lg:p-8">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-brand-400/30 bg-brand-400/10 px-2.5 py-1 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-brand-400">
              <Sparkles className="h-3 w-3" />
              מנצח השבוע
            </span>
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground">
              הקריאייטיב המוביל
            </span>
            <h2
              className="line-clamp-2 text-[20px] font-semibold leading-snug text-foreground lg:text-[22px]"
              title={winner.name ?? winner.creative_id}
              dir="auto"
            >
              {winner.name ? extractDisplayName(winner.name) : `Creative · #${winner.creative_id.slice(-6)}`}
            </h2>
            <span className="mono-ltr text-[11px] text-muted-foreground">
              #{winner.creative_id.slice(-12)}
            </span>
          </div>

          <div className="mono-ltr flex flex-wrap items-end gap-x-8 gap-y-3">
            {m.spend != null && m.spend > 0 ? (
              <Metric label="הוצאה" value={`₪${m.spend.toFixed(0)}`} />
            ) : null}
            {m.hook_rate != null ? (
              <Metric
                label="Hook"
                value={`${m.hook_rate.toFixed(0)}%`}
                hint={m.hook_rate >= 30 ? "מעל הסף 30%" : undefined}
              />
            ) : null}
            {m.ctr != null ? (
              <Metric
                label="CTR"
                value={`${m.ctr.toFixed(2)}%`}
                hint={m.ctr >= 1.5 ? "+ מעל הממוצע" : undefined}
              />
            ) : null}
            {m.impressions != null && m.impressions >= 1000 ? (
              <Metric
                label="חשיפות"
                value={m.impressions.toLocaleString("en")}
              />
            ) : null}
          </div>

          {winner.performance.reasons.length > 0 ? (
            <p
              className="max-w-prose text-[13.5px] leading-relaxed text-muted-foreground"
              dir="auto"
            >
              {buildHeroBlurb(winner, otherCampaignCount)}
            </p>
          ) : null}

          <div className="flex flex-wrap items-center gap-2 pt-1">
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
            <Button asChild variant="outline" size="sm">
              <Link
                href={`https://www.facebook.com/adsmanager/manage/ads/edit?selected_ad_ids=${winner.ad_id}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                פרטים מלאים
              </Link>
            </Button>
          </div>
        </div>

        <div className="relative bg-muted/40 lg:bg-transparent">
          <div className="relative h-full min-h-[260px] w-full overflow-hidden">
            {thumb ? (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={thumb}
                  alt={winner.name ?? "leading creative"}
                  className="h-full w-full object-cover"
                  referrerPolicy="no-referrer"
                  loading="lazy"
                />
                {isVideo ? (
                  <span className="absolute bottom-3 start-3 rounded-md border border-white/15 bg-black/65 px-2 py-0.5 text-[11px] font-medium text-white">
                    ▶ {durationLabel}
                  </span>
                ) : null}
              </>
            ) : (
              <HeroPlaceholder kindLabel={durationLabel} />
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function Metric({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </span>
      <span className="text-[22px] font-semibold leading-none tracking-[-0.01em] text-foreground">
        {value}
      </span>
      {hint ? (
        <span className="text-[10.5px] font-medium text-success">{hint}</span>
      ) : null}
    </div>
  );
}

function HeroPlaceholder({ kindLabel }: { kindLabel: string }) {
  return (
    <div
      className="flex h-full min-h-[260px] w-full items-center justify-center bg-muted text-[11px] font-mono uppercase tracking-[0.12em] text-muted-foreground"
      style={{
        backgroundImage:
          "repeating-linear-gradient(45deg, hsl(var(--muted-foreground) / 0.05) 0 10px, transparent 10px 20px)",
      }}
    >
      <div className="flex flex-col items-center gap-2">
        <span className="text-[22px] text-muted-foreground/70" aria-hidden>
          ◢◣
        </span>
        <span>{kindLabel}</span>
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

// Creative names from the agent often have a date-stamp + hex ID suffix
// ("…בזמן אמת -2026-05-18-4ccb78b3e3348a178bde89b86e2fe1e5"). Strip it for
// the headline — the standalone creative-id chip below the title carries
// the same information cleanly.
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
