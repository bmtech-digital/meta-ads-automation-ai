import "server-only";
import { spawn } from "node:child_process";
import { rename, stat, unlink } from "node:fs/promises";
import { keyToDiskPath } from "./storage";

/**
 * Server-side video transcoding pipeline.
 *
 * Why this exists: iPhone/Mac record .mov files using HEVC (H.265). Chrome
 * on Windows 10 cannot decode HEVC without a paid extension, so the inline
 * <video> player throws MEDIA_ERR_SRC_NOT_SUPPORTED. Meta also rejects
 * non-H.264 video on its ad endpoints. Re-encoding once at upload time fixes
 * both problems for free.
 *
 * Flow: probe with ffprobe → if not (H.264 + MP4), re-encode with ffmpeg →
 * replace the original file → return the new key/url/size/duration. If
 * ffmpeg is missing or crashes, leave the original file alone and report
 * `transcoded: false` — the gallery still surfaces the file, the player
 * just may not play it.
 */

interface ProbeResult {
  codec_name: string;
  container: string; // e.g. "mov,mp4,m4a,3gp,3g2,mj2"
  width: number;
  height: number;
  duration_seconds: number | null;
}

interface ChildResult {
  code: number;
  stdout: string;
  stderr: string;
}

function runChild(
  cmd: string,
  args: string[],
  opts: { timeoutMs?: number } = {},
): Promise<ChildResult> {
  return new Promise((resolve, reject) => {
    let proc;
    try {
      proc = spawn(cmd, args);
    } catch (err) {
      reject(err);
      return;
    }
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (c: Buffer) => {
      stdout += c.toString();
    });
    proc.stderr.on("data", (c: Buffer) => {
      stderr += c.toString();
    });
    const timer = opts.timeoutMs
      ? setTimeout(() => {
          proc.kill("SIGKILL");
          reject(new Error(`${cmd} timed out after ${opts.timeoutMs}ms`));
        }, opts.timeoutMs)
      : null;
    proc.on("error", (err: Error) => {
      if (timer) clearTimeout(timer);
      reject(err);
    });
    proc.on("close", (code: number | null) => {
      if (timer) clearTimeout(timer);
      resolve({ code: code ?? -1, stdout, stderr });
    });
  });
}

async function probeVideo(diskPath: string): Promise<ProbeResult | null> {
  try {
    const { code, stdout } = await runChild(
      "ffprobe",
      [
        "-v",
        "error",
        "-select_streams",
        "v:0",
        "-show_entries",
        "stream=codec_name,width,height",
        "-show_entries",
        "format=format_name,duration",
        "-of",
        "json",
        diskPath,
      ],
      { timeoutMs: 30_000 },
    );
    if (code !== 0) return null;
    const j = JSON.parse(stdout) as {
      streams?: Array<{ codec_name?: string; width?: number; height?: number }>;
      format?: { format_name?: string; duration?: string };
    };
    const stream = j.streams?.[0];
    const fmt = j.format;
    if (!stream || !fmt) return null;
    return {
      codec_name: stream.codec_name ?? "",
      container: fmt.format_name ?? "",
      width: stream.width ?? 0,
      height: stream.height ?? 0,
      duration_seconds: fmt.duration ? Number(fmt.duration) : null,
    };
  } catch {
    return null;
  }
}

async function transcodeToH264Mp4(input: string, output: string): Promise<void> {
  // -preset fast: balance between speed and size.
  // -crf 23: visually-lossless default for libx264.
  // -pix_fmt yuv420p: forces a profile every browser can decode (without it,
  //   high-profile yuv444p output plays in Chrome but not iOS Safari).
  // -movflags +faststart: moves the moov atom to the start so the browser
  //   can begin playback before downloading the whole file.
  const { code, stderr } = await runChild(
    "ffmpeg",
    [
      "-y",
      "-i",
      input,
      "-c:v",
      "libx264",
      "-preset",
      "fast",
      "-crf",
      "23",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-b:a",
      "128k",
      "-movflags",
      "+faststart",
      output,
    ],
    { timeoutMs: 10 * 60 * 1000 },
  );
  if (code !== 0) {
    throw new Error(`ffmpeg exit ${code}: ${stderr.slice(-300)}`);
  }
}

