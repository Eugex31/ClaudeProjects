import { z } from "zod";

/**
 * Input schemas and time helpers for playback event ingestion. Players POST
 * batches of airing records to report what was actually played on screen.
 * Each batch is safe-parsed as a front gate: it rejects malformed event data,
 * invalid sources, out-of-range durations, and non-ISO datetimes before any of
 * that reaches the database. The ingest window enforces a 7-day lookback and
 * 1-hour lookahead tolerance to account for clock skew and batch delays.
 */

const eventId = z.string().min(1).max(64);
const screenId = z.string().cuid();
const contentId = z.string().cuid().nullish();
const eventSource = z.enum(["playlist", "campaign", "schedule"]);
const isoDateTime = z.string().datetime();
const duration = z.number().int().min(0).max(86400);

export const playbackEventSchema = z.object({
  id: eventId,
  screenId,
  mediaAssetId: contentId,
  playlistId: contentId,
  campaignId: contentId,
  scheduleRuleId: contentId,
  source: eventSource,
  airedAt: isoDateTime,
  durationSeconds: duration,
});

export const playbackBatchSchema = z.object({
  events: z.array(playbackEventSchema).min(1).max(500),
});

/**
 * Check if an airedAt timestamp is within the ingest window. Both bounds are
 * inclusive: exactly 7 days old passes, exactly 1 hour in the future passes.
 * Returns true iff airedAt >= now - 7 days AND airedAt <= now + 1 hour.
 */
export function withinIngestWindow(airedAt: Date, now: Date): boolean {
  const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
  const oneHourMs = 60 * 60 * 1000;

  const airedTime = airedAt.getTime();
  const nowTime = now.getTime();

  return airedTime >= nowTime - sevenDaysMs && airedTime <= nowTime + oneHourMs;
}

export type PlaybackEventInput = z.infer<typeof playbackEventSchema>;
