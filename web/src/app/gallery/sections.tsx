"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { CreativeAsset } from "@/lib/db/types";
import type { MetaAdWithCreative } from "@/lib/meta";
import { AssetTile } from "./asset-tile";
import {
  buildPriorityQueue,
  lifecycleOf,
  lifecycleOfLiveMetaCreative,
  matchesLifecycleFilter,
  type CreativeUsage,
  type LifecycleFilter,
  type LiveMetaCampaignGroup,
  type LiveMetaCreative,
  type OrganicPost,
  type PerformanceGrade,
} from "./scoring";

/**
 * Section header — chapter mark. The Roman numeral sits as the visual
 * anchor (Frank Ruhl Libre), with a mono-caps kicker and a display title.
 * Count plate on the trailing edge formats like a magazine running-head.
 */
interface SectionHeaderProps {
  numeral: string;
  kicker: string;
  title: string;
  subtitle?: string;
  count?: number;
  unit?: string;
  right?: React.ReactNode;
}

function SectionHeader({
  numeral,
  kicker,
  title,
  subtitle,
  count,
  unit = "frames",
  right,
}: SectionHeaderProps) {
  return (
    <header className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-end gap-x-6 gap-y-2 border-b border-border/40 pb-5">
      <span
        aria-hidden
        className="font-editorial text-[64px] font-medium leading-[0.78] tracking-[-0.03em] text-brand-400/85 lg:text-[80px]"
      >
        {numeral}
      </span>

      <div className="flex flex-col gap-1.5 pb-2">
        <span className="font-mono text-[10.5px] uppercase tracking-[0.18em] text-muted-foreground">
          {kicker}
        </span>
        <h2 className="font-display text-[26px] font-semibold leading-none tracking-[-0.015em] text-foreground lg:text-[30px]">
          {title}
        </h2>
        {subtitle ? (
          <p className="text-[12.5px] leading-snug text-muted-foreground">
            {subtitle}
          </p>
        ) : null}
      </div>

      <div className="flex items-end gap-4 self-end pb-2">
        {right}
        {typeof count === "number" ? (
          <div className="flex flex-col items-end gap-0.5 text-end">
            <span className="mono-ltr text-[22px] font-medium leading-none tracking-[-0.025em] tabular-nums text-foreground">
              {String(count).padStart(2, "0")}
            </span>
            <span className="font-mono text-[9.5px] uppercase tracking-[0.18em] text-muted-foreground">
              {unit}
            </span>
          </div>
        ) : null}
      </div>
    </header>
  );
}

interface LiveSectionProps {
  groups: LiveMetaCampaignGroup[];
  metaError: string | null;
  organicPosts: OrganicPost[];
  search: string;
  lifecycleFilter: LifecycleFilter;
}

