import { spawn } from "node:child_process";

import sharp from "sharp";

import { prisma } from "@/lib/db/root";
import { logger } from "@/lib/logging";
import { storage, assetThumbKey } from "@/lib/storage";

const BATCH_SIZE = 10;
const MAX_ATTEMPTS = 5;
const DOWNLOAD_TTL_SECONDS = 900;
const THUMB_SIZE = 480;
const COMMAND_TIMEOUT_MS = 120_000;

type SpawnResult =
  | { toolMissing: true }
  | { toolMissing: false; code: number | null; stdout: Buffer; stderr: string };

/**
 * Runs an external command and buffers its output. A missing binary (`ENOENT`,
 * whether thrown synchronously or delivered as an `error` event) resolves to
 * `{ toolMissing: true }` rather than rejecting, so the caller can treat the
 * media toolchain as optional.
 *
 * A `spawn` `timeout` guards against a hung `ffprobe`/`ffmpeg` stalled on the
 * presigned URL: Node kills the child with `SIGKILL` after `COMMAND_TIMEOUT_MS`,
 * which surfaces as a `close` with a non-null signal and no exit code. That is
 * rejected as a normal command failure (not `toolMissing`) so it flows through
 * the caller's retry path. Any other spawn failure rejects too.
 */
function runCommand(command: string, args: string[]): Promise<SpawnResult> {
  return new Promise((resolve, reject) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(command, args, {
        timeout: COMMAND_TIMEOUT_MS,
        killSignal: "SIGKILL",
      });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        resolve({ toolMissing: true });
        return;
      }
      reject(err instanceof Error ? err : new Error(String(err)));
      return;
    }

    const stdout: Buffer[] = [];
    let stderr = "";
    let settled = false;

    child.stdout?.on("data", (chunk: Buffer) => {
      stdout.push(Buffer.from(chunk));
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", (err: Error) => {
      if (settled) return;
      settled = true;
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        resolve({ toolMissing: true });
        return;
      }
      reject(err);
    });
    child.on("close", (code: number | null, signal: NodeJS.Signals | null) => {
      if (settled) return;
      settled = true;
      if (signal !== null) {
        reject(new Error(`${command} timed out after ${COMMAND_TIMEOUT_MS / 1000}s`));
        return;
      }
      resolve({ toolMissing: false, code, stdout: Buffer.concat(stdout), stderr });
    });
  });
}

type Probe = {
  durationSeconds?: number;
  width?: number;
  height?: number;
};

/** Reads container metadata with `ffprobe`. Throws on a non-zero exit or bad JSON. */
async function probe(url: string): Promise<Probe | null> {
  const res = await runCommand("ffprobe", [
    "-v",
    "quiet",
    "-print_format",
    "json",
    "-show_format",
    "-show_streams",
    url,
  ]);
  if (res.toolMissing) return null;
  if (res.code !== 0) {
    throw new Error(`ffprobe exited with code ${res.code}: ${res.stderr.trim()}`);
  }

  const parsed = JSON.parse(res.stdout.toString()) as {
    format?: { duration?: string | number };
    streams?: Array<{ codec_type?: string; width?: number; height?: number }>;
  };

  const out: Probe = {};
  const duration = Number(parsed.format?.duration);
  if (Number.isFinite(duration)) out.durationSeconds = Math.round(duration);

  const video = parsed.streams?.find((s) => s.codec_type === "video");
  if (video) {
    if (typeof video.width === "number") out.width = video.width;
    if (typeof video.height === "number") out.height = video.height;
  }
  return out;
}

/** Grabs a single frame with `ffmpeg` as a PNG buffer. Throws on a non-zero exit. */
async function poster(url: string): Promise<Buffer | null> {
  const res = await runCommand("ffmpeg", [
    "-ss",
    "1",
    "-i",
    url,
    "-frames:v",
    "1",
    "-f",
    "image2pipe",
    "-vcodec",
    "png",
    "-",
  ]);
  if (res.toolMissing) return null;
  if (res.code !== 0 || res.stdout.length === 0) {
    throw new Error(`ffmpeg poster failed with code ${res.code}: ${res.stderr.trim()}`);
  }
  return res.stdout;
}

