"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { CreativeAsset, CreativeAssetKind, CreativeAssetSource } from "@/lib/db/types";
import type { MetaAdWithCreative, FacebookPagePost, InstagramMedia } from "@/lib/meta";

export type CreativeUsage = Record<string, MetaAdWithCreative[]>;

const ASPECT_OPTIONS = ["1:1", "4:5", "9:16", "16:9"] as const;

const KIND_LABEL_HE: Record<CreativeAssetKind, string> = {
  image: "תמונה",
  video: "וידאו",
  copy: "טקסט",
};

const SOURCE_LABEL_HE: Record<CreativeAssetSource, string> = {
  imagen: "Imagen",
  gemini: "Gemini",
  manual_upload: "העלאה ידנית",
};

type MetaStatus = "all" | "live" | "not_live";

function toggle<T>(set: Set<T>, v: T): Set<T> {
  const next = new Set(set);
  if (next.has(v)) next.delete(v);
  else next.add(v);
  return next;
}

export function GalleryClient({
  assets,
  creativeUsage,
  metaError,
  fbPosts,
  fbError,
  igPosts,
  igError,
}: {
  assets: CreativeAsset[];
  creativeUsage: CreativeUsage;
  metaError: string | null;
  fbPosts: FacebookPagePost[];
  fbError: string | null;
  igPosts: InstagramMedia[];
  igError: string | null;
}) {
  return (
    <div className="flex flex-col gap-6">
      <UploadCard />
      <InsightsPanel assets={assets} creativeUsage={creativeUsage} metaError={metaError} />
      <FilteredAssets assets={assets} creativeUsage={creativeUsage} />
      <OrganicPostsSection
        fbPosts={fbPosts}
        fbError={fbError}
        igPosts={igPosts}
        igError={igError}
      />
    </div>
  );
}

