import { NextResponse, type NextRequest } from "next/server";

import { prisma } from "@/lib/db/root";
import { authenticateDevice } from "@/lib/player/device-auth";
import { ValidationError, toProblem } from "@/lib/errors";
import { withRequestId } from "@/lib/logging";
import {
  playbackBatchSchema,
  withinIngestWindow,
  type PlaybackEventInput,
} from "@/lib/validation/analytics";

const MAX_BATCH = 500;
const MAX_BODY_BYTES = 512 * 1024; // about 500 events of well under 1KB each, generous

type ContentKey =
  | "mediaAssetId"
  | "playlistId"
  | "campaignId"
  | "scheduleRuleId";

/**
 * `POST /api/player/events` -- a paired player reports the airings it displayed.
 * Bearer device token in, a batch of playback events in the body. Each event
 * carries a client-supplied `id` that is the idempotency key, so a replayed
 * batch inserts nothing new and is reported back as duplicates.
 *
 * A missing or unknown token is a 401 problem. A body that is not valid JSON, or
 * that fails the batch schema, is a 422 problem. A body whose declared
 * `content-length`, or whose `events` array, is over the cap is a 413 problem. A
 * batch that names a screen other than the reporting one is a 400 problem and
 * nothing is written.
 *
 * Events outside the ingest window are dropped and counted, never stored. Every
 * content id is checked against the reporting screen's organization before it is
 * persisted; an id that does not resolve is stored as null so a stale client
 * reference never dangles.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  return withRequestId(async (log) => {
    try {
      const screen = await authenticateDevice(req);

      // Reject an oversized body from its declared length before reading it. App
      // Router handlers have no default body limit, so without this a paired
      // device could stream a huge payload and exhaust memory before the
      // batch-length cap below is ever consulted. Chunked requests carry no
      // content-length and fall through to that second gate.
      const declaredLength = Number(req.headers.get("content-length") ?? "0");
      if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
        return NextResponse.json(
          {
            type: "payload_too_large",
            title: "Payload too large",
            detail: "The request body is too large.",
          },
          { status: 413 },
        );
      }

      let body: unknown;
      try {
        body = await req.json();
      } catch {
        throw new ValidationError("The request body must be valid JSON.");
      }

      const rawEvents = (body as { events?: unknown } | null | undefined)
        ?.events;
      if (Array.isArray(rawEvents) && rawEvents.length > MAX_BATCH) {
        return NextResponse.json(
          {
            type: "payload_too_large",
            title: "Payload too large",
            detail: "A batch may carry at most 500 events.",
          },
          { status: 413 },
        );
      }

      const parsed = playbackBatchSchema.safeParse(body);
      if (!parsed.success) {
        throw new ValidationError(
          parsed.error.issues[0]?.message ?? "The batch payload is invalid.",
        );
      }

      const events = parsed.data.events;
      if (events.some((e) => e.screenId !== screen.id)) {
        return NextResponse.json(
          {
            type: "bad_request",
            title: "Bad request",
            detail: "A batch may only contain airings for the reporting screen.",
          },
          { status: 400 },
        );
      }

      const now = new Date();
      const kept = events.filter((e) =>
        withinIngestWindow(new Date(e.airedAt), now),
      );
      const dropped = events.length - kept.length;

      const org = screen.organizationId;

      const uniqueIds = (key: ContentKey): string[] => [
        ...new Set(
          kept.map((e) => e[key]).filter((v): v is string => v != null),
        ),
      ];

      const resolvable = async (
        ids: string[],
        find: (ids: string[]) => Promise<Array<{ id: string }>>,
      ): Promise<Set<string>> => {
        if (ids.length === 0) return new Set<string>();
        const rows = await find(ids);
        return new Set(rows.map((r) => r.id));
      };

      const [assetSet, playlistSet, campaignSet, ruleSet] = await Promise.all([
        resolvable(uniqueIds("mediaAssetId"), (ids) =>
          prisma.mediaAsset.findMany({
            where: { id: { in: ids }, organizationId: org },
            select: { id: true },
          }),
        ),
        resolvable(uniqueIds("playlistId"), (ids) =>
          prisma.playlist.findMany({
            where: { id: { in: ids }, organizationId: org },
            select: { id: true },
          }),
        ),
        resolvable(uniqueIds("campaignId"), (ids) =>
          prisma.campaign.findMany({
            where: { id: { in: ids }, organizationId: org },
            select: { id: true },
          }),
        ),
        resolvable(uniqueIds("scheduleRuleId"), (ids) =>
          prisma.scheduleRule.findMany({
            where: { id: { in: ids }, organizationId: org },
            select: { id: true },
          }),
        ),
      ]);

      const keep = (value: string | null | undefined, set: Set<string>) =>
        value != null && set.has(value) ? value : null;

      const rows = kept.map((e: PlaybackEventInput) => ({
        id: e.id,
        organizationId: org,
        screenId: screen.id,
        mediaAssetId: keep(e.mediaAssetId, assetSet),
        playlistId: keep(e.playlistId, playlistSet),
        source: e.source,
        campaignId: keep(e.campaignId, campaignSet),
        scheduleRuleId: keep(e.scheduleRuleId, ruleSet),
        airedAt: new Date(e.airedAt),
        durationSeconds: e.durationSeconds,
      }));

      const result = await prisma.playbackEvent.createMany({
        data: rows,
        skipDuplicates: true,
      });

      return NextResponse.json({
        accepted: result.count,
        duplicates: kept.length - result.count,
        dropped,
      });
    } catch (err) {
      const problem = toProblem(err);
      if (problem.status >= 500) log.error({ err }, "events ingest failed");
      return NextResponse.json(problem.body, { status: problem.status });
    }
  });
}