/**
 * Drains a batch of the global `MediaProcessingJob` queue.
 *
 * Each job carries one VIDEO `MediaAsset`. The asset gets a presigned GET URL,
 * `ffprobe` fills in `durationSeconds` (and `width`/`height` when still unset),
 * and `ffmpeg` plus `sharp` produce a 480px webp poster stored under the asset's
 * thumbnail key. A job whose asset is gone or archived is marked `DONE` and
 * skipped. When the media toolchain is not installed (`ENOENT`) the job is still
 * marked `DONE` with no duration and no thumbnail; the card falls back to a
 * glyph. Any real error bumps `attempts` and keeps the job retryable until it
 * has failed five times, then it is parked `FAILED`.
 */
export async function processMediaAsset(): Promise<{ done: number; failed: number }> {
  const jobs = await prisma.mediaProcessingJob.findMany({
    where: { status: { in: ["PENDING", "FAILED"] }, attempts: { lt: MAX_ATTEMPTS } },
    orderBy: { createdAt: "asc" },
    take: BATCH_SIZE,
  });

  let done = 0;
  let failed = 0;

  for (const job of jobs) {
    const asset = await prisma.mediaAsset.findUnique({ where: { id: job.mediaAssetId } });

    if (!asset || asset.archivedAt || !asset.storageKey) {
      await prisma.mediaProcessingJob.update({
        where: { id: job.id },
        data: { status: "DONE" },
      });
      done += 1;
      continue;
    }

    try {
      const url = await storage.createDownloadUrl(asset.storageKey, DOWNLOAD_TTL_SECONDS);

      const meta = await probe(url);

      if (meta === null) {
        // ffprobe is not installed, so ffmpeg is not either. Leave the asset
        // untouched (the card falls back to a glyph) and park the job DONE.
        await prisma.mediaProcessingJob.update({
          where: { id: job.id },
          data: { status: "DONE" },
        });
        done += 1;
        continue;
      }

      // Persist the probe fields before the poster step. If `ffmpeg` then throws,
      // the retry re-probes but this write is not lost, and the "only when null"
      // guard on width/height keeps that re-run idempotent.
      const probeData: { durationSeconds?: number; width?: number; height?: number } = {};
      if (meta.durationSeconds !== undefined) probeData.durationSeconds = meta.durationSeconds;
      if (asset.width === null && meta.width !== undefined) probeData.width = meta.width;
      if (asset.height === null && meta.height !== undefined) probeData.height = meta.height;

      if (Object.keys(probeData).length > 0) {
        await prisma.mediaAsset.update({ where: { id: asset.id }, data: probeData });
      }

      const png = await poster(url);
      if (png) {
        const thumb = await sharp(png)
          .resize(THUMB_SIZE, THUMB_SIZE, { fit: "inside" })
          .webp()
          .toBuffer();
        const thumbKey = assetThumbKey(asset.organizationId, asset.id);
        await storage.putObject(thumbKey, thumb, "image/webp");
        await prisma.mediaAsset.update({
          where: { id: asset.id },
          data: { thumbnailKey: thumbKey },
        });
      }

      await prisma.mediaProcessingJob.update({
        where: { id: job.id },
        data: { status: "DONE", lastError: null },
      });
      done += 1;
    } catch (err) {
      const attempts = job.attempts + 1;
      const parked = attempts >= MAX_ATTEMPTS;
      await prisma.mediaProcessingJob.update({
        where: { id: job.id },
        data: {
          attempts,
          lastError: err instanceof Error ? err.message : String(err),
          status: parked ? "FAILED" : "PENDING",
        },
      });
      if (parked) failed += 1;
    }
  }

  if (jobs.length > 0) {
    logger.info({ done, failed, scanned: jobs.length }, "processed media asset jobs");
  }
  return { done, failed };
}
