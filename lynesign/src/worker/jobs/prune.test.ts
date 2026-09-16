import { describe, it, expect, beforeEach } from "vitest";

import { prisma } from "@/lib/db/root";
import { resetDb, seedPlans } from "@/test/helpers/db";
import { prunePlaybackEvents } from "@/worker/jobs/prunePlaybackEvents";

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-09-02T00:00:00.000Z");

async function seedOrg(prefix: string) {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const org = await prisma.organization.create({
    data: { name: prefix, slug: `${prefix}-${suffix}` },
  });
  const location = await prisma.location.create({
    data: { organizationId: org.id, name: "Location" },
  });
  const screen = await prisma.screen.create({
    data: { organizationId: org.id, locationId: location.id, name: "Screen" },
  });
  return { org, location, screen, suffix };
}

async function makeEvent(
  id: string,
  organizationId: string,
  screenId: string,
  airedAt: Date,
) {
  return prisma.playbackEvent.create({
    data: { id, organizationId, screenId, source: "playlist", airedAt, durationSeconds: 10 },
  });
}

describe("prunePlaybackEvents", () => {
  beforeEach(async () => {
    await resetDb();
    await seedPlans();
  });

  it("deletes only rows older than the 90 day cutoff and is idempotent", async () => {
    const { org, screen, suffix } = await seedOrg("prune");
    const old = await makeEvent(
      `${suffix}-old`,
      org.id,
      screen.id,
      new Date(NOW.getTime() - 100 * DAY_MS),
    );
    const nearEdge = await makeEvent(
      `${suffix}-near`,
      org.id,
      screen.id,
      new Date(NOW.getTime() - 89 * DAY_MS),
    );
    const recent = await makeEvent(
      `${suffix}-recent`,
      org.id,
      screen.id,
      new Date(NOW.getTime() - 10 * DAY_MS),
    );

    expect(await prunePlaybackEvents(NOW)).toEqual({ pruned: 1 });

    const remaining = (await prisma.playbackEvent.findMany({ select: { id: true } }))
      .map((r) => r.id)
      .sort();
    expect(remaining).toEqual([nearEdge.id, recent.id].sort());
    expect(await prisma.playbackEvent.findFirst({ where: { id: old.id } })).toBeNull();

    expect(await prunePlaybackEvents(NOW)).toEqual({ pruned: 0 });
  });

  it("drains a backlog larger than one batch across iterations", async () => {
    const { org, screen, suffix } = await seedOrg("prune-batch");
    const oldAt = new Date(NOW.getTime() - 100 * DAY_MS);
    await prisma.playbackEvent.createMany({
      data: Array.from({ length: 12 }, (_, i) => ({
        id: `${suffix}-b${i}`,
        organizationId: org.id,
        screenId: screen.id,
        source: "playlist",
        airedAt: oldAt,
        durationSeconds: 10,
      })),
    });

    // A batch size of 5 forces three passes (5 + 5 + 2) to clear all 12 rows.
    expect(await prunePlaybackEvents(NOW, 5)).toEqual({ pruned: 12 });
    expect(await prisma.playbackEvent.count()).toBe(0);
    expect(await prunePlaybackEvents(NOW, 5)).toEqual({ pruned: 0 });
  });

  it("prunes old rows across every org in one unscoped pass", async () => {
    const a = await seedOrg("prune-a");
    const b = await seedOrg("prune-b");
    await makeEvent(
      `${a.suffix}-a-old`,
      a.org.id,
      a.screen.id,
      new Date(NOW.getTime() - 100 * DAY_MS),
    );
    await makeEvent(
      `${b.suffix}-b-old`,
      b.org.id,
      b.screen.id,
      new Date(NOW.getTime() - 100 * DAY_MS),
    );

    expect(await prunePlaybackEvents(NOW)).toEqual({ pruned: 2 });
    expect(await prisma.playbackEvent.count()).toBe(0);
  });
});
