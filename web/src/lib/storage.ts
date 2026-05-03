import "server-only";
import { createHash } from "node:crypto";
import { mkdir, writeFile, unlink, stat, readFile } from "node:fs/promises";
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
