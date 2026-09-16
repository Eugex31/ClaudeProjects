import type { PrismaClient } from "@prisma/client";

import {
  resolveScreenContent,
  type ScheduleResolutionInput,
} from "@/lib/player/campaign";
import {
  zonedNow,
  scheduleRuleMatches,
  type ScheduleRuleCandidate,
} from "@/lib/player/schedule";
import { buildCanvasManifest } from "@/lib/player/canvas-preview";
import type { CanvasManifest } from "@/lib/player/canvas-manifest";

/**
 * The Prisma surface the resolver needs: the four tenant delegates it reads
 * (`location`, `campaign`, `scheduleRule`, `canvas`) plus `mediaAsset`, which the
 * shared `CanvasReader` in `buildCanvasManifest` is a subset of. Both the
 * unscoped root `prisma` on the device sync path -- where every `where` carries
 * an explicit `organizationId` -- and a tenant-scoped `ctx.db` facade on the
 * operator path satisfy it, so the two callers share one code path.
 */
export type ScreenPlaybackReader = Pick<
  PrismaClient,
  "location" | "campaign" | "scheduleRule" | "canvas" | "mediaAsset"
>;

/**
 * The flat playback identity for one screen at one instant: the same precedence
 * `GET /api/player/sync` applies -- active campaign, then matching schedule rule,
 * then canvas tier, then the base playlist, then nothing -- reduced to the
 * fields a caller needs to load and present the effective content. The canvas
 * arm carries the assembled manifest because the canvas tier is the one place
 * the resolver has to build it to decide whether the canvas is renderable.
 */
export type ResolvedPlayback =
  | { source: "canvas"; canvasId: string; canvas: CanvasManifest }
  | {
      source: "campaign";
      playlistId: string;
      campaign: { id: string; name: string; revision: number; endsAt: Date };
    }
  | {
      source: "schedule";
      playlistId: string;
      rule: { id: string; name: string | null; revision: number };
      campaign: { id: string; name: string; revision: number } | null;
    }
  | { source: "playlist"; playlistId: string }
  | { source: "none" };

/** Minimal screen shape the resolver reads. */
export interface ScreenForPlayback {
  id: string;
  organizationId: string;
  locationId: string;
  playlistId: string | null;
  canvasId: string | null;
}

/** Just the `warn` channel of the caller's logger; the sync route passes its
 * pino `log`, the operator preview route passes a noop. */
export interface PlaybackLog {
  warn: (obj: unknown, msg: string) => void;
}

/**
 * Resolve what a single screen should be playing right now, reproducing the tier
 * logic that `GET /api/player/sync` used to inline:
 *
 *  - The screen's location time zone is looked up (default "UTC").
 *  - Active campaigns targeting the screen or its location are queried; the pure
 *    `resolveScreenContent` picks the highest-priority one in its window.
 *  - The schedule tier runs inside a `try` that swallows a `RangeError` from a
 *    bad time zone, logs it, and treats the tier as absent. A matching rule may
 *    point at its own playlist or at a campaign whose playlist is served; two
 *    matches log an overlap warning and the lowest id wins.
 *  - The canvas tier builds the manifest for a canvas-mode screen; a missing,
 *    archived or empty canvas falls through to the base playlist by re-resolving
 *    with the canvas tier suppressed.
 *
 * The resolver never assembles a playlist manifest -- that stays device-specific
 * in the sync route -- it only names the effective playlist and its campaign or
 * rule metadata.
 */
