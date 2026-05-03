import { NextRequest, NextResponse } from "next/server";
import { readAsset } from "@/lib/storage";

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

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ key: string[] }> },
) {
  const { key: segments } = await params;
  const key = segments.join("/");

  let file;
  try {
    file = await readAsset(key);
  } catch {
    return NextResponse.json({ error: "read_failed" }, { status: 400 });
  }
  if (!file) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const dot = key.lastIndexOf(".");
  const ext = dot >= 0 ? key.slice(dot).toLowerCase() : "";
  const mime = MIME_BY_EXT[ext] ?? "application/octet-stream";

  return new NextResponse(new Uint8Array(file.body), {
    status: 200,
    headers: {
      "content-type": mime,
      "content-length": String(file.size),
      "cache-control": "private, max-age=3600",
    },
  });
}
