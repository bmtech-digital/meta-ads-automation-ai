"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { CreativeAsset } from "@/lib/db/types";
import type { AdInsightsRow, MetaAdWithCreative } from "@/lib/meta";
import { AssetTile } from "./asset-tile";
import {
  buildPriorityQueue,
  groupLiveMetaCreativesByCampaign,
  type CreativeUsage,
  type LiveMetaCampaignGroup,
  type LiveMetaCreative,
  type OrganicPost,
  type PerformanceGrade,
} from "./scoring";

interface SectionHeaderProps {
  title: string;
  subtitle?: string;
  count?: number;
  right?: React.ReactNode;
}

function SectionHeader({ title, subtitle, count, right }: SectionHeaderProps) {
  return (
    <div className="flex items-end justify-between gap-4">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">
          {title}
          {typeof count === "number" ? (
            <span className="ms-2 text-base font-normal text-muted-foreground">({count})</span>
          ) : null}
        </h2>
        {subtitle ? <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p> : null}
      </div>
      {right ? <div>{right}</div> : null}
    </div>
  );
}

interface LiveSectionProps {
  assets: CreativeAsset[];
  usage: CreativeUsage;
  adInsights: Record<string, AdInsightsRow>;
  videoSources: Record<string, string>;
  metaError: string | null;
  organicPosts: OrganicPost[];
}