function isWebCompatible(probe: ProbeResult): boolean {
  if (probe.codec_name !== "h264") return false;
  // ffprobe reports MOV files with a comma-joined format list that includes
  // "mp4". For our purposes that's still a non-MP4 container — Chrome plays
  // most H.264-in-MOV files, but to keep behavior uniform (and to match what
  // Meta expects) we transcode anything that isn't a clean MP4.
  const c = probe.container.toLowerCase();
  if (c === "mov" || c === "mov,mp4,m4a,3gp,3g2,mj2") return false;
  return c.includes("mp4");
}

function swapExt(key: string, newExt: string): string {
  const ix = key.lastIndexOf(".");
  return ix > 0 ? key.slice(0, ix) + newExt : key + newExt;
}

function inferMimeFromKey(key: string): string {
  const ix = key.lastIndexOf(".");
  const ext = ix > 0 ? key.slice(ix).toLowerCase() : "";
  if (ext === ".mp4") return "video/mp4";
  if (ext === ".mov") return "video/quicktime";
  return "application/octet-stream";
}

export interface EnsureWebCompatResult {
  storageKey: string;
  publicUrl: string;
  sizeBytes: number;
  durationSeconds: number | null;
  dimensions: string | null;
  mimeType: string;
  transcoded: boolean;
  reason: string;
}

export async function ensureWebCompatVideo(
  originalKey: string,
): Promise<EnsureWebCompatResult> {
  const inputDisk = keyToDiskPath(originalKey);
  const probe = await probeVideo(inputDisk);

  if (!probe) {
    // Probing failed — likely ffprobe missing in the runtime. Keep file as-is.
    const st = await stat(inputDisk);
    return {
      storageKey: originalKey,
      publicUrl: `/api/gallery/file/${originalKey}`,
      sizeBytes: st.size,
      durationSeconds: null,
      dimensions: null,
      mimeType: inferMimeFromKey(originalKey),
      transcoded: false,
      reason: "probe_unavailable",
    };
  }

  const dimensions =
    probe.width && probe.height ? `${probe.width}x${probe.height}` : null;

  if (isWebCompatible(probe)) {
    const st = await stat(inputDisk);
    return {
      storageKey: originalKey,
      publicUrl: `/api/gallery/file/${originalKey}`,
      sizeBytes: st.size,
      durationSeconds: probe.duration_seconds,
      dimensions,
      mimeType: "video/mp4",
      transcoded: false,
      reason: "already_h264_mp4",
    };
  }

  const newKey = swapExt(originalKey, ".mp4");
  const newDisk = keyToDiskPath(newKey);
  const tmpDisk = newDisk === inputDisk ? `${newDisk}.transcoding.tmp` : newDisk;

  try {
    await transcodeToH264Mp4(inputDisk, tmpDisk);
  } catch (err) {
    await unlink(tmpDisk).catch(() => {});
    throw err;
  }

  if (tmpDisk !== newDisk) {
    await rename(tmpDisk, newDisk);
  }
  if (newDisk !== inputDisk) {
    await unlink(inputDisk).catch(() => {});
  }

  const st = await stat(newDisk);
  const outProbe = await probeVideo(newDisk);
  const finalDuration = outProbe?.duration_seconds ?? probe.duration_seconds;
  const finalWidth = outProbe?.width ?? probe.width;
  const finalHeight = outProbe?.height ?? probe.height;
  const finalDims =
    finalWidth && finalHeight ? `${finalWidth}x${finalHeight}` : dimensions;

  return {
    storageKey: newKey,
    publicUrl: `/api/gallery/file/${newKey}`,
    sizeBytes: st.size,
    durationSeconds: finalDuration,
    dimensions: finalDims,
    mimeType: "video/mp4",
    transcoded: true,
    reason: `transcoded_from_${probe.codec_name}_${probe.container.split(",")[0]}`,
  };
}
