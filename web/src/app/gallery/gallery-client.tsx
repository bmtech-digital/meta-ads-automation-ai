"use client";

import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import type { CreativeAsset } from "@/lib/db/types";
import type {
  AdInsightsRow,
  FacebookPagePost,
  InstagramMedia,
} from "@/lib/meta";
import { UploadDialog } from "./upload-dialog";
import { LiveSection, PrioritySection, ArchiveSection } from "./sections";
import type { CreativeUsage, OrganicPost } from "./scoring";

export type { CreativeUsage } from "./scoring";

function fbToOrganic(p: FacebookPagePost): OrganicPost {
  return {
    source: "facebook",
    id: p.id,
    caption: p.message,
    thumbnail: p.full_picture,
    video_url: null, // FB Page posts via /published_posts don't expose video src directly
    permalink: p.permalink_url,
    timestamp: p.created_time,
    isVideo: false,
  };
}

function igToOrganic(m: InstagramMedia): OrganicPost {
  const isVideo = m.media_type === "VIDEO";
  // For VIDEO: thumbnail_url is the poster frame; media_url is the actual video.
  // For IMAGE/CAROUSEL: media_url is already an image URL.
  const thumb = isVideo ? (m.thumbnail_url ?? m.media_url) : m.media_url;
  return {
    source: "instagram",
    id: m.id,
    caption: m.caption,
    thumbnail: thumb,
    video_url: isVideo ? m.media_url : null,
    permalink: m.permalink,
    timestamp: m.timestamp,
    isVideo,
  };
}

export function GalleryClient({
  assets,
  creativeUsage,
  adInsights,
  videoSources,
  metaError,
  fbPosts,
  fbError,
  igPosts,
  igError,
}: {
  assets: CreativeAsset[];
  creativeUsage: CreativeUsage;
  adInsights: Record<string, AdInsightsRow>;
  videoSources: Record<string, string>;
  metaError: string | null;
  fbPosts: FacebookPagePost[];
  fbError: string | null;
  igPosts: InstagramMedia[];
  igError: string | null;
}) {
  const [search, setSearch] = useState("");

  const organicPosts = useMemo<OrganicPost[]>(() => {
    const items = [...fbPosts.map(fbToOrganic), ...igPosts.map(igToOrganic)];
    items.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    return items;
  }, [fbPosts, igPosts]);

  // Lifecycle filter — hides whole sections that don't carry tiles of the
  // selected lifecycle. Tile-level filtering inside LiveSection (winning vs
  // live vs fatiguing) is a v2 feature; today the pills are at the
  // section-axis: clicking "טיוטות" hides Live + Archive (drafts live in
  // PrioritySection), "מנצחים/חיים/מתעייפים" hides Priority + Archive.
  const [lifecycleFilter, setLifecycleFilter] =
    useState<LifecycleFilter>("all");

  const showLive =
    lifecycleFilter === "all" ||
    lifecycleFilter === "winning" ||
    lifecycleFilter === "live" ||
    lifecycleFilter === "fatiguing";
  const showPriority =
    lifecycleFilter === "all" || lifecycleFilter === "draft";
  const showArchive = lifecycleFilter === "all";

  return (
    <div className="flex flex-col gap-10">
      <UnifiedToolbar
        search={search}
        onSearchChange={setSearch}
        lifecycleFilter={lifecycleFilter}
        onLifecycleFilterChange={setLifecycleFilter}
      />

      {fbError || igError ? (
        <div className="flex flex-col gap-2">
          {fbError ? (
            <p className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              Facebook: {fbError}. בדוק שלטוקן יש{" "}
              <code>pages_read_engagement</code>.
            </p>
          ) : null}
          {igError ? (
            <p className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              Instagram: {igError}. בדוק שלטוקן יש <code>instagram_basic</code>{" "}
              ו-<code>pages_show_list</code>.
            </p>
          ) : null}
        </div>
      ) : null}

      {showLive ? (
        <LiveSection
          assets={assets}
          usage={creativeUsage}
          adInsights={adInsights}
          videoSources={videoSources}
          metaError={metaError}
          organicPosts={organicPosts}
        />
      ) : null}
      {showPriority ? (
        <PrioritySection assets={assets} usage={creativeUsage} />
      ) : null}
      {showArchive ? (
        <ArchiveSection
          assets={assets}
          usage={creativeUsage}
          search={search}
        />
      ) : null}
    </div>
  );
}

type LifecycleFilter =
  | "all"
  | "winning"
  | "live"
  | "fatiguing"
  | "draft";

const FILTER_PILLS: Array<{ id: LifecycleFilter; label: string }> = [
  { id: "all", label: "הכל" },
  { id: "winning", label: "מנצחים" },
  { id: "live", label: "חיים" },
  { id: "fatiguing", label: "מתעייפים" },
  { id: "draft", label: "טיוטות" },
];


/**
 * Single unified toolbar — filter pills on one edge, search + upload on the
 * other. In RTL that puts pills on the right (reading-start) and the action
 * cluster on the left, mirroring the Campaigner.html mockup layout. Wraps to
 * multiple rows on small screens; each cluster keeps its glass surface so the
 * chrome reads as connected layers.
 */
function UnifiedToolbar({
  search,
  onSearchChange,
  lifecycleFilter,
  onLifecycleFilterChange,
}: {
  search: string;
  onSearchChange: (v: string) => void;
  lifecycleFilter: LifecycleFilter;
  onLifecycleFilterChange: (v: LifecycleFilter) => void;
}) {
  return (
    <div className="sticky top-24 z-30 flex flex-wrap items-center justify-between gap-3">
      {/* Filter pills — reading-start edge (right in RTL). */}
      <div className="glass-surface inline-flex w-fit items-center gap-0.5 rounded-full p-1">
        {FILTER_PILLS.map((p) => {
          const isActive = lifecycleFilter === p.id;
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => onLifecycleFilterChange(p.id)}
              aria-pressed={isActive}
              className={`rounded-full px-3.5 py-1.5 text-[12.5px] font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring ${
                isActive
                  ? "bg-brand-500/15 text-foreground"
                  : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
              }`}
            >
              {p.label}
            </button>
          );
        })}
      </div>

      {/* Action cluster — search input + upload CTA. Same glass-pill shell. */}
      <div className="glass-surface flex flex-1 items-center gap-1 rounded-full p-1 sm:flex-none sm:min-w-[360px]">
        <div className="flex flex-1 items-center gap-2 ps-3 pe-1">
          <Search
            size={14}
            className="shrink-0 text-muted-foreground"
            aria-hidden
          />
          <input
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="חיפוש: קובץ, headline, angle, קמפיין"
            dir="auto"
            className="h-9 w-full bg-transparent text-[12.5px] outline-none placeholder:text-muted-foreground/70"
          />
        </div>
        <UploadDialog />
      </div>
    </div>
  );
}