export function LiveSection({
  assets,
  usage,
  adInsights,
  videoSources,
  metaError,
  organicPosts,
}: LiveSectionProps) {
  const groups = useMemo(
    () => groupLiveMetaCreativesByCampaign(usage, assets, adInsights, videoSources),
    [usage, assets, adInsights, videoSources],
  );
  const liveCreativesCount = groups.reduce((s, g) => s + g.creatives.length, 0);
  const total = liveCreativesCount + organicPosts.length;

  return (
    <section className="flex flex-col gap-6">
      <SectionHeader
        title="באוויר עכשיו"
        subtitle="כל מה שמשודר עכשיו — פרסומות חיות + פוסטים אורגניים שכבר מפורסמים"
        count={total}
      />
      {metaError ? (
        <p className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          לא הצלחתי לשלוף נתוני קמפיינים מ-Meta: {metaError}.
        </p>
      ) : null}

      <div className="flex flex-col gap-3">
        <SubsectionHeader
          title="פרסומות חיות"
          count={liveCreativesCount}
          subtitle="כל הקריאייטיבים שרצים בקמפיינים פעילים — מ-Ads Manager וגם אלו שעלו דרך הגלרייה"
        />
        {groups.length === 0 ? (
          <EmptyState text="אין מודעה חיה במטא כרגע." />
        ) : (
          // Flatten all groups into a single grid — each tile carries its
          // own campaign label so the grid stays readable without per-group
          // headers. Tiles from the same campaign cluster together because
          // groups are iterated in order.
          <TileGrid>
            {groups.flatMap((g) =>
              g.creatives.map((c) => (
                <LiveMetaCreativeTile key={c.creative_id} creative={c} />
              )),
            )}
          </TileGrid>
        )}
      </div>

      <div className="flex flex-col gap-3">
        <SubsectionHeader
          title="פוסטים אורגניים"
          count={organicPosts.length}
          subtitle="פוסטים שפורסמו בעמוד הפייסבוק וב-Instagram Business"
        />
        {organicPosts.length === 0 ? (
          <EmptyState text="אין פוסטים אורגניים זמינים. ודא שלטוקן יש pages_show_list, pages_read_engagement, instagram_basic." />
        ) : (
          <TileGrid>
            {organicPosts.map((p) => (
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
    <div className="flex items-baseline gap-3 border-b border-border/40 pb-1">
      <h3 className="text-base font-semibold">{title}</h3>
      <span className="text-xs text-muted-foreground">({count})</span>
      <span className="ms-auto text-[11px] text-muted-foreground">{subtitle}</span>
    </div>
  );
}

function OrganicLiveTile({ post }: { post: OrganicPost }) {
  const [playing, setPlaying] = useState(false);
  const thumb = post.thumbnail
    ? `/api/gallery/organic-thumbnail?src=${post.source}&url=${encodeURIComponent(post.thumbnail)}`
    : null;
  // Proxy IG/FB video through the same endpoint to strip the referer header —
  // direct CDN loads from <video src> sometimes 403 without it.
  const videoSrc = post.video_url
    ? `/api/gallery/organic-thumbnail?src=${post.source}&url=${encodeURIComponent(post.video_url)}`
    : null;
  const canPlay = post.isVideo && !!videoSrc;

  return (
    <div className="flex flex-col gap-2">
      <div className="group relative overflow-hidden rounded-xl bg-muted shadow-sm ring-1 ring-emerald-300/60 transition-shadow hover:shadow-md">
        <div className="relative aspect-square w-full">
          {playing && canPlay ? (
            <video
              src={videoSrc ?? undefined}
              poster={thumb ?? undefined}
              controls
              autoPlay
              playsInline
              className="h-full w-full bg-slate-900 object-cover"
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
                  className="absolute inset-0 flex items-center justify-center bg-black/0 transition-colors hover:bg-black/20"
                >
                  <span className="flex h-14 w-14 items-center justify-center rounded-full bg-white/90 text-slate-900 shadow-lg transition-transform group-hover:scale-110">
                    <svg viewBox="0 0 24 24" className="h-6 w-6 fill-current ms-1" aria-hidden>
                      <path d="M8 5v14l11-7z" />
                    </svg>
                  </span>
                </button>
              ) : null}
            </>
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-slate-900 text-xs text-slate-300">
              {post.isVideo ? "▶ וידאו אורגני" : "אין תצוגה מקדימה"}
            </div>
          )}
          <span
            className={`absolute end-2 top-2 rounded px-1.5 py-0.5 text-[10px] font-semibold text-white ${
              post.source === "facebook" ? "bg-blue-600" : "bg-pink-600"
            }`}
          >
            {post.source === "facebook" ? "FB" : "IG"}
          </span>
          <span className="absolute start-2 top-2 rounded-md bg-emerald-500 px-1.5 py-0.5 text-[10px] font-bold text-white shadow">
            חי
          </span>
          {post.isVideo && !playing ? (
            <span className="absolute bottom-2 start-2 rounded bg-black/70 px-1.5 py-0.5 text-[10px] text-white">
              ▶ וידאו
            </span>
          ) : null}
        </div>
      </div>
      <div className="flex flex-col gap-1.5 px-1">
        <span className="text-[11px] text-muted-foreground">
          {formatPostDate(post.timestamp)}
        </span>
        {post.caption ? (
          <p className="line-clamp-2 text-xs" dir="auto" title={post.caption}>
            {post.caption}
          </p>
        ) : (
          <p className="text-xs italic text-muted-foreground">ללא טקסט</p>
        )}
        {post.permalink ? (
          <a
            href={post.permalink}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[11px] text-blue-600 hover:underline"
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

const GRADE_STYLE: Record<PerformanceGrade, { bg: string; text: string; ring: string; label: string }> = {
  A: { bg: "bg-emerald-500", text: "text-white", ring: "ring-emerald-400", label: "מנצח" },
  B: { bg: "bg-sky-500", text: "text-white", ring: "ring-sky-400", label: "טוב" },
  C: { bg: "bg-amber-500", text: "text-white", ring: "ring-amber-400", label: "בינוני" },
  D: { bg: "bg-red-600", text: "text-white", ring: "ring-red-500", label: "חלש" },
  learning: { bg: "bg-slate-400", text: "text-white", ring: "ring-slate-400", label: "לומד" },
};

function PerformanceBadge({
  grade,
  score,
}: {
  grade: PerformanceGrade;
  score: number;
}) {
  const s = GRADE_STYLE[grade];
  const display = grade === "learning" ? "…" : grade;
  return (
    <div className={`flex flex-col items-center gap-0.5 rounded-md ${s.bg} px-2 py-1 ${s.text} shadow`}>
      <span className="text-base font-bold leading-none">{display}</span>
      {grade !== "learning" ? (
        <span className="text-[9px] font-mono opacity-90">{score > 0 ? `+${score}` : score}</span>
      ) : null}
    </div>
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
    <div className="flex flex-wrap gap-1 rounded bg-muted/40 px-2 py-1 text-[10px] font-mono text-muted-foreground">
      {chips.map((c) => (
        <span key={c}>{c}</span>
      ))}
    </div>
  );
}

// When Meta returns no insights row for an ad, we fall back to a synthetic
// "learning" performance object so the badge + reason still render — the
// user sees *why* there's no score (no data) instead of a silent fallback.
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

  // Meta CDN URLs (fbcdn.net) sometimes block direct browser loads — proxy
  // through our existing organic-thumbnail handler which strips referrer.
  const rawThumb = creative.thumbnail_url ?? creative.image_url;
  const thumb = rawThumb
    ? `/api/gallery/organic-thumbnail?src=meta&url=${encodeURIComponent(rawThumb)}`
    : null;
  const isVideo = !!creative.video_id;
  const canPlay = isVideo && !!creative.video_source_url;
  const fromGallery = !!creative.galleryAsset;
  const perf = creative.performance ?? NO_DATA_PERFORMANCE;
  const ringColor = GRADE_STYLE[perf.grade].ring;

  return (
    <div className="flex flex-col gap-2">
      {/* Per-tile header — campaign label so it's clear at any scroll depth
          which campaign this ad belongs to. */}
      <div className="flex items-center gap-2 px-1 text-[10px]">
        <span
          className="truncate font-semibold text-muted-foreground"
          title={`${creative.campaign_name} · #${creative.campaign_id}`}
        >
          {creative.campaign_name}
        </span>
        <span className="shrink-0 font-mono text-muted-foreground/70">
          #{creative.campaign_id.slice(-6)}
        </span>
        {creative.campaign_status && creative.campaign_status !== "ACTIVE" ? (
          <span className="shrink-0 rounded bg-amber-100 px-1 py-0.5 text-[9px] text-amber-900">
            {creative.campaign_status}
          </span>
        ) : null}
      </div>

      <div
        className={`group relative overflow-hidden rounded-xl bg-muted shadow-sm ring-2 ${ringColor} transition-shadow hover:shadow-md`}
      >
        <div className="relative aspect-square w-full">
          {playing && canPlay ? (
            <video
              src={creative.video_source_url ?? undefined}
              poster={thumb ?? undefined}
              controls
              autoPlay
              playsInline
              className="h-full w-full bg-slate-900 object-cover"
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
                  className="absolute inset-0 flex items-center justify-center bg-black/0 transition-colors hover:bg-black/20"
                >
                  <span className="flex h-14 w-14 items-center justify-center rounded-full bg-white/90 text-slate-900 shadow-lg transition-transform group-hover:scale-110">
                    <svg viewBox="0 0 24 24" className="h-6 w-6 fill-current ms-1" aria-hidden>
                      <path d="M8 5v14l11-7z" />
                    </svg>
                  </span>
                </button>
              ) : null}
            </>
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-slate-900 text-xs text-slate-300">
              {isVideo ? "▶ וידאו" : "אין תצוגה מקדימה"}
            </div>
          )}

          <div className="absolute start-2 top-2">
            <PerformanceBadge grade={perf.grade} score={perf.score} />
          </div>
          <span className="absolute end-2 top-2 rounded bg-blue-600 px-1.5 py-0.5 text-[10px] font-semibold text-white">
            Meta
          </span>
          {isVideo && !playing ? (
            <span className="absolute bottom-2 start-2 rounded bg-black/70 px-1.5 py-0.5 text-[10px] text-white">
              ▶ וידאו
            </span>
          ) : null}
          {fromGallery ? (
            <span className="absolute bottom-2 end-2 rounded bg-purple-600 px-1.5 py-0.5 text-[10px] font-semibold text-white">
              מהגלרייה
            </span>
          ) : null}
        </div>
      </div>
      <div className="flex flex-col gap-1.5 px-1">
        <div className="flex items-baseline justify-between gap-2">
          <h4
            className="truncate text-sm font-medium text-foreground"
            title={creative.name ?? creative.creative_id}
          >
            {creative.name ?? "ללא שם"}
          </h4>
          <span className="shrink-0 text-[10px] text-muted-foreground">
            {GRADE_STYLE[perf.grade].label}
          </span>
        </div>
        <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
          <span className="font-mono">#{creative.creative_id.slice(-9)}</span>
          {creative.ad_status !== "ACTIVE" ? (
            <span className="rounded bg-amber-100 px-1 py-0.5 text-amber-900">
              {creative.ad_status}
            </span>
          ) : null}
        </div>
        <MetricChips perf={perf} />
        {perf.reasons.length > 0 ? (
          <ul className="flex flex-col gap-0.5 text-[10px] text-muted-foreground">
            {perf.reasons.slice(0, 2).map((r, i) => (
              <li key={i} className="truncate" title={r}>
                · {r}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}

interface PrioritySectionProps {
  assets: CreativeAsset[];
  usage: CreativeUsage;
}

export function PrioritySection({ assets, usage }: PrioritySectionProps) {
  const items = useMemo(() => buildPriorityQueue(assets, usage), [assets, usage]);

  if (items.length === 0) return null;

  return (
    <section className="flex flex-col gap-4">
      <SectionHeader
        title="הבא בתור"
        subtitle="נכסי גלריה שעוד לא רצו במודעה — ממוינים לפי score שקוף"
        count={items.length}
      />
      <TileGrid>
        {items.slice(0, 12).map((item) =>
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
    <div className="flex flex-col gap-1.5 rounded-md border border-amber-200/60 bg-amber-50/50 p-2 dark:border-amber-900/40 dark:bg-amber-950/20">
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-900 dark:text-amber-300">
          <Sparkles className="h-3 w-3" />
          Score {score}
        </span>
        {state === "success" ? (
          <Link
            href="/approvals"
            className="text-[10px] font-medium text-emerald-700 hover:underline"
          >
            ✓ נשלח לאישור — פתח את התור
          </Link>
        ) : (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-6 px-2 text-[10px]"
            disabled={state === "pending"}
            onClick={onPromote}
          >
            {state === "pending" ? "שולח..." : "קדם לקמפיין"}
          </Button>
        )}
      </div>
      {state === "error" && errMsg ? (
        <p className="text-[10px] text-red-600" dir="auto" title={errMsg}>
          שגיאה: {errMsg}
        </p>
      ) : null}
      {reasons.length > 0 ? (
        <ul className="flex flex-col gap-0.5 text-[10px] text-muted-foreground">
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

// ---------- Archive ----------

type ArchiveSort = "newest" | "ctr" | "hook" | "most_used";

interface ArchiveSectionProps {
  assets: CreativeAsset[];
  usage: CreativeUsage;
  search: string;
}

export function ArchiveSection({ assets, usage, search }: ArchiveSectionProps) {
  const [sort, setSort] = useState<ArchiveSort>("newest");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return assets;
    return assets.filter((a) => {
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
  }, [assets, search, usage]);

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
          <EmptyState text="עוד לא הועלו נכסים. לחץ על + העלה נכס למעלה." />
        ) : (
          <EmptyState text="אין נכסים שתואמים את החיפוש." />
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
      className="h-9 rounded-md border border-input bg-background px-3 text-xs"
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
    <div className="grid grid-cols-2 gap-x-5 gap-y-6 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
      {children}
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="rounded-lg border border-dashed border-border/60 px-4 py-12 text-center text-sm text-muted-foreground">
      {text}
    </div>
  );
}

// Re-exports for convenience
export type { OrganicPost };
export { type MetaAdWithCreative };
