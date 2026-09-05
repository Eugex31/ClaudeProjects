/**
 * One-off: give "Costa Signage Co" a month of synthetic proof-of-play so the
 * /analytics page, its summary tiles, the plays-by-day chart, and both
 * proof-of-play tables have real numbers to render.
 *
 * For every paired, online screen in the org, for each of the last 30 days:
 *
 *   - resolve the screen's effective content for that day with the real
 *     `resolveScreenContent` (the same campaign and schedule tiers the player
 *     sync route runs) plus the base `Screen.playlistId`,
 *   - take that playlist's ready, enabled items,
 *   - synthesize loop iterations for roughly ten active hours (08:00 to 18:00
 *     UTC), emitting one `PlaybackEvent` per item per iteration.
 *
 * Each event id is the deterministic string `${screenId}:${dayIndex}:${iter}:${itemIndex}`,
 * so a re-run inserts nothing new: `createMany({ skipDuplicates: true })` drops
 * every id that is already stored. Rows are written in chunks of 1000 inside one
 * `withOrgTransaction` with a raised timeout.
 *
 * Simplification: content is resolved once per screen per day, at a
 * representative mid-window instant, rather than per airing. For this demo data
 * that is equivalent, because the seeded schedule rule that covers working hours
 * spans the whole 08:00 to 18:00 window, so no airing in a day would resolve to
 * a different source than its noon sample. The spread across `source` values
 * ("playlist", "schedule", "campaign") still comes out plausible: weekdays in a
 * rule window report "schedule", the days a campaign is live for a targeted
 * location report "campaign", everything else reports "playlist".
 *
 * The total row count is capped near 20000. The plan is sliced per screen-day so
 * the coverage stays spread across every screen and every day rather than
 * filling up on the first few.
 *
 * Re-run safe: exits if the org already has a PlaybackEvent unless --force is
 * passed. Because the ids are deterministic, --force still adds close to zero.
 *
 *   npm run db:up
 *   npx tsx scripts/simulate-analytics.ts [--force]
 */
import { prisma } from "@/lib/db/root";
import { withOrgTransaction } from "@/lib/db/tenant";
import { resolveScreenContent } from "@/lib/player/campaign";
import { zonedNow, scheduleRuleMatches } from "@/lib/player/schedule";

const ORG_NAME = "Costa Signage Co";
const FORCE = process.argv.includes("--force");

const DAYS = 30;
const ACTIVE_SECONDS = 10 * 3600; // ten active hours per day
const WINDOW_START_HOUR = 8; // 08:00 UTC
const MAX_ROWS = 20_000;
const CHUNK = 1000;
const DAY_MS = 86_400_000;

type PlaybackRow = {
  id: string;
  organizationId: string;
  screenId: string;
  mediaAssetId: string | null;
  playlistId: string | null;
  source: string;
  campaignId: string | null;
  scheduleRuleId: string | null;
  airedAt: Date;
  durationSeconds: number;
};

/** Start-of-UTC-day for a millisecond timestamp. */
function startOfUtcDay(ms: number): number {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/** Deterministic FNV-1a hash of a string, used to seed the duration jitter. */
function hashStr(s: string): number {
  let h = 2_166_136_261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16_777_619);
  }
  return h >>> 0;
}