export function LiveSection({
  groups,
  metaError,
  organicPosts,
  search,
  lifecycleFilter,
}: LiveSectionProps) {
  const q = search.trim().toLowerCase();
  const filteredCreatives = useMemo(() => {
    const all: LiveMetaCreative[] = groups.flatMap((g) => g.creatives);
    return all.filter((c) => {
      const lc = lifecycleOfLiveMetaCreative(c);
      if (!matchesLifecycleFilter(lc, lifecycleFilter)) return false;
      if (!q) return true;
      const haystack = [c.name ?? "", c.campaign_name, c.creative_id, c.ad_id]
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [groups, lifecycleFilter, q]);

  const filteredOrganic = useMemo(() => {
    const lifecycleMatch =
      lifecycleFilter === "all" || lifecycleFilter === "live";
    if (!lifecycleMatch) return [];
    if (!q) return organicPosts;
    return organicPosts.filter((p) =>
      (p.caption ?? "").toLowerCase().includes(q),
    );
  }, [organicPosts, lifecycleFilter, q]);

  const total = filteredCreatives.length + filteredOrganic.length;

  return (
    <section className="flex flex-col gap-7">
      <SectionHeader
        numeral="II."
        kicker="Chapter II — On Air"
        title="באוויר עכשיו"
        subtitle="כל מה שמשודר עכשיו: פרסומות חיות + פוסטים אורגניים שמופיעים בפיד."
        count={total}
      />

      {metaError ? (
        <div className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-[12px] text-warning">
          לא הצלחתי לשלוף נתוני קמפיינים מ-Meta: {metaError}.
        </div>
      ) : null}

      <div className="flex flex-col gap-5">
        <SubsectionRule label="פרסומות חיות" count={filteredCreatives.length} />
        {filteredCreatives.length === 0 ? (
          <EmptyState
            text={
              q || lifecycleFilter !== "all"
                ? "אין פרסומות חיות שתואמות לחיפוש/לפילטר."
                : "אין מודעה חיה במטא כרגע."
            }
          />
        ) : (
          <ContactSheet>
            {filteredCreatives.map((c, i) => (
              <LiveMetaCreativeTile key={c.creative_id} creative={c} index={i + 1} />
            ))}
          </ContactSheet>
        )}
      </div>

      <div className="flex flex-col gap-5">
        <SubsectionRule label="פוסטים אורגניים" count={filteredOrganic.length} />
        {filteredOrganic.length === 0 ? (
          <EmptyState
            text={
              q || lifecycleFilter !== "all"
                ? "אין פוסטים אורגניים שתואמים לחיפוש/לפילטר."
                : "אין פוסטים אורגניים זמינים. ודא שלטוקן יש pages_show_list, pages_read_engagement, instagram_basic."
            }
          />
        ) : (
          <ContactSheet>
            {filteredOrganic.map((p, i) => (
              <OrganicLiveTile key={`${p.source}:${p.id}`} post={p} index={i + 1} />
            ))}
          </ContactSheet>
        )}
      </div>
    </section>
  );
}

function SubsectionRule({ label, count }: { label: string; count: number }) {
  return (
    <div className="flex items-baseline gap-3">
      <span className="font-mono text-[10.5px] uppercase tracking-[0.18em] text-muted-foreground/80">
        {label}
      </span>
      <span className="mono-ltr text-[10.5px] tabular-nums text-muted-foreground">
        ({String(count).padStart(2, "0")})
      </span>
      <span aria-hidden className="h-px flex-1 bg-border/40" />
    </div>
  );
}

/* ---------- Performance scoreplate (replaces the chunky pill) -------- */

const GRADE_PLATE: Record<
  PerformanceGrade,
  { letter: string; tone: string; label: string }
> = {
  A: { letter: "A", tone: "bg-success/15 text-success border-success/40", label: "מנצח" },
  B: { letter: "B", tone: "bg-success/10 text-success border-success/25", label: "טוב" },
  C: { letter: "C", tone: "bg-warning/12 text-warning border-warning/30", label: "בינוני" },
  D: { letter: "D", tone: "bg-destructive/12 text-destructive border-destructive/30", label: "חלש" },
  learning: {
    letter: "·",
    tone: "bg-muted text-muted-foreground border-border",
    label: "לומד",
  },
};

function Scoreplate({ grade }: { grade: PerformanceGrade }) {
  const p = GRADE_PLATE[grade];
  return (
    <span
      className={`inline-flex h-6 w-6 items-center justify-center rounded-sm border font-mono text-[11px] font-medium tracking-tight ${p.tone}`}
      title={p.label}
    >
      {p.letter}
    </span>
  );
}

/* ---------- Source chip for organic posts ---------- */

function SourceChip({ source }: { source: "facebook" | "instagram" }) {
  return (
    <span className="inline-flex items-center rounded-sm border border-white/15 bg-black/55 px-1.5 py-[2px] font-mono text-[9.5px] font-medium uppercase tracking-[0.18em] text-white backdrop-blur-sm">
      {source === "facebook" ? "FB" : "IG"}
    </span>
  );
}

function LiveDot() {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-sm border border-success/30 bg-success/15 px-1.5 py-[2px] font-mono text-[9.5px] font-semibold uppercase tracking-[0.16em] text-success">
      <span className="h-1.5 w-1.5 rounded-full bg-success animate-pulse-soft" />
      ON AIR
    </span>
  );
}

/* ---------- Contact-sheet tile bodies ---------- */

function ContactFrame({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`relative aspect-square w-full overflow-hidden rounded-sm border border-border/60 bg-card transition-colors duration-200 hover:border-border ${className}`}
    >
      {children}
    </div>
  );
}

function FrameIndex({ index }: { index: number }) {
  return (
    <span className="mono-ltr font-mono text-[10px] tabular-nums tracking-[0.18em] text-muted-foreground/85">
      № {String(index).padStart(2, "0")}
    </span>
  );
}

function OrganicLiveTile({
  post,
  index,
}: {
  post: OrganicPost;
  index: number;
}) {
  const [playing, setPlaying] = useState(false);
  const thumb = post.thumbnail
    ? `/api/gallery/organic-thumbnail?src=${post.source}&url=${encodeURIComponent(post.thumbnail)}`
    : null;
  const videoSrc = post.video_url
    ? `/api/gallery/organic-thumbnail?src=${post.source}&url=${encodeURIComponent(post.video_url)}`
    : null;
  const canPlay = post.isVideo && !!videoSrc;

  return (
    <article className="group flex flex-col gap-3">
      <ContactFrame>
        {playing && canPlay ? (
          <video
            src={videoSrc ?? undefined}
            poster={thumb ?? undefined}
            controls
            autoPlay
            playsInline
            className="h-full w-full bg-muted object-cover"
          />
        ) : thumb ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={thumb}
              alt={post.caption?.slice(0, 80) ?? `${post.source} post`}
              className="h-full w-full object-cover"
              referrerPolicy="no-referrer"
              loading="lazy"
            />
            {canPlay ? (
              <button
                type="button"
                onClick={() => setPlaying(true)}
                aria-label="הפעל וידאו"
                className="absolute inset-0 cursor-pointer bg-black/0 transition-colors hover:bg-black/15"
              />
            ) : null}
          </>
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-muted text-[11px] text-muted-foreground">
            {post.isVideo ? "▶ וידאו אורגני" : "אין תצוגה מקדימה"}
          </div>
        )}

        <div className="absolute end-2 top-2">
          <SourceChip source={post.source} />
        </div>
        <div className="absolute start-2 top-2">
          <LiveDot />
        </div>
        {post.isVideo && !playing ? (
          <span className="absolute bottom-2 start-2 rounded-sm border border-white/15 bg-black/65 px-1.5 py-[2px] font-mono text-[9.5px] uppercase tracking-[0.16em] text-white">
            video
          </span>
        ) : null}
      </ContactFrame>

      <div className="flex flex-col gap-1.5 px-0.5">
        <div className="flex items-baseline gap-2">
          <FrameIndex index={index} />
          <span className="font-editorial text-[11px] italic text-muted-foreground">
            {formatPostDate(post.timestamp)}
          </span>
        </div>
        {post.caption ? (
          <p
            className="line-clamp-2 text-[12.5px] leading-snug text-foreground"
            dir="auto"
            title={post.caption}
          >
            {post.caption}
          </p>
        ) : (
          <p className="font-editorial text-[12px] italic text-muted-foreground">
            ללא טקסט
          </p>
        )}
        {post.permalink ? (
          <a
            href={post.permalink}
            target="_blank"
            rel="noopener noreferrer"
            className="font-mono text-[10px] uppercase tracking-[0.18em] text-brand-400 transition-colors hover:text-brand-300"
          >
            open in {post.source === "facebook" ? "facebook" : "instagram"} ↗
          </a>
        ) : null}
      </div>
    </article>
  );
}

function formatPostDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("he-IL", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}

function MetricLine({ perf }: { perf: NonNullable<LiveMetaCreative["performance"]> }) {
  const m = perf.metrics;
  const parts: string[] = [];
  if (m.ctr != null) parts.push(`CTR ${m.ctr.toFixed(2)}%`);
  if (m.hook_rate != null) parts.push(`Hook ${m.hook_rate.toFixed(0)}%`);
  if (m.spend != null && m.spend > 0) parts.push(`₪${m.spend.toFixed(0)}`);
  if (m.impressions != null && m.impressions > 0)
    parts.push(`${(m.impressions / 1000).toFixed(1)}k impr`);
  if (parts.length === 0) return null;
  return (
    <div className="mono-ltr flex flex-wrap items-baseline gap-x-3 font-mono text-[10.5px] tabular-nums text-muted-foreground">
      {parts.map((p, i) => (
        <span key={p}>
          {i > 0 ? <span className="text-border me-3">·</span> : null}
          {p}
        </span>
      ))}
    </div>
  );
}

const NO_DATA_PERFORMANCE = {
  score: 0,
  grade: "learning" as const,
  reasons: ["אין נתוני ביצועים מ-Meta — המודעה כנראה עוד לא רצה או שהטוקן חסר ads_read"],
  metrics: {
    impressions: null,
    ctr: null,
    hook_rate: null,
    frequency: null,
    spend: null,
    conversions: null,
  },
};

