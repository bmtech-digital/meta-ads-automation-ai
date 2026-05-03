"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { CreativeAsset, CreativeAssetKind, CreativeAssetSource } from "@/lib/db/types";

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

export function GalleryClient({ assets }: { assets: CreativeAsset[] }) {
  return (
    <div className="flex flex-col gap-6">
      <UploadCard />
      <FilteredAssets assets={assets} />
    </div>
  );
}

function FilteredAssets({ assets }: { assets: CreativeAsset[] }) {
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

      <AssetGrid assets={filtered} totalCount={assets.length} onClear={clearAll} />
    </>
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
    v.onloadedmetadata = () => {
      const dims = `${v.videoWidth}x${v.videoHeight}`;
      resolve({
        dimensions: dims,
        aspect: nearestAllowedAspect(v.videoWidth, v.videoHeight),
        duration: v.duration,
      });
      URL.revokeObjectURL(v.src);
    };
    v.onerror = () => resolve(null);
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
  const [pending, start] = useTransition();

  const isVideo = file?.type.startsWith("video/") ?? false;
  const kind: CreativeAssetKind = isVideo ? "video" : "image";

  async function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    setFile(f);
    setProbed(null);
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
    if (isVideo && !probed?.duration) {
      setErr("לא הצלחתי לקרוא את אורך הווידאו. נסה קובץ אחר או בחר aspect ידנית.");
      return;
    }
    const params = new URLSearchParams();
    params.set("filename", file.name);
    params.set("kind", kind);
    params.set("aspect_ratio", aspect);
    if (probed?.dimensions) params.set("dimensions", probed.dimensions);
    if (isVideo && probed?.duration) {
      params.set("duration_seconds", String(Math.round(probed.duration * 100) / 100));
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
          </div>
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
}: {
  assets: CreativeAsset[];
  totalCount: number;
  onClear: () => void;
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
      {assets.map((a) => <AssetTile key={a.id} asset={a} />)}
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

function AssetTile({ asset }: { asset: CreativeAsset }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

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
          {asset.meta_creative_id ? (
            <span className="rounded bg-green-100 px-1.5 py-0.5 text-green-800">חי במטא</span>
          ) : null}
        </div>

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
