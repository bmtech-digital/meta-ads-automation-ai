"use client";

import { useMemo, useState } from "react";
import type { CreativeAsset } from "@/lib/db/types";
import type {
  AdInsightsRow,
  FacebookPagePost,
  InstagramMedia,
} from "@/lib/meta";
import { UploadDialog } from "./upload-dialog";
import { GenerateWithAgentButton } from "./generate-with-agent-button";
import { LeadingCreativeHero } from "./leading-creative-hero";
import { LiveSection, PrioritySection, ArchiveSection } from "./sections";
import {
  groupLiveMetaCreativesByCampaign,
  type CreativeUsage,
  type LifecycleFilter,
  type OrganicPost,
} from "./scoring";

export type { CreativeUsage } from "./scoring";

function fbToOrganic(p: FacebookPagePost): OrganicPost {
  return {
    source: "facebook",
    id: p.id,
    caption: p.message,
    thumbnail: p.full_picture,
    video_url: null,
    permalink: p.permalink_url,
    timestamp: p.created_time,
    isVideo: false,
  };
}

function igToOrganic(m: InstagramMedia): OrganicPost {
  const isVideo = m.media_type === "VIDEO";
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
  // Text search lives in the global nav (Ctrl/⌘+K). The page keeps only the
  // lifecycle filter pills — that's the deliberate "filters only, no search"
  // pattern applied uniformly across tabs.
  const [lifecycleFilter, setLifecycleFilter] =
    useState<LifecycleFilter>("all");

  const organicPosts = useMemo<OrganicPost[]>(() => {
    const items = [...fbPosts.map(fbToOrganic), ...igPosts.map(igToOrganic)];
    items.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    return items;
  }, [fbPosts, igPosts]);

  // Computed once — feeds both the leading-creative hero and the Live
  // section's tile grid, so both stay consistent on the same Meta snapshot.
  const liveGroups = useMemo(
    () =>
      groupLiveMetaCreativesByCampaign(
        creativeUsage,
        assets,
        adInsights,
        videoSources,
      ),
    [creativeUsage, assets, adInsights, videoSources],
  );

  // Filter pill axis — winning/live/fatiguing reach only live tiles; draft
  // hides the live grid + organic + archive and shows only the priority
  // queue. "All" shows everything. Hero is only meaningful in "all" / live /
  // winning views; it would be misleading to celebrate a "winner" while the
  // operator is intentionally inspecting "fatiguing" or "draft".
  const showHero = lifecycleFilter === "all" || lifecycleFilter === "live" || lifecycleFilter === "winning";
  const showLive = lifecycleFilter !== "draft";
  const showPriority =
    lifecycleFilter === "all" || lifecycleFilter === "draft";
  const showArchive = lifecycleFilter === "all";

  return (
    <div className="flex flex-col gap-10">
      <UnifiedToolbar
        lifecycleFilter={lifecycleFilter}
        onLifecycleFilterChange={setLifecycleFilter}
      />

      {fbError || igError ? (
        <div className="flex flex-col gap-2">
          {fbError ? (
            <p className="rounded-md border border-warning/25 bg-warning/10 px-3 py-2 text-[12px] text-warning">
              Facebook: {fbError}. בדוק שלטוקן יש{" "}
              <code className="mono-ltr">pages_read_engagement</code>.
            </p>
          ) : null}
          {igError ? (
            <p className="rounded-md border border-warning/25 bg-warning/10 px-3 py-2 text-[12px] text-warning">
              Instagram: {igError}. בדוק שלטוקן יש{" "}
              <code className="mono-ltr">instagram_basic</code> ו-
              <code className="mono-ltr">pages_show_list</code>.
            </p>
          ) : null}
        </div>
      ) : null}

      {showHero ? <LeadingCreativeHero groups={liveGroups} /> : null}

      {showLive ? (
        <LiveSection
          groups={liveGroups}
          metaError={metaError}
          organicPosts={organicPosts}
          search=""
          lifecycleFilter={lifecycleFilter}
        />
      ) : null}
      {showPriority ? (
        <PrioritySection assets={assets} usage={creativeUsage} search="" />
      ) : null}
      {showArchive ? (
        <ArchiveSection
          assets={assets}
          usage={creativeUsage}
          search=""
          lifecycleFilter={lifecycleFilter}
        />
      ) : null}
    </div>
  );
}

const FILTER_PILLS: Array<{ id: LifecycleFilter; label: string }> = [
  { id: "all", label: "הכל" },
  { id: "winning", label: "מנצחים" },
  { id: "live", label: "חיים" },
  { id: "fatiguing", label: "מתעייפים" },
  { id: "draft", label: "טיוטות" },
];

/**
 * Single unified toolbar — lifecycle filter pills + action cluster. Text
 * search lives in the global nav (Ctrl/⌘+K) so the per-tab toolbar is just
 * filters + actions; this is the uniform pattern across the project's tabs.
 */
function UnifiedToolbar({
  lifecycleFilter,
  onLifecycleFilterChange,
}: {
  lifecycleFilter: LifecycleFilter;
  onLifecycleFilterChange: (v: LifecycleFilter) => void;
}) {
  return (
    <div className="sticky top-24 z-30 flex flex-wrap items-center justify-between gap-3">
      <div className="inline-flex w-fit items-center gap-0.5 rounded-full border border-border bg-card p-1 shadow-ds-sm">
        {FILTER_PILLS.map((p) => {
          const isActive = lifecycleFilter === p.id;
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => onLifecycleFilterChange(p.id)}
              aria-pressed={isActive}
              className={`rounded-full border px-3.5 py-1.5 text-[12.5px] font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring ${
                isActive
                  ? "border-brand-400/40 bg-brand-400/[0.08] text-brand-400"
                  : "border-transparent text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              {p.label}
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <GenerateWithAgentButton />
        <UploadDialog />
      </div>
    </div>
  );
}