function LiveMetaCreativeTile({
  creative,
  index,
}: {
  creative: LiveMetaCreative;
  index: number;
}) {
  const [playing, setPlaying] = useState(false);

  const rawThumb = creative.thumbnail_url ?? creative.image_url;
  const thumb = rawThumb
    ? `/api/gallery/organic-thumbnail?src=meta&url=${encodeURIComponent(rawThumb)}`
    : null;
  const isVideo = !!creative.video_id;
  const canPlay = isVideo && !!creative.video_source_url;
  const fromGallery = !!creative.galleryAsset;
  const perf = creative.performance ?? NO_DATA_PERFORMANCE;
  const displayName = creative.name
    ? extractDisplayName(creative.name)
    : "ללא שם";

  return (
    <article className="group flex flex-col gap-3">
      <ContactFrame>
        {playing && canPlay ? (
          <video
            src={creative.video_source_url ?? undefined}
            poster={thumb ?? undefined}
            controls
            autoPlay
            playsInline
            className="h-full w-full bg-muted object-cover"
          />
        ) : thumb ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={thumb}
              alt={creative.name ?? `creative ${creative.creative_id}`}
              className="h-full w-full object-cover"
              referrerPolicy="no-referrer"
              loading="lazy"
            />
            {canPlay ? (
              <button
                type="button"
                onClick={() => setPlaying(true)}
                aria-label="הפעל וידאו"
                className="absolute inset-0 cursor-pointer bg-black/0 transition-colors hover:bg-black/15"
              />
            ) : null}
          </>
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-muted text-[11px] text-muted-foreground">
            {isVideo ? "▶ וידאו" : "אין תצוגה מקדימה"}
          </div>
        )}

        <div className="absolute end-2 top-2">
          <Scoreplate grade={perf.grade} />
        </div>
        {fromGallery ? (
          <span className="absolute start-2 top-2 rounded-sm border border-white/15 bg-black/55 px-1.5 py-[2px] font-mono text-[9.5px] uppercase tracking-[0.16em] text-white backdrop-blur-sm">
            from gallery
          </span>
        ) : null}
        {isVideo && !playing ? (
          <span className="absolute bottom-2 start-2 rounded-sm border border-white/15 bg-black/65 px-1.5 py-[2px] font-mono text-[9.5px] uppercase tracking-[0.16em] text-white">
            video
          </span>
        ) : null}
      </ContactFrame>

      <div className="flex flex-col gap-1.5 px-0.5">
        <div className="flex items-baseline gap-2 text-muted-foreground">
          <FrameIndex index={index} />
          <span className="truncate font-mono text-[10px] uppercase tracking-[0.14em]">
            {creative.campaign_name}
          </span>
        </div>
        <h4
          className="truncate text-[13px] font-medium text-foreground"
          dir="auto"
          title={creative.name ?? creative.creative_id}
        >
          {displayName}
        </h4>
        <MetricLine perf={perf} />
        <div className="flex items-center gap-2 font-mono text-[9.5px] uppercase tracking-[0.16em] text-muted-foreground">
          <span className="mono-ltr">#{creative.creative_id.slice(-9)}</span>
          {creative.ad_status !== "ACTIVE" ? (
            <span className="rounded-sm border border-warning/25 bg-warning/10 px-1.5 py-[1px] text-warning">
              {creative.ad_status}
            </span>
          ) : null}
        </div>
      </div>
    </article>
  );
}

interface PrioritySectionProps {
  assets: CreativeAsset[];
  usage: CreativeUsage;
  search: string;
}

