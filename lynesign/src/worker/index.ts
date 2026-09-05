import { logger } from "@/lib/logging";
import { sweepOfflineScreens } from "@/worker/jobs/sweepOfflineScreens";
import { sendInvitationEmails } from "@/worker/jobs/sendInvitationEmails";
import { processMediaAsset } from "@/worker/jobs/processMediaAsset";
import { sweepStuckUploads } from "@/worker/jobs/sweepStuckUploads";
import { purgeArchivedMedia } from "@/worker/jobs/purgeArchivedMedia";
import { prunePlaybackEvents } from "@/worker/jobs/prunePlaybackEvents";

const SWEEP_INTERVAL_MS = 60_000;
const EMAIL_INTERVAL_MS = 30_000;
const MEDIA_PROCESS_INTERVAL_MS = 20_000;
const STUCK_UPLOAD_INTERVAL_MS = 300_000;
const PURGE_ARCHIVED_INTERVAL_MS = 900_000;
const PRUNE_PLAYBACK_INTERVAL_MS = 3_600_000;

let sweeping = false;
let mailing = false;
let processingMedia = false;
let sweepingUploads = false;
let purgingArchived = false;
let pruningPlayback = false;

async function runSweep(): Promise<void> {
  if (sweeping) return;
  sweeping = true;
  try {
    await sweepOfflineScreens();
  } catch (err) {
    logger.error({ err }, "sweepOfflineScreens failed");
  } finally {
    sweeping = false;
  }
}

async function runMail(): Promise<void> {
  if (mailing) return;
  mailing = true;
  try {
    await sendInvitationEmails();
  } catch (err) {
    logger.error({ err }, "sendInvitationEmails failed");
  } finally {
    mailing = false;
  }
}

async function runMediaProcess(): Promise<void> {
  if (processingMedia) return;
  processingMedia = true;
  try {
    await processMediaAsset();
  } catch (err) {
    logger.error({ err }, "processMediaAsset failed");
  } finally {
    processingMedia = false;
  }
}

async function runStuckUploadSweep(): Promise<void> {
  if (sweepingUploads) return;
  sweepingUploads = true;
  try {
    await sweepStuckUploads();
  } catch (err) {
    logger.error({ err }, "sweepStuckUploads failed");
  } finally {
    sweepingUploads = false;
  }
}

async function runPurgeArchived(): Promise<void> {
  if (purgingArchived) return;
  purgingArchived = true;
  try {
    await purgeArchivedMedia();
  } catch (err) {
    logger.error({ err }, "purgeArchivedMedia failed");
  } finally {
    purgingArchived = false;
  }
}

async function runPrunePlayback(): Promise<void> {
  if (pruningPlayback) return;
  pruningPlayback = true;
  try {
    await prunePlaybackEvents();
  } catch (err) {
    logger.error({ err }, "prunePlaybackEvents failed");
  } finally {
    pruningPlayback = false;
  }
}

console.log(
  `[worker] started, sweep every ${SWEEP_INTERVAL_MS}ms, email every ${EMAIL_INTERVAL_MS}ms, ` +
    `media processing every ${MEDIA_PROCESS_INTERVAL_MS}ms, stuck-upload sweep every ` +
    `${STUCK_UPLOAD_INTERVAL_MS}ms, archived purge every ${PURGE_ARCHIVED_INTERVAL_MS}ms, ` +
    `playback prune every ${PRUNE_PLAYBACK_INTERVAL_MS}ms`,
);

const sweepInterval = setInterval(runSweep, SWEEP_INTERVAL_MS);
const emailInterval = setInterval(runMail, EMAIL_INTERVAL_MS);
const mediaProcessInterval = setInterval(runMediaProcess, MEDIA_PROCESS_INTERVAL_MS);
const stuckUploadInterval = setInterval(runStuckUploadSweep, STUCK_UPLOAD_INTERVAL_MS);
const purgeArchivedInterval = setInterval(runPurgeArchived, PURGE_ARCHIVED_INTERVAL_MS);
const prunePlaybackInterval = setInterval(runPrunePlayback, PRUNE_PLAYBACK_INTERVAL_MS);
void runSweep();
void runMail();
void runMediaProcess();
void runStuckUploadSweep();
void runPurgeArchived();
void runPrunePlayback();

function shutdown(): void {
  console.log("[worker] shutting down");
  clearInterval(sweepInterval);
  clearInterval(emailInterval);
  clearInterval(mediaProcessInterval);
  clearInterval(stuckUploadInterval);
  clearInterval(purgeArchivedInterval);
  clearInterval(prunePlaybackInterval);
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