export async function resolveScreenPlayback(
  db: ScreenPlaybackReader,
  screen: ScreenForPlayback,
  now: Date,
  log: PlaybackLog,
): Promise<ResolvedPlayback> {
  const location = await db.location.findFirst({
    where: { id: screen.locationId, organizationId: screen.organizationId },
    select: { timeZone: true },
  });
  const timeZone = location?.timeZone ?? "UTC";

  const campaignRows = await db.campaign.findMany({
    where: {
      organizationId: screen.organizationId,
      enabled: true,
      archivedAt: null,
      startsAt: { lte: now },
      endsAt: { gt: now },
      OR: [
        { screens: { some: { screenId: screen.id } } },
        { locations: { some: { locationId: screen.locationId } } },
      ],
    },
    select: {
      id: true,
      name: true,
      revision: true,
      playlistId: true,
      priority: true,
      startsAt: true,
      endsAt: true,
      enabled: true,
      archivedAt: true,
      screens: { select: { screenId: true } },
      locations: { select: { locationId: true } },
    },
  });

  let scheduleInput: ScheduleResolutionInput | null = null;
  try {
    const zoned = zonedNow(now, timeZone);

    const ruleRows = await db.scheduleRule.findMany({
      where: {
        organizationId: screen.organizationId,
        enabled: true,
        archivedAt: null,
        OR: [
          { screens: { some: { screenId: screen.id } } },
          { locations: { some: { locationId: screen.locationId } } },
        ],
      },
      select: {
        id: true,
        name: true,
        revision: true,
        playlistId: true,
        campaignId: true,
        daysOfWeek: true,
        startMinute: true,
        endMinute: true,
        effectiveFrom: true,
        effectiveUntil: true,
      },
    });

    const matches = ruleRows
      .map((r) => ({
        r,
        candidate: {
          id: r.id,
          daysOfWeek: r.daysOfWeek,
          startMinute: r.startMinute,
          endMinute: r.endMinute,
          effectiveFrom: r.effectiveFrom
            ? r.effectiveFrom.toISOString().slice(0, 10)
            : null,
          effectiveUntil: r.effectiveUntil
            ? r.effectiveUntil.toISOString().slice(0, 10)
            : null,
        } satisfies ScheduleRuleCandidate,
      }))
      .filter((x) => scheduleRuleMatches(x.candidate, zoned))
      .map((x) => x.r)
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

    if (matches.length > 1) {
      log.warn(
        { ruleIds: matches.map((m) => m.id) },
        "overlapping schedule rules",
      );
    }

    const rule = matches[0];
    if (rule) {
      let effectivePlaylistId: string | null = rule.playlistId;
      let campaignForRule:
        | { id: string; name: string; revision: number }
        | null = null;

      if (rule.campaignId) {
        const camp = await db.campaign.findFirst({
          where: {
            id: rule.campaignId,
            organizationId: screen.organizationId,
          },
          select: { id: true, name: true, revision: true, playlistId: true },
        });
        if (camp && camp.playlistId) {
          effectivePlaylistId = camp.playlistId;
          campaignForRule = {
            id: camp.id,
            name: camp.name,
            revision: camp.revision,
          };
        } else {
          effectivePlaylistId = null;
        }
      }

      if (effectivePlaylistId) {
        scheduleInput = {
          ruleId: rule.id,
          ruleName: rule.name,
          ruleRevision: rule.revision,
          playlistId: effectivePlaylistId,
          campaignId: campaignForRule?.id ?? null,
          campaignName: campaignForRule?.name ?? null,
          campaignRevision: campaignForRule?.revision ?? null,
        };
      }
    }
  } catch (err) {
    if (err instanceof RangeError) {
      log.warn(
        { timeZone },
        "schedule tier skipped for an unrecognized location time zone",
      );
      scheduleInput = null;
    } else {
      throw err;
    }
  }

  const canvasInput = screen.canvasId ? { canvasId: screen.canvasId } : null;

  // Hoisted so the canvas tier can re-resolve with `canvas: null` when the
  // canvas is gone or empty, without rebuilding the campaign and schedule
  // inputs a second time.
  const resolveArgs = {
    screen: {
      id: screen.id,
      locationId: screen.locationId,
      playlistId: screen.playlistId,
    },
    now,
    campaigns: campaignRows.map((c) => ({
      ...c,
      screenIds: c.screens.map((s) => s.screenId),
      locationIds: c.locations.map((l) => l.locationId),
    })),
    schedule: scheduleInput,
  };

  let resolved = resolveScreenContent({ ...resolveArgs, canvas: canvasInput });

  // Canvas tier. It sits below campaign and schedule, so a campaign or a
  // schedule win leaves `resolved.source` as something other than "canvas" and
  // this block is skipped. On a canvas hit with at least one renderable panel
  // the built manifest is returned; a missing or empty canvas re-resolves with
  // the canvas tier suppressed and continues to the playlist tier.
  if (resolved.source === "canvas") {
    const manifest = screen.canvasId
      ? await buildCanvasManifest(db, screen.canvasId, screen.organizationId)
      : null;
    if (manifest != null && manifest.panels.length > 0 && screen.canvasId) {
      return { source: "canvas", canvasId: screen.canvasId, canvas: manifest };
    }
    resolved = resolveScreenContent({ ...resolveArgs, canvas: null });
  }

  if (resolved.source === "campaign") {
    return {
      source: "campaign",
      playlistId: resolved.playlistId,
      campaign: {
        id: resolved.campaignId,
        name: resolved.campaignName,
        revision: resolved.campaignRevision,
        endsAt: new Date(resolved.campaignEndsAt),
      },
    };
  }

  if (resolved.source === "schedule") {
    return {
      source: "schedule",
      playlistId: resolved.playlistId,
      rule: {
        id: resolved.scheduleRuleId,
        name: resolved.scheduleRuleName,
        revision: resolved.scheduleRuleRevision,
      },
      campaign:
        resolved.campaignId != null &&
        resolved.campaignName != null &&
        resolved.campaignRevision != null
          ? {
              id: resolved.campaignId,
              name: resolved.campaignName,
              revision: resolved.campaignRevision,
            }
          : null,
    };
  }

  if (resolved.source === "playlist") {
    return { source: "playlist", playlistId: resolved.playlistId };
  }

  return { source: "none" };
}