export function PrioritySection({
  assets,
  usage,
  search,
}: PrioritySectionProps) {
  const items = useMemo(
    () => buildPriorityQueue(assets, usage),
    [assets, usage],
  );
  const q = search.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (!q) return items;
    return items.filter((it) => {
      if (!it.asset) return false;
      const haystack = [
        it.asset.original_filename ?? "",
        it.asset.marketing_angle ?? "",
        it.asset.service_tag ?? "",
        it.asset.headline ?? "",
        it.asset.primary_text ?? "",
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [items, q]);

  if (filtered.length === 0) return null;

  return (
    <section className="flex flex-col gap-5">
      <SectionHeader
        numeral="III."
        kicker="Chapter III — Up Next"
        title="הבא בתור"
        subtitle="נכסי גלריה שעוד לא רצו במודעה — ממוינים לפי score שקוף."
        count={filtered.length}
        unit="candidates"
      />
      <ContactSheet>
        {filtered.slice(0, 12).map((item, i) =>
          item.asset ? (
            <AssetTile
              key={item.id}
              asset={item.asset}
              ads={[]}
              usage={usage}
              index={i + 1}
              showCampaignChip={false}
              footer={
                <PromoteFooter
                  assetId={item.asset.id}
                  score={item.score}
                  reasons={item.reasons}
                />
              }
            />
          ) : null,
        )}
      </ContactSheet>
    </section>
  );
}

function PromoteFooter({
  assetId,
  score,
  reasons,
}: {
  assetId: string;
  score: number;
  reasons: string[];
}) {
  const [state, setState] = useState<"idle" | "pending" | "success" | "error">(
    "idle",
  );
  const [errMsg, setErrMsg] = useState<string | null>(null);

  async function onPromote() {
    setState("pending");
    setErrMsg(null);
    try {
      const res = await fetch("/api/gallery/promote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ asset_id: assetId, score, reasons }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
          detail?: string;
        };
        setErrMsg(body.detail ?? body.error ?? `HTTP ${res.status}`);
        setState("error");
        return;
      }
      setState("success");
    } catch (e) {
      setErrMsg(e instanceof Error ? e.message : "request_failed");
      setState("error");
    }
  }

  return (
    <div className="flex flex-col gap-1.5 border-t border-border/60 pt-2">
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-baseline gap-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-brand-400">
          <Sparkles className="h-3 w-3" />
          score{" "}
          <span className="mono-ltr text-[12px] tabular-nums text-foreground">
            {score}
          </span>
        </span>
        {state === "success" ? (
          <Link
            href="/approvals"
            className="font-mono text-[10px] uppercase tracking-[0.18em] text-success hover:underline"
          >
            ✓ נשלח · פתח תור
          </Link>
        ) : (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-6 px-2 text-[10.5px]"
            disabled={state === "pending"}
            onClick={onPromote}
          >
            {state === "pending" ? "שולח..." : "קדם לקמפיין"}
          </Button>
        )}
      </div>
      {state === "error" && errMsg ? (
        <p className="text-[10.5px] text-destructive" dir="auto" title={errMsg}>
          שגיאה: {errMsg}
        </p>
      ) : null}
      {reasons.length > 0 ? (
        <ul className="flex flex-col gap-0.5 text-[10.5px] leading-snug text-muted-foreground">
          {reasons.slice(0, 3).map((r, i) => (
            <li key={i} className="truncate" title={r}>
              · {r}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

type ArchiveSort = "newest" | "ctr" | "hook" | "most_used";

interface ArchiveSectionProps {
  assets: CreativeAsset[];
  usage: CreativeUsage;
  search: string;
  lifecycleFilter: LifecycleFilter;
}

export function ArchiveSection({
  assets,
  usage,
  search,
  lifecycleFilter,
}: ArchiveSectionProps) {
  const [sort, setSort] = useState<ArchiveSort>("newest");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return assets.filter((a) => {
      const lc = lifecycleOf(a, usage);
      if (!matchesLifecycleFilter(lc, lifecycleFilter)) return false;
      if (!q) return true;
      const haystack = [
        a.original_filename ?? "",
        a.marketing_angle ?? "",
        a.service_tag ?? "",
        a.headline ?? "",
        a.primary_text ?? "",
        a.cta ?? "",
        ...(a.meta_creative_id
          ? (usage[a.meta_creative_id] ?? []).map((ad) => ad.campaign_name ?? "")
          : []),
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [assets, search, usage, lifecycleFilter]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    if (sort === "newest") {
      arr.sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""));
    } else if (sort === "ctr") {
      arr.sort((a, b) => {
        const av = Number(a.performance_snapshot?.ctr ?? -1);
        const bv = Number(b.performance_snapshot?.ctr ?? -1);
        return bv - av;
      });
    } else if (sort === "hook") {
      arr.sort((a, b) => {
        const av = Number(a.performance_snapshot?.hook_rate ?? -1);
        const bv = Number(b.performance_snapshot?.hook_rate ?? -1);
        return bv - av;
      });
    } else if (sort === "most_used") {
      arr.sort((a, b) => {
        const ac = a.meta_creative_id ? (usage[a.meta_creative_id] ?? []).length : 0;
        const bc = b.meta_creative_id ? (usage[b.meta_creative_id] ?? []).length : 0;
        return bc - ac;
      });
    }
    return arr;
  }, [filtered, sort, usage]);

  return (
    <section className="flex flex-col gap-5">
      <SectionHeader
        numeral="IV."
        kicker="Chapter IV — Archive"
        title="הארכיון"
        subtitle="כל הנכסים — חיים, טיוטות וכבויים. ממוינים לפי הציר שבחרת."
        count={filtered.length}
        unit="frames"
        right={<SortPicker value={sort} onChange={setSort} />}
      />
      {sorted.length === 0 ? (
        assets.length === 0 ? (
          <EmptyState text="עוד לא הועלו נכסים. לחץ על העלה למעלה." />
        ) : (
          <EmptyState text="אין נכסים שתואמים את החיפוש/הפילטר." />
        )
      ) : (
        <ContactSheet>
          {sorted.map((a, i) => {
            const ads = a.meta_creative_id ? usage[a.meta_creative_id] ?? [] : [];
            return (
              <AssetTile
                key={a.id}
                asset={a}
                ads={ads}
                usage={usage}
                index={i + 1}
              />
            );
          })}
        </ContactSheet>
      )}
    </section>
  );
}

function SortPicker({
  value,
  onChange,
}: {
  value: ArchiveSort;
  onChange: (s: ArchiveSort) => void;
}) {
  const options: { value: ArchiveSort; label: string }[] = [
    { value: "newest", label: "חדש ביותר" },
    { value: "ctr", label: "CTR גבוה" },
    { value: "hook", label: "Hook rate" },
    { value: "most_used", label: "הכי בשימוש" },
  ];
  return (
    <label className="flex items-baseline gap-2">
      <span className="font-mono text-[9.5px] uppercase tracking-[0.18em] text-muted-foreground">
        sort
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as ArchiveSort)}
        className="h-7 rounded-sm border-0 border-b border-border bg-transparent px-1 text-[12px] text-foreground transition-colors hover:border-foreground/40 focus:border-brand-400 focus:outline-none"
        aria-label="מיון"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

/**
 * Contact-sheet grid — five-up at desktop. Wider gutters than a standard
 * card grid so each frame breathes and the eye reads it as a sequence,
 * not a wall of thumbnails.
 */
function ContactSheet({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-x-6 gap-y-10">
      {children}
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-sm border border-dashed border-border/60 px-6 py-14 text-center">
      <span aria-hidden className="font-editorial text-[28px] italic text-muted-foreground/60">
        —
      </span>
      <p className="max-w-[44ch] text-[13px] leading-relaxed text-muted-foreground">
        {text}
      </p>
    </div>
  );
}

// Creative names from the agent often have a date-stamp + hex ID suffix.
function extractDisplayName(raw: string): string {
  return raw
    .replace(/[\s\-_·]*\d{4}-\d{2}-\d{2}[\s\-_·]*[0-9a-f]{16,}\s*$/i, "")
    .replace(/[\s\-_·]*[0-9a-f]{20,}\s*$/i, "")
    .trim() || raw;
}

export type { OrganicPost };
export { type MetaAdWithCreative };