async function main() {
  const org = await prisma.organization.findFirst({ where: { name: ORG_NAME } });
  if (!org) {
    throw new Error(
      `No organization named "${ORG_NAME}". Register it first at /register.`,
    );
  }

  const existing = await prisma.playbackEvent.count({
    where: { organizationId: org.id },
  });
  if (existing > 0 && !FORCE) {
    console.log(
      `Org already has ${existing} playback events. Pass --force to synthesize another span.`,
    );
    return;
  }

  const screens = await prisma.screen.findMany({
    where: { organizationId: org.id, status: "ONLINE" },
    orderBy: { name: "asc" },
    select: { id: true, name: true, locationId: true, playlistId: true },
  });
  if (screens.length === 0) {
    throw new Error(
      "No paired, online screens in the org. Run scripts/simulate-refresh.ts first.",
    );
  }

  const locationTz = new Map(
    (
      await prisma.location.findMany({
        where: { organizationId: org.id },
        select: { id: true, timeZone: true },
      })
    ).map((l) => [l.id, l.timeZone || "UTC"]),
  );

  const campaignRows = await prisma.campaign.findMany({
    where: { organizationId: org.id },
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
  const campaigns = campaignRows.map((c) => ({
    id: c.id,
    name: c.name,
    revision: c.revision,
    playlistId: c.playlistId,
    priority: c.priority,
    startsAt: c.startsAt,
    endsAt: c.endsAt,
    enabled: c.enabled,
    archivedAt: c.archivedAt,
    screenIds: c.screens.map((s) => s.screenId),
    locationIds: c.locations.map((l) => l.locationId),
  }));
  const campaignById = new Map(campaignRows.map((c) => [c.id, c]));

  const ruleRows = await prisma.scheduleRule.findMany({
    where: { organizationId: org.id, enabled: true, archivedAt: null },
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
      screens: { select: { screenId: true } },
      locations: { select: { locationId: true } },
    },
  });

  const playlists = await prisma.playlist.findMany({
    where: { organizationId: org.id, archivedAt: null },
    select: {
      id: true,
      defaultImageDurationSeconds: true,
      defaultWebDurationSeconds: true,
      items: {
        where: {
          enabled: true,
          mediaAsset: { status: "READY", archivedAt: null },
        },
        orderBy: { position: "asc" },
        select: {
          mediaAssetId: true,
          durationSeconds: true,
          mediaAsset: { select: { kind: true, durationSeconds: true } },
        },
      },
    },
  });
  const playlistById = new Map(playlists.map((p) => [p.id, p]));

  type PlaylistShape = (typeof playlists)[number];
  type ItemShape = PlaylistShape["items"][number];

  const effDur = (item: ItemShape, playlist: PlaylistShape): number => {
    const fallback =
      item.mediaAsset.kind === "IMAGE"
        ? playlist.defaultImageDurationSeconds
        : item.mediaAsset.kind === "VIDEO"
          ? item.mediaAsset.durationSeconds ?? playlist.defaultWebDurationSeconds
          : playlist.defaultWebDurationSeconds;
    return Math.max(1, item.durationSeconds ?? fallback);
  };

  const slots = screens.length * DAYS;
  const perSlotBudget = Math.max(1, Math.floor(MAX_ROWS / slots));

  const todayMidnight = startOfUtcDay(Date.now());
  const rows: PlaybackRow[] = [];
  const coveredScreens = new Set<string>();
  const bySource: Record<string, number> = {};
  let minAired = Infinity;
  let maxAired = -Infinity;
  let totalDurationSeconds = 0;

  outer: for (let dayIndex = 0; dayIndex < DAYS; dayIndex++) {
    const dayStart = todayMidnight - (DAYS - 1 - dayIndex) * DAY_MS;
    const windowStartMs = dayStart + WINDOW_START_HOUR * 3_600_000;
    const sampleAt = new Date(windowStartMs + (ACTIVE_SECONDS / 2) * 1000);

    for (const screen of screens) {
      // --- Schedule tier: mirror GET /api/player/sync, once for the day -----
      let scheduleInput: Parameters<
        typeof resolveScreenContent
      >[0]["schedule"] = null;
      const tz = locationTz.get(screen.locationId) || "UTC";
      try {
        const zoned = zonedNow(sampleAt, tz);
        const matched = ruleRows
          .filter(
            (r) =>
              r.screens.some((s) => s.screenId === screen.id) ||
              r.locations.some((l) => l.locationId === screen.locationId),
          )
          .filter((r) =>
            scheduleRuleMatches(
              {
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
              },
              zoned,
            ),
          )
          .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

        const rule = matched[0];
        if (rule) {
          let effectivePlaylistId: string | null = rule.playlistId;
          let campaignForRule: {
            id: string;
            name: string;
            revision: number;
          } | null = null;
          if (rule.campaignId) {
            const camp = campaignById.get(rule.campaignId);
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
        if (!(err instanceof RangeError)) throw err;
        scheduleInput = null;
      }

      const resolved = resolveScreenContent({
        screen: {
          id: screen.id,
          locationId: screen.locationId,
          playlistId: screen.playlistId,
        },
        now: sampleAt,
        campaigns,
        schedule: scheduleInput,
      });
      if (resolved.source === "none") continue;

      const playlist = playlistById.get(resolved.playlistId);
      if (!playlist || playlist.items.length === 0) continue;

      const items = playlist.items;
      const loopLen = items.reduce((sum, it) => sum + effDur(it, playlist), 0);
      if (loopLen <= 0) continue;
      const iterations = Math.max(1, Math.floor(ACTIVE_SECONDS / loopLen));

      const descriptors: Array<{ iter: number; itemIndex: number }> = [];
      for (let iter = 0; iter < iterations; iter++) {
        for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
          descriptors.push({ iter, itemIndex });
        }
      }
      const take = Math.min(perSlotBudget, MAX_ROWS - rows.length);
      const sliced = descriptors.slice(0, take);
      if (sliced.length === 0) {
        if (rows.length >= MAX_ROWS) break outer;
        continue;
      }

      const step = ACTIVE_SECONDS / sliced.length;
      const campaignId =
        resolved.source === "campaign"
          ? resolved.campaignId
          : resolved.source === "schedule"
            ? resolved.campaignId
            : null;
      const scheduleRuleId =
        resolved.source === "schedule" ? resolved.scheduleRuleId : null;

      sliced.forEach((d, ordinal) => {
        const item = items[d.itemIndex];
        const id = `${screen.id}:${dayIndex}:${d.iter}:${d.itemIndex}`;
        const airedAtMs = windowStartMs + Math.floor(ordinal * step * 1000);
        const jit = (hashStr(id) % 5) - 2; // -2 .. 2
        const durationSeconds = Math.min(
          86_400,
          Math.max(0, effDur(item, playlist) + jit),
        );

        rows.push({
          id,
          organizationId: org.id,
          screenId: screen.id,
          mediaAssetId: item.mediaAssetId,
          playlistId: resolved.playlistId,
          source: resolved.source,
          campaignId,
          scheduleRuleId,
          airedAt: new Date(airedAtMs),
          durationSeconds,
        });

        coveredScreens.add(screen.id);
        bySource[resolved.source] = (bySource[resolved.source] ?? 0) + 1;
        totalDurationSeconds += durationSeconds;
        if (airedAtMs < minAired) minAired = airedAtMs;
        if (airedAtMs > maxAired) maxAired = airedAtMs;
      });

      if (rows.length >= MAX_ROWS) break outer;
    }
  }

  let written = 0;
  if (rows.length > 0) {
    await withOrgTransaction(
      org.id,
      async (tx) => {
        for (let i = 0; i < rows.length; i += CHUNK) {
          const res = await tx.playbackEvent.createMany({
            data: rows.slice(i, i + CHUNK),
            skipDuplicates: true,
          });
          written += res.count;
        }
      },
      { timeout: 120_000 },
    );
  }

  const dateSpan =
    rows.length > 0
      ? `${new Date(minAired).toISOString().slice(0, 10)} to ${new Date(maxAired).toISOString().slice(0, 10)}`
      : "none";

  console.log(`\nAnalytics simulation complete for ${ORG_NAME}`);
  console.table({
    eventsPlanned: rows.length,
    eventsWritten: written,
    duplicatesSkipped: rows.length - written,
    screensCovered: coveredScreens.size,
    dateSpan,
    totalPlayHours: (totalDurationSeconds / 3600).toFixed(1),
  });
  console.table(bySource);
  console.log(
    `Online screens: ${screens.map((s) => s.name).join(", ")}`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
