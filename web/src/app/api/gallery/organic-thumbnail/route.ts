import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Proxy for Facebook/Instagram CDN thumbnails. Reasons we need this:
 * (1) FB CDN URLs are short-lived signed URLs that sometimes 403 when fetched
 *     by the browser with a referer header.
 * (2) IG `scontent.cdninstagram.com` URLs occasionally block cross-origin
 *     loads from random domains.
 * Proxying server-side strips the referer and gives us a stable cache window.
 *
 * URL allowlist is enforced — never proxy arbitrary URLs.
 */

const ALLOWED_HOST_SUFFIXES = [
  ".fbcdn.net",
  ".cdninstagram.com",
  ".facebook.com",
  ".instagram.com",
];

function hostAllowed(url: URL): boolean {
  const h = url.hostname.toLowerCase();
  return ALLOWED_HOST_SUFFIXES.some((s) => h === s.slice(1) || h.endsWith(s));
}

export async function GET(req: NextRequest) {
  const u = new URL(req.url);
  const target = u.searchParams.get("url");
  if (!target) {
    return NextResponse.json({ error: "missing_url" }, { status: 400 });
  }

  let parsed: URL;
  try {
    parsed = new URL(target);
  } catch {
    return NextResponse.json({ error: "invalid_url" }, { status: 400 });
  }
  if (parsed.protocol !== "https:") {
    return NextResponse.json({ error: "non_https" }, { status: 400 });
  }
  if (!hostAllowed(parsed)) {
    return NextResponse.json({ error: "host_not_allowed", host: parsed.hostname }, { status: 400 });
  }

  // Forward Range header so video <video> elements can seek without
  // re-downloading the full file. Without this, scrubbing in the player
  // re-fetches from byte 0 every time.
  const upstreamHeaders: Record<string, string> = {
    "user-agent": "Campaigner/1.0 (+thumbnail-proxy)",
  };
  const incomingRange = req.headers.get("range");
  if (incomingRange) upstreamHeaders.range = incomingRange;

  let upstream: Response;
  try {
    upstream = await fetch(parsed.toString(), {
      cache: "no-store",
      redirect: "follow",
      headers: upstreamHeaders,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "fetch_failed";
    return NextResponse.json({ error: "upstream_fetch_failed", detail: msg }, { status: 502 });
  }

  if (!upstream.ok || !upstream.body) {
    return NextResponse.json(
      { error: "upstream_status", status: upstream.status },
      { status: upstream.status === 404 ? 404 : 502 },
    );
  }

  const contentType = upstream.headers.get("content-type") ?? "application/octet-stream";
  // Allow images (thumbnails) and videos (organic IG/FB video playback).
  if (
    !contentType.startsWith("image/") &&
    !contentType.startsWith("video/") &&
    !contentType.startsWith("application/octet-stream")
  ) {
    return NextResponse.json(
      { error: "unsupported_content_type", content_type: contentType },
      { status: 502 },
    );
  }

  // Forward Range requests for video streaming (browser <video> element
  // requests partial content for seek). We pass through whatever the upstream
  // returns plus accept-ranges so the browser knows ranges are supported.
  const headers: Record<string, string> = {
    "content-type": contentType,
    "cache-control": "private, max-age=300",
  };
  const contentLength = upstream.headers.get("content-length");
  if (contentLength) headers["content-length"] = contentLength;
  const acceptRanges = upstream.headers.get("accept-ranges");
  if (acceptRanges) headers["accept-ranges"] = acceptRanges;
  const contentRange = upstream.headers.get("content-range");
  if (contentRange) headers["content-range"] = contentRange;

  return new NextResponse(upstream.body, {
    status: upstream.status,
    headers,
  });
}
