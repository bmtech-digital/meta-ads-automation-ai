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
 * Section header — design system §02/§05 "sub-title" pattern: mono caps eyebrow
 * + a hairline rule that runs to the right edge. Reads as "documentation",
 * not "fashion brand". The optional count + subtitle live on the same baseline
 * so the header is one calm row regardless of width.
 */
interface SectionHeaderProps {
  title: string;
  subtitle?: string;
  count?: number;
  right?: React.ReactNode;
}

function SectionHeader({ title, subtitle, count, right }: SectionHeaderProps) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-4 gap-y-2">
      <div className="flex flex-1 items-center gap-3 min-w-0">
        <h2 className="font-mono text-[12px] font-medium uppercase tracking-[0.14em] text-foreground/80 whitespace-nowrap">
          {title}
        </h2>
        {typeof count === "number" ? (
          <span className="mono-ltr text-[11px] text-muted-foreground">
            ({count})
          </span>
        ) : null}
        <span aria-hidden className="hidden h-px flex-1 bg-border/60 sm:block" />
        {subtitle ? (
          <span className="hidden text-[12px] text-muted-foreground sm:inline-block">
            {subtitle}
          </span>
        ) : null}
      </div>
      {right ? <div>{right}</div> : null}
    </div>
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
      const haystack = [
        c.name ?? "",
        c.campaign_name,
        c.creative_id,
        c.ad_id,
      ]
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
    <section className="flex flex-col gap-6">
      <SectionHeader
        title="באוויר עכשיו"
        subtitle="כל מה שמשודר עכשיו — פרסומות חיות + פוסטים אורגניים"
        count={total}
      />
      {metaError ? (
        <div className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-[12px] text-warning">
          לא הצלחתי לשלוף נתוני קמפיינים מ-Meta: {metaError}.
        </div>
      ) : null}

      <div className="flex flex-col gap-4">
        <SubsectionHeader
          title="פרסומות חיות"
          count={filteredCreatives.length}
          subtitle="כל הקריאייטיבים שרצים בקמפיינים פעילים"
        />
        {filteredCreatives.length === 0 ? (
          <EmptyState
            text={
              q || lifecycleFilter !== "all"
                ? "אין פרסומות חיות שתואמות לחיפוש/לפילטר."
                : "אין מודעה חיה במטא כרגע."
            }
          />
        ) : (
          <TileGrid>
            {filteredCreatives.map((c) => (
              <LiveMetaCreativeTile key={c.creative_id} creative={c} />
            ))}
          </TileGrid>
        )}
      </div>

      <div className="flex flex-col gap-4">
        <SubsectionHeader
          title="פוסטים אורגניים"
          count={filteredOrganic.length}
          subtitle="פוסטים שפורסמו בעמוד הפייסבוק וב-Instagram Business"
        />
        {filteredOrganic.length === 0 ? (
          <EmptyState
            text={
              q || lifecycleFilter !== "all"
                ? "אין פוסטים אורגניים שתואמים לחיפוש/לפילטר."
                : "אין פוסטים אורגניים זמינים. ודא שלטוקן יש pages_show_list, pages_read_engagement, instagram_basic."
            }
          />
        ) : (
          <TileGrid>
            {filteredOrganic.map((p) => (
              <OrganicLiveTile key={`${p.source}:${p.id}`} post={p} />
            ))}
          </TileGrid>
        )}
      </div>
    </section>
  );
}

function SubsectionHeader({
  title,
  count,
  subtitle,
}: {
  title: string;
  count: number;
  subtitle: string;
}) {
  return (
    <div className="flex items-baseline gap-3">
      <h3 className="text-[13.5px] font-medium text-foreground">{title}</h3>
      <span className="mono-ltr text-[11px] text-muted-foreground">
        ({count})
      </span>
      <span className="ms-auto hidden text-[11.5px] text-muted-foreground sm:inline">
        {subtitle}
      </span>
    </div>
  );
}

// Source chip — neutral on resting tile (no Facebook-blue / Instagram-pink),
// reveals the platform name in a muted pill.
function SourceChip({ source }: { source: "facebook" | "instagram" }) {
  const label = source === "facebook" ? "FB" : "IG";
  return (
    <span className="inline-flex items-center rounded-md border border-white/15 bg-black/55 px-1.5 py-[3px] text-[10px] font-semibold text-white backdrop-blur-sm">
      {label}
    </span>
  );
}

function LiveDot() {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md border border-success/30 bg-success/15 px-1.5 py-[3px] text-[10px] font-semibold text-success">
      <span className="h-1.5 w-1.5 rounded-full bg-success animate-pulse-soft" />
      חי
    </span>
  );
}

