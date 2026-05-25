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

const HEBREW_MONTH_HE = [
  "טבת",
  "שבט",
  "אדר",
  "ניסן",
  "אייר",
  "סיוון",
  "תמוז",
  "אב",
  "אלול",
  "תשרי",
  "חשוון",
  "כסלו",
];

function formatIssueDate(d = new Date()): string {
  const m = HEBREW_MONTH_HE[d.getMonth()] ?? "";
  return `גיליון ${m} ${d.getFullYear()}`;
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
  const [lifecycleFilter, setLifecycleFilter] =
    useState<LifecycleFilter>("all");

  const organicPosts = useMemo<OrganicPost[]>(() => {
    const items = [...fbPosts.map(fbToOrganic), ...igPosts.map(igToOrganic)];
    items.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    return items;
  }, [fbPosts, igPosts]);

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

  const totals = useMemo(() => {
    const live = liveGroups.reduce((n, g) => n + g.creatives.length, 0);
    const winning = liveGroups.reduce(
      (n, g) => n + g.creatives.filter((c) => c.performance?.grade === "A").length,
      0,
    );
    const drafts = assets.filter((a) => !a.meta_creative_id).length;
    return { total: assets.length, live, winning, drafts };
  }, [assets, liveGroups]);

  const showHero = lifecycleFilter === "all" || lifecycleFilter === "live" || lifecycleFilter === "winning";
  const showLive = lifecycleFilter !== "draft";
  const showPriority =
    lifecycleFilter === "all" || lifecycleFilter === "draft";
  const showArchive = lifecycleFilter === "all";

  return (
    <div className="flex flex-col gap-12">
      <GalleryMasthead totals={totals} />
      <TocFilter
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

/**
 * Editorial masthead — the page reads as a magazine issue. Eyebrow line
 * gives the "issue marking" (Hebrew month + year). Title carries
 * unmistakable display weight; a single word lifts into Frank Ruhl Libre
 * italic to break the regularity. The dek (lede) reads as a magazine
 * sub-title. A small stat block on the leading edge sits like a print
 * "in this issue" counter.
 */
function GalleryMasthead({
  totals,
}: {
  totals: { total: number; live: number; winning: number; drafts: number };
}) {
  return (
    <header className="grid grid-cols-1 gap-x-12 gap-y-6 border-b border-border/40 pb-10 lg:grid-cols-[1fr_auto] lg:items-end">
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 font-mono text-[10.5px] uppercase tracking-[0.18em] text-muted-foreground">
          <span className="text-brand-400">קריאייטיב</span>
          <span aria-hidden className="h-px w-6 bg-border" />
          <span>{formatIssueDate()}</span>
          <span aria-hidden className="h-px w-6 bg-border" />
          <span>VOL. 01 · Aiweon Campaigner</span>
        </div>

        <h1 className="font-display text-[44px] font-medium leading-[0.95] tracking-[-0.025em] text-foreground lg:text-[56px]">
          נכסי{" "}
          <span className="font-editorial italic font-normal text-foreground/95">
            קריאייטיב
          </span>
          .
        </h1>

        <p className="max-w-[58ch] text-[14px] leading-relaxed text-muted-foreground">
          לוח־הצופים של כל המודעות שהסוכן ייצר או שהעלית. מטריקות חיות נשאבות
          מ-Meta — קריאייטיב שעדיין לא צבר 1,000 חשיפות מסומן{" "}
          <em className="font-editorial italic text-foreground/85">
            ״אוסף נתונים״
          </em>
          , ולא נשפט עדיין.
        </p>
      </div>

      <dl className="grid grid-cols-4 gap-x-7 gap-y-1 self-end font-mono text-text-secondary">
        <StatCell label="סה״כ" value={totals.total} />
        <StatCell label="חי" value={totals.live} />
        <StatCell label="מנצחים" value={totals.winning} accent />
        <StatCell label="טיוטות" value={totals.drafts} />
      </dl>
    </header>
  );
}

function StatCell({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent?: boolean;
}) {
  return (
    <div className="flex flex-col gap-0.5 text-center">
      <dd
        className={`mono-ltr text-[26px] font-medium leading-none tracking-[-0.02em] tabular-nums ${
          accent ? "text-brand-400" : "text-foreground"
        }`}
      >
        {String(value).padStart(2, "0")}
      </dd>
      <dt className="font-mono text-[9.5px] uppercase tracking-[0.18em] text-muted-foreground">
        {label}
      </dt>
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
 * TOC-style filter strip — reads like the front-matter of a magazine
 * issue rather than a row of toggle pills. Active filter gets an amber
 * underline; the rest carry the same mono-caps register so the row
 * scans as a single editorial line.
 */
function TocFilter({
  lifecycleFilter,
  onLifecycleFilterChange,
}: {
  lifecycleFilter: LifecycleFilter;
  onLifecycleFilterChange: (v: LifecycleFilter) => void;
}) {
  return (
    <div className="sticky top-24 z-30 -mx-3 flex flex-wrap items-center justify-between gap-x-6 gap-y-3 rounded-2xl border border-border/40 bg-background/70 px-3 py-3 backdrop-blur-md">
      <nav
        aria-label="פילטרים"
        className="flex flex-wrap items-center gap-x-6 gap-y-1"
      >
        {FILTER_PILLS.map((p) => {
          const isActive = lifecycleFilter === p.id;
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => onLifecycleFilterChange(p.id)}
              aria-pressed={isActive}
              className={`relative pb-1 font-mono text-[11.5px] uppercase tracking-[0.18em] outline-none transition-colors focus-visible:text-foreground ${
                isActive
                  ? "text-brand-400"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {p.label}
              <span
                aria-hidden
                className={`absolute inset-x-0 -bottom-0.5 h-px transition-all ${
                  isActive
                    ? "scale-x-100 bg-brand-400"
                    : "scale-x-0 bg-foreground/30"
                } origin-center`}
              />
            </button>
          );
        })}
      </nav>

      <div className="flex flex-wrap items-center gap-2">
        <GenerateWithAgentButton />
        <UploadDialog />
      </div>
    </div>
  );
}