function FilteredAssets({
  assets,
  creativeUsage,
}: {
  assets: CreativeAsset[];
  creativeUsage: CreativeUsage;
}) {
  const [search, setSearch] = useState("");
  const [selectedKinds, setSelectedKinds] = useState<Set<CreativeAssetKind>>(new Set());
  const [selectedSources, setSelectedSources] = useState<Set<CreativeAssetSource>>(new Set());
  const [selectedServiceTags, setSelectedServiceTags] = useState<Set<string>>(new Set());
  const [metaStatus, setMetaStatus] = useState<MetaStatus>("all");

  const availableKinds = useMemo(() => {
    const counts = new Map<CreativeAssetKind, number>();
    for (const a of assets) counts.set(a.kind, (counts.get(a.kind) ?? 0) + 1);
    return Array.from(counts.entries());
  }, [assets]);

  const availableSources = useMemo(() => {
    const counts = new Map<CreativeAssetSource, number>();
    for (const a of assets) {
      if (a.generated_by) counts.set(a.generated_by, (counts.get(a.generated_by) ?? 0) + 1);
    }
    return Array.from(counts.entries());
  }, [assets]);

  const availableServiceTags = useMemo(() => {
    const counts = new Map<string, number>();
    for (const a of assets) {
      if (a.service_tag) counts.set(a.service_tag, (counts.get(a.service_tag) ?? 0) + 1);
    }
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  }, [assets]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return assets.filter((a) => {
      if (selectedKinds.size > 0 && !selectedKinds.has(a.kind)) return false;
      if (selectedSources.size > 0) {
        if (!a.generated_by || !selectedSources.has(a.generated_by)) return false;
      }
      if (selectedServiceTags.size > 0) {
        if (!a.service_tag || !selectedServiceTags.has(a.service_tag)) return false;
      }
      if (metaStatus === "live" && !a.meta_creative_id) return false;
      if (metaStatus === "not_live" && a.meta_creative_id) return false;
      if (q) {
        const haystack = [
          a.original_filename ?? "",
          a.marketing_angle ?? "",
          a.service_tag ?? "",
          a.headline ?? "",
          a.primary_text ?? "",
          a.cta ?? "",
        ]
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [assets, search, selectedKinds, selectedSources, selectedServiceTags, metaStatus]);

  const activeCount =
    (search ? 1 : 0) +
    selectedKinds.size +
    selectedSources.size +
    selectedServiceTags.size +
    (metaStatus !== "all" ? 1 : 0);

  const clearAll = () => {
    setSearch("");
    setSelectedKinds(new Set());
    setSelectedSources(new Set());
    setSelectedServiceTags(new Set());
    setMetaStatus("all");
  };

  return (
    <>
      <Card>
        <CardContent className="flex flex-col gap-4 pt-6">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="חיפוש לפי שם קובץ, headline, angle, service tag"
            dir="auto"
          />

          {availableKinds.length > 1 ? (
            <FilterRow label="סוג">
              {availableKinds.map(([k, n]) => (
                <Pill
                  key={k}
                  active={selectedKinds.has(k)}
                  onClick={() => setSelectedKinds((s) => toggle(s, k))}
                >
                  {KIND_LABEL_HE[k]} ({n})
                </Pill>
              ))}
            </FilterRow>
          ) : null}

          {availableSources.length > 0 ? (
            <FilterRow label="מקור">
              {availableSources.map(([src, n]) => (
                <Pill
                  key={src}
                  active={selectedSources.has(src)}
                  onClick={() => setSelectedSources((s) => toggle(s, src))}
                >
                  {SOURCE_LABEL_HE[src]} ({n})
                </Pill>
              ))}
            </FilterRow>
          ) : null}

          {availableServiceTags.length > 0 ? (
            <FilterRow label="תיוג שירות">
              {availableServiceTags.map(([t, n]) => (
                <Pill
                  key={t}
                  active={selectedServiceTags.has(t)}
                  onClick={() => setSelectedServiceTags((s) => toggle(s, t))}
                >
                  {t} ({n})
                </Pill>
              ))}
            </FilterRow>
          ) : null}

          <FilterRow label="סטטוס במטא">
            {(["all", "live", "not_live"] as MetaStatus[]).map((s) => (
              <Pill key={s} active={metaStatus === s} onClick={() => setMetaStatus(s)}>
                {s === "all" ? "הכל" : s === "live" ? "חי במטא" : "לא במטא"}
              </Pill>
            ))}
          </FilterRow>

          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>
              מציג {filtered.length} מתוך {assets.length}
            </span>
            {activeCount > 0 ? (
              <Button variant="ghost" size="sm" onClick={clearAll}>
                ניקוי פילטרים ({activeCount})
              </Button>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <AssetGrid
        assets={filtered}
        totalCount={assets.length}
        onClear={clearAll}
        creativeUsage={creativeUsage}
      />
    </>
  );
}

function readNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

interface RankedAsset {
  asset: CreativeAsset;
  value: number;
}

function rankByMetric(assets: CreativeAsset[], key: "ctr" | "hook_rate"): RankedAsset[] {
  const out: RankedAsset[] = [];
  for (const a of assets) {
    const v = readNumber(a.performance_snapshot?.[key]);
    if (v == null) continue;
    if (key === "hook_rate" && a.kind !== "video") continue;
    out.push({ asset: a, value: v });
  }
  out.sort((a, b) => b.value - a.value);
  return out;
}

function liveTagSets(assets: CreativeAsset[], creativeUsage: CreativeUsage): {
  liveServiceTags: Set<string>;
  liveAngles: Set<string>;
} {
  const liveServiceTags = new Set<string>();
  const liveAngles = new Set<string>();
  for (const a of assets) {
    if (!a.meta_creative_id) continue;
    const ads = creativeUsage[a.meta_creative_id] ?? [];
    const anyLive = ads.some((ad) => isLiveAd(ad.ad_effective_status));
    if (!anyLive) continue;
    if (a.service_tag) liveServiceTags.add(a.service_tag);
    if (a.marketing_angle) liveAngles.add(a.marketing_angle);
  }
  return { liveServiceTags, liveAngles };
}

function countBy(values: (string | null | undefined)[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const v of values) {
    if (!v) continue;
    m.set(v, (m.get(v) ?? 0) + 1);
  }
  return m;
}

function InsightsPanel({
  assets,
  creativeUsage,
  metaError,
}: {
  assets: CreativeAsset[];
  creativeUsage: CreativeUsage;
  metaError: string | null;
}) {
  const topByCtr = useMemo(() => rankByMetric(assets, "ctr").slice(0, 3), [assets]);
  const topByHook = useMemo(() => rankByMetric(assets, "hook_rate").slice(0, 3), [assets]);

  const { liveServiceTags, liveAngles } = useMemo(
    () => liveTagSets(assets, creativeUsage),
    [assets, creativeUsage],
  );

  const galleryServiceTagCounts = useMemo(
    () => countBy(assets.map((a) => a.service_tag)),
    [assets],
  );
  const galleryAngleCounts = useMemo(
    () => countBy(assets.map((a) => a.marketing_angle)),
    [assets],
  );

  // Gaps: tag/angle exists in gallery but no live ad uses one yet.
  const serviceTagGaps = useMemo(() => {
    return Array.from(galleryServiceTagCounts.entries())
      .filter(([t]) => !liveServiceTags.has(t))
      .sort((a, b) => b[1] - a[1]);
  }, [galleryServiceTagCounts, liveServiceTags]);

  const angleGaps = useMemo(() => {
    return Array.from(galleryAngleCounts.entries())
      .filter(([t]) => !liveAngles.has(t))
      .sort((a, b) => b[1] - a[1]);
  }, [galleryAngleCounts, liveAngles]);

  const candidatesNotLive = useMemo(
    () => assets.filter((a) => !a.meta_creative_id && (a.service_tag || a.marketing_angle)),
    [assets],
  );

  const hasAnything =
    topByCtr.length > 0 ||
    topByHook.length > 0 ||
    serviceTagGaps.length > 0 ||
    angleGaps.length > 0 ||
    candidatesNotLive.length > 0 ||
    metaError !== null;

  if (!hasAnything) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">מה עובד ומה הלאה</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 text-sm">
        {metaError ? (
          <p className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            לא הצלחתי לשלוף נתוני קמפיינים מ-Meta: {metaError}. מציג רק נתונים מקומיים.
          </p>
        ) : null}

        {topByCtr.length > 0 ? (
          <PerformerSection
            title="הכי טובים לפי CTR"
            items={topByCtr}
            unit="%"
            metricLabel="CTR"
          />
        ) : null}

        {topByHook.length > 0 ? (
          <PerformerSection
            title="הכי טובים לפי Hook rate (וידאו)"
            items={topByHook}
            unit="%"
            metricLabel="Hook rate"
          />
        ) : null}

        {serviceTagGaps.length > 0 ? (
          <GapSection
            title="תיוגי שירות בגלריה שעדיין לא חיים"
            note="יש בגלריה — אין מודעה חיה שמשתמשת בקריאייטיב עם התיוג הזה."
            items={serviceTagGaps}
          />
        ) : null}

        {angleGaps.length > 0 ? (
          <GapSection
            title="Marketing angles בגלריה שעדיין לא חיים"
            note="יש בגלריה — אין מודעה חיה שמשתמשת בקריאייטיב עם angle הזה."
            items={angleGaps}
          />
        ) : null}

        {candidatesNotLive.length > 0 ? (
          <p className="text-xs text-muted-foreground">
            {candidatesNotLive.length} נכסים בגלריה לא משויכים לקריאייטיב במטא — מועמדים לקמפיין הבא.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function PerformerSection({
  title,
  items,
  unit,
  metricLabel,
}: {
  title: string;
  items: RankedAsset[];
  unit: string;
  metricLabel: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h3>
      <ul className="flex flex-col gap-1">
        {items.map(({ asset, value }) => (
          <li key={asset.id} className="flex items-center justify-between gap-2 text-xs">
            <span className="truncate" title={asset.original_filename ?? asset.id}>
              {asset.original_filename ?? asset.id}
              {asset.service_tag ? (
                <span className="ms-1 text-muted-foreground">· {asset.service_tag}</span>
              ) : null}
              {asset.marketing_angle ? (
                <span className="ms-1 text-muted-foreground">· {asset.marketing_angle}</span>
              ) : null}
            </span>
            <span className="shrink-0 font-mono">
              {metricLabel} {value.toFixed(2)}
              {unit}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function GapSection({
  title,
  note,
  items,
}: {
  title: string;
  note: string;
  items: [string, number][];
}) {
  return (
    <div className="flex flex-col gap-1">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h3>
      <p className="text-[11px] text-muted-foreground">{note}</p>
      <div className="flex flex-wrap gap-1">
        {items.map(([t, n]) => (
          <span
            key={t}
            className="rounded bg-amber-100 px-1.5 py-0.5 text-[11px] text-amber-900"
          >
            {t} ({n})
          </span>
        ))}
      </div>
    </div>
  );
}

function FilterRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs text-muted-foreground">{label}</span>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  );
}

function Pill({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-3 py-1 text-xs transition-colors ${
        active
          ? "bg-primary text-primary-foreground"
          : "bg-muted text-muted-foreground hover:bg-muted/80"
      }`}
    >
      {children}
    </button>
  );
}

type Probed = { dimensions: string; aspect: string; duration: number | null } | null;

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

function nearestAllowedAspect(width: number, height: number): string {
  if (!width || !height) return "1:1";
  const g = gcd(width, height);
  const raw = `${width / g}:${height / g}`;
  if ((ASPECT_OPTIONS as readonly string[]).includes(raw)) return raw;
  // fall back to nearest by numeric ratio
  const target = width / height;
  let best = ASPECT_OPTIONS[0] as string;
  let bestDelta = Infinity;
  for (const opt of ASPECT_OPTIONS) {
    const [w, h] = opt.split(":").map(Number);
    const d = Math.abs(target - w / h);
    if (d < bestDelta) {
      best = opt;
      bestDelta = d;
    }
  }
  return best;
}

function probeImage(file: File): Promise<Probed> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const dims = `${img.naturalWidth}x${img.naturalHeight}`;
      resolve({
        dimensions: dims,
        aspect: nearestAllowedAspect(img.naturalWidth, img.naturalHeight),
        duration: null,
      });
      URL.revokeObjectURL(img.src);
    };
    img.onerror = () => resolve(null);
    img.src = URL.createObjectURL(file);
  });
}

function probeVideo(file: File): Promise<Probed> {
  return new Promise((resolve) => {
    const v = document.createElement("video");
    v.preload = "metadata";
    let done = false;
    const finish = (result: Probed) => {
      if (done) return;
      done = true;
      try {
        URL.revokeObjectURL(v.src);
      } catch {
        // ignore
      }
      resolve(result);
    };
    v.onloadedmetadata = () => {
      const duration = Number.isFinite(v.duration) && v.duration > 0 ? v.duration : null;
      finish({
        dimensions: `${v.videoWidth}x${v.videoHeight}`,
        aspect: nearestAllowedAspect(v.videoWidth, v.videoHeight),
        duration,
      });
    };
    v.onerror = () => finish(null);
    // Some MP4/MOV files hide the moov atom at the end and never fire
    // loadedmetadata under preload="metadata". Bail after 5s so the user
    // gets the manual-fill UI instead of a stuck form.
    setTimeout(() => finish(null), 5000);
    v.src = URL.createObjectURL(file);
  });
}

function UploadCard() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [aspect, setAspect] = useState<string>("1:1");
  const [serviceTag, setServiceTag] = useState("");
  const [marketingAngle, setMarketingAngle] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [probed, setProbed] = useState<Probed>(null);
  const [manualDuration, setManualDuration] = useState<string>("");
  const [pending, start] = useTransition();

  const isVideo = file?.type.startsWith("video/") ?? false;
  const kind: CreativeAssetKind = isVideo ? "video" : "image";
  const probeFailed = isVideo && file !== null && !probed?.duration;
  const effectiveDuration = probed?.duration ?? (manualDuration ? Number(manualDuration) : null);

  async function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    setFile(f);
    setProbed(null);
    setManualDuration("");
    setErr(null);
    if (!f) return;
    const p = f.type.startsWith("video/") ? await probeVideo(f) : await probeImage(f);
    if (p) {
      setProbed(p);
      setAspect(p.aspect);
    }
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErr(null);
    if (!file) {
      setErr("בחר קובץ קודם");
      return;
    }
    if (isVideo) {
      if (effectiveDuration == null || !Number.isFinite(effectiveDuration)) {
        setErr("הזן אורך וידאו בשניות (1–241).");
        return;
      }
      if (effectiveDuration < 1 || effectiveDuration > 241) {
        setErr("אורך וידאו חייב להיות בין 1 ל-241 שניות.");
        return;
      }
    }
    const params = new URLSearchParams();
    params.set("filename", file.name);
    params.set("kind", kind);
    params.set("aspect_ratio", aspect);
    if (probed?.dimensions) params.set("dimensions", probed.dimensions);
    if (isVideo && effectiveDuration != null) {
      params.set("duration_seconds", String(Math.round(effectiveDuration * 100) / 100));
    }
    if (serviceTag) params.set("service_tag", serviceTag);
    if (marketingAngle) params.set("marketing_angle", marketingAngle);

    start(async () => {
      const res = await fetch(`/api/gallery/upload?${params.toString()}`, {
        method: "POST",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: res.statusText }));
        setErr(body.error ?? "upload_failed");
        return;
      }
      setFile(null);
      setProbed(null);
      setManualDuration("");
      setServiceTag("");
      setMarketingAngle("");
      (e.target as HTMLFormElement).reset();
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>העלאת נכס חדש</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="file">
              תמונה (JPEG/PNG/WebP, עד 30MB) או וידאו (MP4/MOV, עד 4GB, 1-241 שניות)
            </Label>
            <Input
              id="file"
              name="file"
              type="file"
              accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime"
              onChange={onFileChange}
              required
            />
            {probed ? (
              <p className="text-xs text-muted-foreground">
                זוהה: {probed.dimensions}
                {probed.duration
                  ? ` · ${Math.round(probed.duration * 10) / 10}s`
                  : null}{" "}
                · aspect מומלץ {probed.aspect}
              </p>
            ) : null}
            {probeFailed ? (
              <p className="text-xs text-amber-700">
                לא הצלחתי לקרוא את המטא-דאטה של הווידאו בדפדפן. הזן אורך
                ובחר aspect ידנית למטה.
              </p>
            ) : null}
          </div>
          {probeFailed ? (
            <div className="flex flex-col gap-2">
              <Label htmlFor="manual_duration">אורך הווידאו בשניות (1–241)</Label>
              <Input
                id="manual_duration"
                type="number"
                inputMode="decimal"
                min={1}
                max={241}
                step="0.1"
                value={manualDuration}
                onChange={(e) => setManualDuration(e.target.value)}
                placeholder="למשל 15"
              />
            </div>
          ) : null}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div className="flex flex-col gap-2">
              <Label htmlFor="aspect">Aspect ratio</Label>
              <select
                id="aspect"
                value={aspect}
                onChange={(e) => setAspect(e.target.value)}
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              >
                {ASPECT_OPTIONS.map((a) => (
                  <option key={a} value={a}>{a}</option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="service_tag">תיוג שירות (אופציונלי)</Label>
              <Input
                id="service_tag"
                value={serviceTag}
                onChange={(e) => setServiceTag(e.target.value)}
                placeholder="web-dev / ai-consult / ..."
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="marketing_angle">Marketing angle (אופציונלי)</Label>
              <Input
                id="marketing_angle"
                value={marketingAngle}
                onChange={(e) => setMarketingAngle(e.target.value)}
                placeholder="benefit / social_proof / urgency"
              />
            </div>
          </div>
          {err ? (
            <p className="text-sm text-red-600">שגיאה: {err}</p>
          ) : null}
          <div>
            <Button type="submit" disabled={pending || !file}>
              {pending ? "מעלה..." : `העלה ${kind === "video" ? "וידאו" : "תמונה"}`}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function AssetGrid({
  assets,
  totalCount,
  onClear,
  creativeUsage,
}: {
  assets: CreativeAsset[];
  totalCount: number;
  onClear: () => void;
  creativeUsage: CreativeUsage;
}) {
  if (assets.length === 0) {
    if (totalCount === 0) {
      return (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            עוד לא הועלו נכסים. העלה תמונה ראשונה למעלה.
          </CardContent>
        </Card>
      );
    }
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-8 text-center text-sm text-muted-foreground">
          <span>אין נכסים שתואמים את הפילטרים הנוכחיים.</span>
          <Button variant="outline" size="sm" onClick={onClear}>
            נקה פילטרים
          </Button>
        </CardContent>
      </Card>
    );
  }
  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
      {assets.map((a) => (
        <AssetTile
          key={a.id}
          asset={a}
          ads={a.meta_creative_id ? creativeUsage[a.meta_creative_id] ?? [] : []}
        />
      ))}
    </div>
  );
}

function formatPerfSnapshot(snap: Record<string, unknown> | null): string[] {
  if (!snap) return [];
  const out: string[] = [];
  const push = (label: string, value: unknown, suffix = "") => {
    if (typeof value === "number") out.push(`${label}: ${value}${suffix}`);
    else if (typeof value === "string" && value.trim()) out.push(`${label}: ${value}${suffix}`);
  };
  push("CTR", snap.ctr, "%");
  push("Hook rate", snap.hook_rate, "%");
  push("Spend", snap.spend);
  push("Impressions", snap.impressions);
  push("Conversions", snap.conversions);
  return out;
}

const ACTIVE_AD_STATUSES = new Set([
  "ACTIVE",
  "CAMPAIGN_PAUSED",
  "ADSET_PAUSED",
  "IN_PROCESS",
  "WITH_ISSUES",
]);

function isLiveAd(status: string | null | undefined): boolean {
  return !!status && ACTIVE_AD_STATUSES.has(status);
}

function AssetTile({ asset, ads }: { asset: CreativeAsset; ads: MetaAdWithCreative[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  // Group by campaign so we don't repeat the campaign pill once per ad.
  const campaigns = useMemo(() => {
    const byId = new Map<
      string,
      { name: string; effective_status: string | null; anyAdLive: boolean }
    >();
    for (const ad of ads) {
      if (!ad.campaign_id) continue;
      const prev = byId.get(ad.campaign_id);
      const live = isLiveAd(ad.ad_effective_status);
      if (prev) {
        prev.anyAdLive = prev.anyAdLive || live;
      } else {
        byId.set(ad.campaign_id, {
          name: ad.campaign_name ?? ad.campaign_id,
          effective_status: ad.campaign_effective_status,
          anyAdLive: live,
        });
      }
    }
    return Array.from(byId.values());
  }, [ads]);

  async function onDelete() {
    if (!confirm("למחוק את הנכס?")) return;
    setErr(null);
    start(async () => {
      const res = await fetch(`/api/gallery/${asset.id}/delete`, { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: res.statusText }));
        setErr(body.error ?? "delete_failed");
        return;
      }
      router.refresh();
    });
  }

  return (
    <Card className="overflow-hidden">
      <div className="relative aspect-square w-full bg-muted">
        {asset.storage_url && asset.kind === "image" ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={asset.storage_url}
            alt={asset.original_filename ?? "gallery asset"}
            className="h-full w-full object-cover"
          />
        ) : asset.storage_url && asset.kind === "video" ? (
          <video
            src={asset.storage_url}
            controls
            preload="metadata"
            muted
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">
            {asset.kind}
          </div>
        )}
      </div>
      <CardContent className="flex flex-col gap-2 p-3">
        <div className="flex flex-wrap gap-1 text-[11px]">
          {asset.aspect_ratio ? (
            <span className="rounded bg-muted px-1.5 py-0.5">{asset.aspect_ratio}</span>
          ) : null}
          {asset.kind === "video" && asset.duration_seconds ? (
            <span className="rounded bg-muted px-1.5 py-0.5">
              {Math.round(Number(asset.duration_seconds))}s
            </span>
          ) : null}
          {asset.generated_by ? (
            <span className="rounded bg-slate-200 px-1.5 py-0.5 text-slate-800">
              {SOURCE_LABEL_HE[asset.generated_by]}
            </span>
          ) : null}
          {asset.service_tag ? (
            <span className="rounded bg-blue-100 px-1.5 py-0.5 text-blue-800">
              {asset.service_tag}
            </span>
          ) : null}
          {asset.marketing_angle ? (
            <span className="rounded bg-amber-100 px-1.5 py-0.5 text-amber-800">
              {asset.marketing_angle}
            </span>
          ) : null}
          {asset.meta_creative_id && campaigns.length === 0 ? (
            <span className="rounded bg-green-100 px-1.5 py-0.5 text-green-800">חי במטא</span>
          ) : null}
        </div>

        {campaigns.length > 0 ? (
          <div className="flex flex-col gap-1 rounded border border-green-200 bg-green-50 px-2 py-1.5">
            <span className="text-[10px] uppercase tracking-wide text-green-800">
              באוויר בקמפיין{campaigns.length > 1 ? "ים" : ""}
            </span>
            <div className="flex flex-wrap gap-1">
              {campaigns.map((c, i) => (
                <span
                  key={i}
                  className={`rounded px-1.5 py-0.5 text-[11px] ${
                    c.anyAdLive
                      ? "bg-green-200 text-green-900"
                      : "bg-slate-200 text-slate-700"
                  }`}
                  title={c.effective_status ?? ""}
                >
                  {c.name}
                  {c.effective_status && c.effective_status !== "ACTIVE" ? (
                    <span className="ms-1 opacity-70">· {c.effective_status}</span>
                  ) : null}
                </span>
              ))}
            </div>
          </div>
        ) : null}

        {asset.headline ? (
          <div className="truncate text-xs font-semibold" title={asset.headline}>
            {asset.headline}
          </div>
        ) : null}
        {asset.primary_text ? (
          <p className="line-clamp-2 text-xs text-muted-foreground" title={asset.primary_text}>
            {asset.primary_text}
          </p>
        ) : null}
        {asset.cta ? (
          <span className="text-[11px] text-muted-foreground">CTA: {asset.cta}</span>
        ) : null}

        {(() => {
          const metrics = formatPerfSnapshot(asset.performance_snapshot);
          if (metrics.length === 0) return null;
          return (
            <div className="flex flex-wrap gap-1 rounded bg-muted/50 px-2 py-1 text-[10px]">
              {metrics.map((m) => (
                <span key={m}>{m}</span>
              ))}
            </div>
          );
        })()}

        <div
          className="truncate text-[11px] text-muted-foreground"
          title={asset.original_filename ?? ""}
        >
          {asset.original_filename ?? "—"}
        </div>

        {err ? <p className="text-xs text-red-600">{err}</p> : null}
        <Button
          variant="ghost"
          size="sm"
          onClick={onDelete}
          disabled={pending || !!asset.meta_creative_id}
          title={asset.meta_creative_id ? "נכס חי במטא — לא ניתן למחוק" : undefined}
        >
          {pending ? "מוחק..." : "מחק"}
        </Button>
      </CardContent>
    </Card>
  );
}

// ---------- Organic posts (Facebook Page + Instagram business account) ----------

type OrganicSource = "all" | "facebook" | "instagram";

interface OrganicPost {
  source: "facebook" | "instagram";
  id: string;
  caption: string | null;
  thumbnail: string | null;
  permalink: string | null;
  timestamp: string;
  isVideo: boolean;
}

function fbToOrganic(p: FacebookPagePost): OrganicPost {
  return {
    source: "facebook",
    id: p.id,
    caption: p.message,
    thumbnail: p.full_picture,
    permalink: p.permalink_url,
    timestamp: p.created_time,
    isVideo: false,
  };
}

function igToOrganic(m: InstagramMedia): OrganicPost {
  // For VIDEO use thumbnail_url (a poster frame). CAROUSEL_ALBUM falls back
  // to the first child's media_url, populated server-side in listInstagramMedia.
  const thumb =
    m.media_type === "VIDEO" ? m.thumbnail_url ?? m.media_url : m.media_url;
  return {
    source: "instagram",
    id: m.id,
    caption: m.caption,
    thumbnail: thumb,
    permalink: m.permalink,
    timestamp: m.timestamp,
    isVideo: m.media_type === "VIDEO",
  };
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

function OrganicPostsSection({
  fbPosts,
  fbError,
  igPosts,
  igError,
}: {
  fbPosts: FacebookPagePost[];
  fbError: string | null;
  igPosts: InstagramMedia[];
  igError: string | null;
}) {
  const [source, setSource] = useState<OrganicSource>("all");

  const all = useMemo(() => {
    const items = [...fbPosts.map(fbToOrganic), ...igPosts.map(igToOrganic)];
    items.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    return items;
  }, [fbPosts, igPosts]);

  const filtered = useMemo(
    () => (source === "all" ? all : all.filter((p) => p.source === source)),
    [all, source],
  );

  // Hide entirely when there's nothing to show and no errors to surface — keeps
  // /gallery clean for businesses that don't have a Page yet.
  if (all.length === 0 && !fbError && !igError) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">פוסטים אורגניים מ-Facebook ו-Instagram</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {fbError ? (
          <p className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            Facebook: {fbError}. בדוק שלטוקן יש את ההרשאה <code>pages_read_engagement</code>.
          </p>
        ) : null}
        {igError ? (
          <p className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            Instagram: {igError}. בדוק שלטוקן יש את ההרשאות <code>instagram_basic</code> ו-<code>pages_show_list</code>.
          </p>
        ) : null}

        {all.length > 0 ? (
          <FilterRow label="מקור">
            <Pill active={source === "all"} onClick={() => setSource("all")}>
              הכל ({all.length})
            </Pill>
            <Pill active={source === "facebook"} onClick={() => setSource("facebook")}>
              Facebook ({fbPosts.length})
            </Pill>
            <Pill active={source === "instagram"} onClick={() => setSource("instagram")}>
              Instagram ({igPosts.length})
            </Pill>
          </FilterRow>
        ) : null}

        {filtered.length > 0 ? (
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
            {filtered.map((p) => (
              <OrganicTile key={`${p.source}:${p.id}`} post={p} />
            ))}
          </div>
        ) : all.length > 0 ? (
          <p className="text-center text-xs text-muted-foreground">אין פוסטים שתואמים את המסנן.</p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function OrganicTile({ post }: { post: OrganicPost }) {
  return (
    <Card className="overflow-hidden">
      <div className="relative aspect-square w-full bg-muted">
        {post.thumbnail ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={post.thumbnail}
            alt={post.caption?.slice(0, 80) ?? `${post.source} post`}
            className="h-full w-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">
            {post.isVideo ? "וידאו" : "אין תצוגה מקדימה"}
          </div>
        )}
        <span
          className={`absolute end-1 top-1 rounded px-1.5 py-0.5 text-[10px] font-semibold ${
            post.source === "facebook"
              ? "bg-blue-600 text-white"
              : "bg-pink-600 text-white"
          }`}
        >
          {post.source === "facebook" ? "FB" : "IG"}
        </span>
        {post.isVideo ? (
          <span className="absolute start-1 top-1 rounded bg-black/70 px-1.5 py-0.5 text-[10px] text-white">
            ▶ וידאו
          </span>
        ) : null}
      </div>
      <CardContent className="flex flex-col gap-2 p-3">
        <div className="text-[11px] text-muted-foreground">{formatPostDate(post.timestamp)}</div>
        {post.caption ? (
          <p
            className="line-clamp-3 text-xs"
            dir="auto"
            title={post.caption}
          >
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
      </CardContent>
    </Card>
  );
}