function OrganicLiveTile({ post }: { post: OrganicPost }) {
  const [playing, setPlaying] = useState(false);
  const thumb = post.thumbnail
    ? `/api/gallery/organic-thumbnail?src=${post.source}&url=${encodeURIComponent(post.thumbnail)}`
    : null;
  const videoSrc = post.video_url
    ? `/api/gallery/organic-thumbnail?src=${post.source}&url=${encodeURIComponent(post.video_url)}`
    : null;
  const canPlay = post.isVideo && !!videoSrc;

  return (
    <div className="flex flex-col gap-2">
      <div className="group relative aspect-square w-full overflow-hidden rounded-xl border border-border/60 bg-card transition-all duration-200 hover:-translate-y-0.5 hover:border-border hover:shadow-ds-md">
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
        <div className="absolute end-2 top-2 flex gap-1">
          <SourceChip source={post.source} />
        </div>
        <div className="absolute start-2 top-2">
          <LiveDot />
        </div>
      </div>
      <div className="flex flex-col gap-1.5 px-0.5">
        <span className="font-mono text-[10.5px] text-muted-foreground">
          {formatPostDate(post.timestamp)}
        </span>
        {post.caption ? (
          <p className="line-clamp-2 text-[12.5px] leading-snug text-foreground" dir="auto" title={post.caption}>
            {post.caption}
          </p>
        ) : (
          <p className="text-[12px] italic text-muted-foreground">ללא טקסט</p>
        )}
        {post.permalink ? (
          <a
            href={post.permalink}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[10.5px] text-brand-400 hover:underline"
          >
            פתח ב-{post.source === "facebook" ? "Facebook" : "Instagram"} ↗
          </a>
        ) : null}
      </div>
    </div>
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

// Performance badge — single-line tinted pill in design-system semantic tokens.
const GRADE_PILL: Record<
  PerformanceGrade,
  { className: string; label: string }
> = {
  A: {
    className: "bg-success/15 text-success border-success/35",
    label: "מנצח",
  },
  B: {
    className: "bg-success/10 text-success border-success/25",
    label: "טוב",
  },
  C: {
    className: "bg-warning/12 text-warning border-warning/28",
    label: "בינוני",
  },
  D: {
    className: "bg-destructive/12 text-destructive border-destructive/30",
    label: "חלש",
  },
  learning: {
    className: "bg-muted text-muted-foreground border-border",
    label: "לומד",
  },
};

function PerformanceBadge({
  grade,
  score,
}: {
  grade: PerformanceGrade;
  score: number;
}) {
  const s = GRADE_PILL[grade];
  const showScore = grade !== "learning";
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md border px-1.5 py-[3px] text-[10px] font-semibold ${s.className}`}
    >
      <span>{s.label}</span>
      {showScore ? (
        <span className="mono-ltr opacity-70">
          {score > 0 ? `+${score}` : score}
        </span>
      ) : null}
    </span>
  );
}

function MetricChips({ perf }: { perf: NonNullable<LiveMetaCreative["performance"]> }) {
  const m = perf.metrics;
  const chips: string[] = [];
  if (m.impressions != null && m.impressions > 0) chips.push(`${m.impressions.toLocaleString()} impr`);
  if (m.ctr != null) chips.push(`CTR ${m.ctr.toFixed(2)}%`);
  if (m.hook_rate != null) chips.push(`Hook ${m.hook_rate.toFixed(0)}%`);
  if (m.frequency != null) chips.push(`Freq ${m.frequency.toFixed(1)}`);
  if (m.spend != null && m.spend > 0) chips.push(`₪${m.spend.toFixed(0)}`);
  if (m.conversions != null && m.conversions > 0) chips.push(`${m.conversions} conv`);
  if (chips.length === 0) return null;
  return (
    <div className="mono-ltr flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10.5px] text-muted-foreground">
      {chips.map((c) => (
        <span key={c}>{c}</span>
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

function LiveMetaCreativeTile({ creative }: { creative: LiveMetaCreative }) {
  const [playing, setPlaying] = useState(false);

  const rawThumb = creative.thumbnail_url ?? creative.image_url;
  const thumb = rawThumb
    ? `/api/gallery/organic-thumbnail?src=meta&url=${encodeURIComponent(rawThumb)}`
    : null;
  const isVideo = !!creative.video_id;
  const canPlay = isVideo && !!creative.video_source_url;
  const fromGallery = !!creative.galleryAsset;
  const perf = creative.performance ?? NO_DATA_PERFORMANCE;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2 px-0.5 text-[10.5px]">
        <span
          className="truncate font-medium text-muted-foreground"
          title={`${creative.campaign_name} · #${creative.campaign_id}`}
        >
          {creative.campaign_name}
        </span>
        <span className="mono-ltr shrink-0 text-muted-foreground/70">
          #{creative.campaign_id.slice(-6)}
        </span>
        {creative.campaign_status && creative.campaign_status !== "ACTIVE" ? (
          <span className="shrink-0 rounded-md border border-warning/25 bg-warning/10 px-1.5 py-[2px] text-[9.5px] text-warning">
            {creative.campaign_status}
          </span>
        ) : null}
      </div>

      <div className="group relative aspect-square w-full overflow-hidden rounded-xl border border-border/60 bg-card transition-all duration-200 hover:-translate-y-0.5 hover:border-border hover:shadow-ds-md">
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

        <div className="absolute start-2 top-2">
          <PerformanceBadge grade={perf.grade} score={perf.score} />
        </div>
        {fromGallery ? (
          <span className="absolute end-2 top-2 inline-flex items-center rounded-md border border-white/15 bg-black/55 px-1.5 py-[3px] text-[10px] font-semibold text-white backdrop-blur-sm">
            מהגלרייה
          </span>
        ) : null}
        {isVideo && !playing ? (
          <span className="absolute bottom-2 start-2 rounded-md border border-white/15 bg-black/65 px-1.5 py-[3px] text-[10px] text-white">
            ▶ וידאו
          </span>
        ) : null}
      </div>

      <div className="flex flex-col gap-1.5 px-0.5">
        <h4
          className="truncate text-[13px] font-medium text-foreground"
          title={creative.name ?? creative.creative_id}
        >
          {creative.name ?? "ללא שם"}
        </h4>
        <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
          <span className="mono-ltr">#{creative.creative_id.slice(-9)}</span>
          {creative.ad_status !== "ACTIVE" ? (
            <span className="rounded-md border border-warning/25 bg-warning/10 px-1.5 py-[2px] text-warning">
              {creative.ad_status}
            </span>
          ) : null}
        </div>
        <MetricChips perf={perf} />
      </div>
    </div>
  );
}

interface PrioritySectionProps {
  assets: CreativeAsset[];
  usage: CreativeUsage;
  search: string;
}

export function PrioritySection({ assets, usage, search }: PrioritySectionProps) {
  const items = useMemo(() => buildPriorityQueue(assets, usage), [assets, usage]);
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
    <section className="flex flex-col gap-4">
      <SectionHeader
        title="הבא בתור"
        subtitle="נכסי גלריה שעוד לא רצו במודעה — ממוינים לפי score שקוף"
        count={filtered.length}
      />
      <TileGrid>
        {filtered.slice(0, 12).map((item) =>
          item.asset ? (
            <AssetTile
              key={item.id}
              asset={item.asset}
              ads={[]}
              usage={usage}
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
      </TileGrid>
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
  const [state, setState] = useState<"idle" | "pending" | "success" | "error">("idle");
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
    <div className="flex flex-col gap-1.5 rounded-md border border-brand-400/25 bg-brand-400/[0.06] p-2">
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-brand-400">
          <Sparkles className="h-3 w-3" />
          Score {score}
        </span>
        {state === "success" ? (
          <Link
            href="/approvals"
            className="text-[10.5px] font-medium text-success hover:underline"
          >
            ✓ נשלח לאישור — פתח את התור
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
        <ul className="flex flex-col gap-0.5 text-[10.5px] text-muted-foreground">
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
    <section className="flex flex-col gap-4">
      <SectionHeader
        title="הארכיון"
        subtitle="כל הנכסים — חיים, טיוטות וכבויים"
        count={filtered.length}
        right={<SortPicker value={sort} onChange={setSort} />}
      />
      {sorted.length === 0 ? (
        assets.length === 0 ? (
          <EmptyState text="עוד לא הועלו נכסים. לחץ על + העלה למעלה." />
        ) : (
          <EmptyState text="אין נכסים שתואמים את החיפוש/הפילטר." />
        )
      ) : (
        <TileGrid>
          {sorted.map((a) => {
            const ads = a.meta_creative_id ? usage[a.meta_creative_id] ?? [] : [];
            return <AssetTile key={a.id} asset={a} ads={ads} usage={usage} />;
          })}
        </TileGrid>
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
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as ArchiveSort)}
      className="h-8 rounded-md border border-border bg-card px-2.5 text-[12px] text-foreground transition-colors hover:border-foreground/30 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-400/25"
      aria-label="מיון"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

function TileGrid({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-x-5 gap-y-7">
      {children}
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="rounded-xl border border-dashed border-border bg-background/40 px-4 py-12 text-center text-[13px] text-muted-foreground">
      {text}
    </div>
  );
}

export type { OrganicPost };
export { type MetaAdWithCreative };
