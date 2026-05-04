import { NextRequest, NextResponse } from "next/server";
import { getAuth } from "@/lib/auth";
import { getDataClient } from "@/lib/db";
import { uploadAssetStream, deleteAsset, UploadTooLargeError } from "@/lib/storage";
import type { CreativeAssetKind } from "@/lib/db/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 600;

const MAX_IMAGE_BYTES = 30 * 1024 * 1024;
const MAX_VIDEO_BYTES = 4 * 1024 * 1024 * 1024; // Meta limit
const ALLOWED_IMAGE_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);
const ALLOWED_VIDEO_MIME = new Set(["video/mp4", "video/quicktime"]);
const ALLOWED_ASPECTS = new Set(["1:1", "4:5", "9:16", "16:9"]);
const VIDEO_DURATION_MIN = 1;
const VIDEO_DURATION_MAX = 241;

export async function POST(req: NextRequest) {
  const session = await getAuth().getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const db = getDataClient();
  const business = process.env.BUSINESS_ID
    ? await db.getBusinessById(process.env.BUSINESS_ID)
    : await db.getFirstBusiness();
  if (!business) return NextResponse.json({ error: "business_not_found" }, { status: 404 });

  const url = new URL(req.url);
  const q = url.searchParams;

  const filename = (q.get("filename") ?? "").trim() || "upload.bin";
  const kind = (q.get("kind") as CreativeAssetKind | null) ?? "image";
  if (kind !== "image" && kind !== "video") {
    return NextResponse.json({ error: "unsupported_kind" }, { status: 400 });
  }

  const mimeType = (req.headers.get("content-type") ?? "").split(";")[0].trim();
  const contentLengthRaw = req.headers.get("content-length");
  const declaredSize = contentLengthRaw ? Number(contentLengthRaw) : 0;

  const aspectRatio = q.get("aspect_ratio") || null;
  const dimensions = q.get("dimensions") || null;
  const durationRaw = q.get("duration_seconds");
  const durationSeconds = durationRaw ? Number(durationRaw) : null;
  const marketingAngle = q.get("marketing_angle") || null;
  const serviceTag = q.get("service_tag") || null;

  if (kind === "image") {
    if (!ALLOWED_IMAGE_MIME.has(mimeType)) {
      return NextResponse.json(
        { error: "unsupported_mime", got: mimeType, allowed: Array.from(ALLOWED_IMAGE_MIME) },
        { status: 415 },
      );
    }
    if (declaredSize && declaredSize > MAX_IMAGE_BYTES) {
      return NextResponse.json(
        { error: "file_too_large", max_bytes: MAX_IMAGE_BYTES },
        { status: 413 },
      );
    }
  } else {
    if (!ALLOWED_VIDEO_MIME.has(mimeType)) {
      return NextResponse.json(
        { error: "unsupported_mime", got: mimeType, allowed: Array.from(ALLOWED_VIDEO_MIME) },
        { status: 415 },
      );
    }
    if (declaredSize && declaredSize > MAX_VIDEO_BYTES) {
      return NextResponse.json(
        { error: "file_too_large", max_bytes: MAX_VIDEO_BYTES },
        { status: 413 },
      );
    }
    if (!aspectRatio || !ALLOWED_ASPECTS.has(aspectRatio)) {
      return NextResponse.json(
        { error: "invalid_aspect_ratio", allowed: Array.from(ALLOWED_ASPECTS) },
        { status: 400 },
      );
    }
    if (durationSeconds == null || !Number.isFinite(durationSeconds)) {
      return NextResponse.json({ error: "duration_seconds_required" }, { status: 400 });
    }
    if (durationSeconds < VIDEO_DURATION_MIN || durationSeconds > VIDEO_DURATION_MAX) {
      return NextResponse.json(
        {
          error: "invalid_duration",
          min: VIDEO_DURATION_MIN,
          max: VIDEO_DURATION_MAX,
          got: durationSeconds,
        },
        { status: 400 },
      );
    }
  }

  if (!req.body) {
    return NextResponse.json({ error: "missing_body" }, { status: 400 });
  }

  const sizeLimit = kind === "image" ? MAX_IMAGE_BYTES : MAX_VIDEO_BYTES;

  let public_url: string;
  let actualSize: number;
  try {
    const result = await uploadAssetStream(business.id, filename, req.body, sizeLimit);
    public_url = result.public_url;
    actualSize = result.size_bytes;
  } catch (e) {
    if (e instanceof UploadTooLargeError) {
      return NextResponse.json(
        { error: "file_too_large", max_bytes: e.maxBytes },
        { status: 413 },
      );
    }
    console.error("gallery upload: stream write failed", e);
    return NextResponse.json({ error: "body_read_failed" }, { status: 400 });
  }

  if (actualSize === 0) {
    await deleteAsset(public_url).catch(() => {});
    return NextResponse.json({ error: "empty_body" }, { status: 400 });
  }

  let row;
  try {
    row = await db.createGalleryAsset({
      business_id: business.id,
      kind,
      storage_url: public_url,
      aspect_ratio: aspectRatio,
      dimensions,
      generated_by: "manual_upload",
      marketing_angle: marketingAngle,
      service_tag: serviceTag,
      mime_type: mimeType,
      size_bytes: actualSize,
      original_filename: filename,
      duration_seconds: kind === "video" ? durationSeconds : null,
    });
  } catch (e) {
    await deleteAsset(public_url).catch(() => {});
    throw e;
  }

  return NextResponse.json({ asset: row }, { status: 201 });
}
