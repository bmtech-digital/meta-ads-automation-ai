import "server-only";
import { createHash } from "node:crypto";
import { mkdir, writeFile, unlink, stat, readFile } from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";

/**
 * Storage layer for gallery assets.
 *
 * Current backend: local filesystem (works in Docker dev without external
 * deps). Files live under UPLOAD_ROOT, served back via the streaming route
 * `/api/gallery/file/[...key]`. When we wire Supabase Storage (per spec
 * §10.6 + decisions-log §1.9) this module grows a second adapter selected
 * by env STORAGE_MODE.
 *
 * The storage_url stored in DB is the public-facing URL path, not the disk
 * path — that's what the browser hits.
 */

const UPLOAD_ROOT = process.env.UPLOAD_ROOT || "/app/uploads";

export interface UploadResult {
  path: string;        // disk path, relative to UPLOAD_ROOT
  public_url: string;  // URL the browser fetches
}

function safeFilename(name: string): string {
  return name.replace(/[^\w.\-]+/g, "_").slice(0, 120);
}

function keyToDiskPath(key: string): string {
  const normalized = path.posix.normalize(key);
  if (normalized.startsWith("..") || path.isAbsolute(normalized)) {
    throw new Error("invalid_storage_key");
  }
  return path.join(UPLOAD_ROOT, normalized);
}

export async function uploadAsset(
  businessId: string,
  filename: string,
  _contentType: string,
  body: ArrayBuffer | Uint8Array,
): Promise<UploadResult> {
  const safe = safeFilename(filename);
  const rand = createHash("sha1")
    .update(`${Date.now()}:${Math.random()}`)
    .digest("hex")
    .slice(0, 16);
  const key = `${businessId}/${rand}_${safe}`;
  const disk = keyToDiskPath(key);
  await mkdir(path.dirname(disk), { recursive: true });
  const buffer = body instanceof ArrayBuffer ? Buffer.from(body) : Buffer.from(body);
  await writeFile(disk, buffer);
  return { path: key, public_url: `/api/gallery/file/${key}` };
}

export async function deleteAsset(storageUrl: string): Promise<void> {
  const prefix = "/api/gallery/file/";
  const key = storageUrl.startsWith(prefix) ? storageUrl.slice(prefix.length) : storageUrl;
  const disk = keyToDiskPath(key);
  try {
    await unlink(disk);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
}

export async function readAsset(key: string): Promise<{ body: Buffer; size: number } | null> {
  const disk = keyToDiskPath(key);
  try {
    const st = await stat(disk);
    if (!st.isFile()) return null;
    const body = await readFile(disk);
    return { body, size: st.size };
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

export async function statAsset(key: string): Promise<{ size: number } | null> {
  const disk = keyToDiskPath(key);
  try {
    const st = await stat(disk);
    return st.isFile() ? { size: st.size } : null;
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

/**
 * Stream a byte range from the asset. Used by the file route to support
 * HTTP Range requests — browsers refuse to play <video> without 206 +
 * Accept-Ranges, and a 4GB video would blow up memory if we buffered it.
 */
export function readAssetStream(
  key: string,
  start: number,
  end: number,
): ReadableStream<Uint8Array> {
  const disk = keyToDiskPath(key);
  const fileStream = createReadStream(disk, { start, end });
  return new ReadableStream<Uint8Array>({
    start(controller) {
      fileStream.on("data", (chunk) => {
        const buf = chunk instanceof Buffer ? chunk : Buffer.from(chunk);
        controller.enqueue(new Uint8Array(buf));
      });
      fileStream.on("end", () => controller.close());
      fileStream.on("error", (err) => controller.error(err));
    },
    cancel() {
      fileStream.destroy();
    },
  });
}
