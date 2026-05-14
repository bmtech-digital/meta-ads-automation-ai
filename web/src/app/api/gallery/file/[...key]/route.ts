import { NextRequest, NextResponse } from "next/server";
import { readAssetStream, statAsset } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MIME_BY_EXT: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
};

function mimeForKey(key: string): string {
  const dot = key.lastIndexOf(".");
  const ext = dot >= 0 ? key.slice(dot).toLowerCase() : "";
  return MIME_BY_EXT[ext] ?? "application/octet-stream";
}

/**
 * Serves uploaded gallery assets. Supports HTTP Range requests so <video>
 * elements can stream + seek (Chrome/Safari refuse to play without 206 +
 * Accept-Ranges). Streams instead of buffering — a 4GB video is fine.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ key: string[] }> },
) {
  const { key: segments } = await params;
  const key = segments.join("/");

  let info;
  try {
    info = await statAsset(key);
  } catch {
    return NextResponse.json({ error: "read_failed" }, { status: 400 });
  }
  if (!info) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const total = info.size;
  const mime = mimeForKey(key);
  const rangeHeader = req.headers.get("range");

  if (rangeHeader) {
    const m = /^bytes=(\d+)-(\d*)$/.exec(rangeHeader.trim());
    if (!m) {
      return new NextResponse(null, {
        status: 416,
        headers: {
          "content-range": `bytes */${total}`,
          "accept-ranges": "bytes",
        },
      });
    }
    const start = Number(m[1]);
    const end = m[2] ? Number(m[2]) : total - 1;
    if (
      !Number.isFinite(start) ||
      !Number.isFinite(end) ||
      start < 0 ||
      end >= total ||
      start > end
    ) {
      return new NextResponse(null, {
        status: 416,
        headers: {
          "content-range": `bytes */${total}`,
          "accept-ranges": "bytes",
        },
      });
    }
    const length = end - start + 1;
    const stream = readAssetStream(key, start, end);
    return new NextResponse(stream, {
      status: 206,
      headers: {
        "content-type": mime,
        "content-length": String(length),
        "content-range": `bytes ${start}-${end}/${total}`,
        "accept-ranges": "bytes",
        "cache-control": "private, max-age=3600",
      },
    });
  }

  // No Range: full content, but advertise that ranges are supported so the
  // browser issues a follow-up Range request for video.
  const stream = readAssetStream(key, 0, total - 1);
  return new NextResponse(stream, {
    status: 200,
    headers: {
      "content-type": mime,
      "content-length": String(total),
      "accept-ranges": "bytes",
      "cache-control": "private, max-age=3600",
    },
  });
}
