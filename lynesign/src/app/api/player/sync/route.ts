import { NextResponse, type NextRequest } from "next/server";

import { prisma } from "@/lib/db/root";
import { resolveScreenPlayback } from "@/lib/player/resolve-screen-playback";
import { authenticateDevice } from "@/lib/player/device-auth";
import { assembleManifest } from "@/lib/player/manifest";
import { storage } from "@/lib/storage";
import { can, type Actor } from "@/lib/rbac/can";
import { ForbiddenError, toProblem } from "@/lib/errors";
import { withRequestId } from "@/lib/logging";

const DOWNLOAD_URL_TTL_SECONDS = 3600;

/**
 * `GET /api/player/sync` -- a paired player pulls what it should be showing.
 * The screen is resolved from its bearer token, then an explicit `screen` actor
 * is checked against `player.sync` -- so if a future action is ever routed
 * through a screen actor, it is denied unless it is on the screen allow-list.
 *
 * Before the base playlist is loaded, active campaigns targeting the screen or
 * its location are resolved: the highest-priority one in its window wins and its
 * playlist is served instead. When no campaign wins, a schedule rule targeting
 * the screen or its location that matches the current time in the screen's
 * location time zone wins over the base playlist; a rule may point at its own
 * playlist or at a campaign whose playlist is then served. Below the schedule
 * tier and above the base playlist sits the canvas tier: a screen with a
 * `canvasId` serves an assembled canvas manifest instead of a playlist, and a
 * canvas that has been removed or left with no renderable panels falls through
 * to the base playlist. The response always carries a `source` of "campaign",
 * "schedule", "canvas", "playlist", or "none", a `campaign` object only when a
 * campaign identity applies, a `schedule` object only when a rule won, and a
 * `canvas` key that holds the manifest on a canvas hit and is null otherwise. A
 * misconfigured location time zone never breaks sync: the schedule tier is
 * skipped and the base playlist is served.
 *
 * The response carries the screen's poll interval and, when an effective
 * playlist is resolved, the assembled manifest: the playlist's enabled items in
 * position order, each resolved to a ready, non-archived asset with a freshly
 * signed download URL.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  return withRequestId(async (log) => {
    try {
      const screen = await authenticateDevice(req);
      const actor: Actor = {
        kind: "screen",
        screenId: screen.id,
        organizationId: screen.organizationId,
      };
      if (!can(actor, "player.sync")) {
        throw new ForbiddenError("This screen may not sync.");
      }

      const base = {
        screenId: screen.id,
        pollIntervalSeconds: screen.pollIntervalSeconds,
      };

      const now = new Date();

      const resolved = await resolveScreenPlayback(prisma, screen, now, log);

      // Canvas tier. The resolver has already built and vetted the manifest, so
      // a canvas hit is served straight back with every other source key null.
      if (resolved.source === "canvas") {
        return NextResponse.json({
          ...base,
          source: "canvas",
          campaign: null,
          schedule: null,
          playlist: null,
          canvas: resolved.canvas,
        });
      }

      const campaignPayload =
        resolved.source === "campaign"
          ? {
              id: resolved.campaign.id,
              name: resolved.campaign.name,
              revision: resolved.campaign.revision,
              endsAt: resolved.campaign.endsAt.toISOString(),
            }
          : resolved.source === "schedule" && resolved.campaign != null
            ? {
                id: resolved.campaign.id,
                name: resolved.campaign.name,
                revision: resolved.campaign.revision,
              }
            : null;

      const schedulePayload =
        resolved.source === "schedule"
          ? {
              id: resolved.rule.id,
              name: resolved.rule.name,
              revision: resolved.rule.revision,
              playlistId: resolved.playlistId,
              campaignId: resolved.campaign?.id ?? null,
            }
          : null;

      const effectivePlaylistId =
        resolved.source === "none" ? null : resolved.playlistId;

      if (effectivePlaylistId == null) {
        return NextResponse.json({
          ...base,
          source: "none",
          campaign: null,
          schedule: null,
          playlist: null,
          canvas: null,
        });
      }

      const playlist = await prisma.playlist.findFirst({
        where: { id: effectivePlaylistId, organizationId: screen.organizationId },
        select: {
          id: true,
          name: true,
          revision: true,
          defaultImageDurationSeconds: true,
          defaultWebDurationSeconds: true,
        },
      });
      if (!playlist) {
        return NextResponse.json({
          ...base,
          source: resolved.source,
          campaign: campaignPayload,
          schedule: schedulePayload,
          playlist: null,
          canvas: null,
        });
      }

      const items = await prisma.playlistItem.findMany({
        where: {
          playlistId: playlist.id,
          organizationId: screen.organizationId,
          enabled: true,
        },
        orderBy: { position: "asc" },
        select: {
          id: true,
          mediaAssetId: true,
          position: true,
          durationSeconds: true,
          enabled: true,
        },
      });

      const assets = items.length
        ? await prisma.mediaAsset.findMany({
            where: {
              id: { in: items.map((i) => i.mediaAssetId) },
              organizationId: screen.organizationId,
            },
            select: {
              id: true,
              kind: true,
              status: true,
              archivedAt: true,
              storageKey: true,
              url: true,
              mimeType: true,
              width: true,
              height: true,
              durationSeconds: true,
            },
          })
        : [];

      const assetsById = new Map(assets.map((a) => [a.id, a]));

      const keys = [
        ...new Set(
          assets
            .filter((a) => a.storageKey != null && a.storageKey !== "")
            .map((a) => a.storageKey as string),
        ),
      ];
      const signed = await Promise.all(
        keys.map((k) => storage.createDownloadUrl(k, DOWNLOAD_URL_TTL_SECONDS)),
      );
      const urlMap = new Map(keys.map((k, i) => [k, signed[i]]));

      const manifestItems = assembleManifest({
        playlist: {
          defaultImageDurationSeconds: playlist.defaultImageDurationSeconds,
          defaultWebDurationSeconds: playlist.defaultWebDurationSeconds,
        },
        items,
        assetsById,
        signUrl: (k) => urlMap.get(k) ?? "",
      });

      return NextResponse.json({
        ...base,
        source: resolved.source,
        campaign: campaignPayload,
        schedule: schedulePayload,
        playlist: {
          id: playlist.id,
          name: playlist.name,
          revision: playlist.revision,
          items: manifestItems,
        },
        canvas: null,
      });
    } catch (err) {
      const problem = toProblem(err);
      if (problem.status >= 500) log.error({ err }, "sync failed");
      return NextResponse.json(problem.body, { status: problem.status });
    }
  });
}
