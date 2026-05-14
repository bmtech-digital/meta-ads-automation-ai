"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { CreativeAssetKind } from "@/lib/db/types";

const ASPECT_OPTIONS = ["1:1", "4:5", "9:16", "16:9"] as const;

type Probed = { dimensions: string; aspect: string; duration: number | null } | null;

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

function nearestAllowedAspect(width: number, height: number): string {
  if (!width || !height) return "1:1";
  const g = gcd(width, height);
  const raw = `${width / g}:${height / g}`;
  if ((ASPECT_OPTIONS as readonly string[]).includes(raw)) return raw;
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
      resolve({
        dimensions: `${img.naturalWidth}x${img.naturalHeight}`,
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
    // loadedmetadata under preload="metadata".
    setTimeout(() => finish(null), 5000);
    v.src = URL.createObjectURL(file);
  });
}

export function UploadDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
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

  function reset() {
    setFile(null);
    setProbed(null);
    setManualDuration("");
    setServiceTag("");
    setMarketingAngle("");
    setAspect("1:1");
    setErr(null);
  }

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
      reset();
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button className="gap-2">
          <Plus className="h-4 w-4" />
          העלה נכס
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>העלאת נכס חדש</DialogTitle>
          <DialogDescription>
            תמונה (JPEG/PNG/WebP, עד 30MB) או וידאו (MP4/MOV, עד 4GB, 1–241 שניות).
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="file">קובץ</Label>
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
                {probed.duration ? ` · ${Math.round(probed.duration * 10) / 10}s` : null}{" "}
                · aspect מומלץ {probed.aspect}
              </p>
            ) : null}
            {probeFailed ? (
              <p className="text-xs text-amber-700">
                לא הצלחתי לקרוא מטא-דאטה של הוידאו. הזן אורך ובחר aspect ידנית למטה.
              </p>
            ) : null}
          </div>
          {probeFailed ? (
            <div className="flex flex-col gap-2">
              <Label htmlFor="manual_duration">אורך הוידאו בשניות (1–241)</Label>
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
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="service_tag">תיוג שירות</Label>
              <Input
                id="service_tag"
                value={serviceTag}
                onChange={(e) => setServiceTag(e.target.value)}
                placeholder="web-dev / ai-consult / ..."
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="marketing_angle">Marketing angle</Label>
              <Input
                id="marketing_angle"
                value={marketingAngle}
                onChange={(e) => setMarketingAngle(e.target.value)}
                placeholder="benefit / social_proof / urgency"
              />
            </div>
          </div>
          {err ? <p className="text-sm text-red-600">שגיאה: {err}</p> : null}
          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setOpen(false);
                reset();
              }}
              disabled={pending}
            >
              ביטול
            </Button>
            <Button type="submit" disabled={pending || !file}>
              {pending ? "מעלה..." : `העלה ${kind === "video" ? "וידאו" : "תמונה"}`}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
