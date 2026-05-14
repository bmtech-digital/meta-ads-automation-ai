"use client";

import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
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

  return (
    <div className="flex flex-col gap-12">
      <ActionBar search={search} onSearchChange={setSearch} />

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

      <LiveSection
        assets={assets}
        usage={creativeUsage}
        adInsights={adInsights}
        videoSources={videoSources}
        metaError={metaError}
        organicPosts={organicPosts}
      />
      <PrioritySection assets={assets} usage={creativeUsage} />
      <ArchiveSection assets={assets} usage={creativeUsage} search={search} />
    </div>
  );
}

function ActionBar({
  search,
  onSearchChange,
}: {
  search: string;
  onSearchChange: (v: string) => void;
}) {
  return (
    <div className="sticky top-0 z-10 -mx-4 flex items-center gap-3 border-b border-border/60 bg-background/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <div className="relative flex-1">
        <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="חיפוש לפי שם קובץ, headline, angle, service tag, שם קמפיין"
          dir="auto"
          className="ps-10"
        />
      </div>
      <UploadDialog />
    </div>
  );
}
