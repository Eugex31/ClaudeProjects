import { describe, it, expect, vi } from "vitest";
import { NextRequest } from "next/server";

import { prisma } from "@/lib/db/root";
import { hashDeviceToken } from "@/lib/pairing";

vi.stubEnv("APP_ENCRYPTION_KEY", "test-key-please-change");

const rand = () => Math.random().toString(36).slice(2);

async function callEvents(token: string | undefined, body: unknown): Promise<Response> {
  const { POST } = await import("@/app/api/player/events/route");
  return POST(
    new NextRequest("http://x/api/player/events", {
      method: "POST",
      headers: token ? { authorization: `Bearer ${token}` } : {},
      body: JSON.stringify(body),
    }),
  );
}

async function seed(token: string) {
  const org = await prisma.organization.create({
    data: { name: "Events", slug: `events-${Date.now()}-${rand()}` },
  });
  const loc = await prisma.location.create({
    data: { organizationId: org.id, name: "L" },
  });
  const screen = await prisma.screen.create({
    data: {
      organizationId: org.id,
      locationId: loc.id,
      name: "Lobby",
      status: "ONLINE",
      deviceTokenHash: hashDeviceToken(token),
    },
  });
  const otherScreen = await prisma.screen.create({
    data: {
      organizationId: org.id,
      locationId: loc.id,
      name: "Back",
      status: "ONLINE",
      deviceTokenHash: hashDeviceToken(`${token}-other-${rand()}`),
    },
  });
  const asset = await prisma.mediaAsset.create({
    data: { organizationId: org.id, kind: "IMAGE", status: "READY", name: "poster" },
  });
  return { org, loc, screen, otherScreen, asset };
}

function event(overrides: Record<string, unknown>) {
  return {
    id: `evt-${rand()}`,
    screenId: "replace-me",
    mediaAssetId: null,
    playlistId: null,
    campaignId: null,
    scheduleRuleId: null,
    source: "playlist",
    airedAt: new Date().toISOString(),
    durationSeconds: 15,
    ...overrides,
  };
}

describe("POST /api/player/events", () => {
  it("accepts a valid 3-event batch and stores scoped rows", async () => {
    const token = `events-${Date.now()}-${rand()}`;
    const { org, screen, asset } = await seed(token);

    const batch = {
      events: [
        event({ screenId: screen.id, mediaAssetId: asset.id }),
        event({ screenId: screen.id, mediaAssetId: asset.id }),
        event({ screenId: screen.id, mediaAssetId: null }),
      ],
    };

    const res = await callEvents(token, batch);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ accepted: 3, duplicates: 0, dropped: 0 });

    const rows = await prisma.playbackEvent.findMany({
      where: { id: { in: batch.events.map((e) => e.id) } },
      orderBy: { id: "asc" },
    });
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row.organizationId).toBe(org.id);
      expect(row.screenId).toBe(screen.id);
    }
    const withAsset = rows.filter((r) => r.mediaAssetId === asset.id);
    expect(withAsset).toHaveLength(2);
    expect(rows.filter((r) => r.mediaAssetId === null)).toHaveLength(1);
  });

  it("is idempotent when the same batch is replayed", async () => {
    const token = `events-${Date.now()}-${rand()}`;
    const { screen, asset } = await seed(token);

    const batch = {
      events: [
        event({ screenId: screen.id, mediaAssetId: asset.id }),
        event({ screenId: screen.id, mediaAssetId: asset.id }),
        event({ screenId: screen.id }),
      ],
    };

    const first = await callEvents(token, batch);
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ accepted: 3, duplicates: 0, dropped: 0 });

    const before = await prisma.playbackEvent.count();
    const replay = await callEvents(token, batch);
    expect(replay.status).toBe(200);
    expect(await replay.json()).toEqual({ accepted: 0, duplicates: 3, dropped: 0 });
    expect(await prisma.playbackEvent.count()).toBe(before);
  });

  it("rejects a batch of more than 500 events with 413", async () => {
    const token = `events-${Date.now()}-${rand()}`;
    const { screen } = await seed(token);

    const batch = {
      events: Array.from({ length: 501 }, () => event({ screenId: screen.id })),
    };

    const before = await prisma.playbackEvent.count();
    const res = await callEvents(token, batch);
    expect(res.status).toBe(413);
    expect(await prisma.playbackEvent.count()).toBe(before);
  });

  it("rejects a batch that names another screen with 400 and writes nothing", async () => {
    const token = `events-${Date.now()}-${rand()}`;
    const { screen, otherScreen } = await seed(token);

    const batch = {
      events: [
        event({ screenId: screen.id }),
        event({ screenId: otherScreen.id }),
        event({ screenId: screen.id }),
      ],
    };

    const before = await prisma.playbackEvent.count();
    const res = await callEvents(token, batch);
    expect(res.status).toBe(400);
    expect(await prisma.playbackEvent.count()).toBe(before);
    const stored = await prisma.playbackEvent.findMany({
      where: { id: { in: batch.events.map((e) => e.id) } },
    });
    expect(stored).toHaveLength(0);
  });

  it("nulls a mediaAssetId that does not resolve in the organization", async () => {
    const token = `events-${Date.now()}-${rand()}`;
    const { screen } = await seed(token);

    const foreignAssetId = `c${rand()}${rand()}${rand()}`.slice(0, 25);
    const batch = {
      events: [event({ screenId: screen.id, mediaAssetId: foreignAssetId })],
    };

    const res = await callEvents(token, batch);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ accepted: 1, duplicates: 0, dropped: 0 });

    const row = await prisma.playbackEvent.findFirst({
      where: { id: batch.events[0].id },
    });
    expect(row?.mediaAssetId).toBeNull();
  });

  it("drops an event outside the ingest window and keeps an in-window one", async () => {
    const token = `events-${Date.now()}-${rand()}`;
    const { screen } = await seed(token);

    const stale = event({
      screenId: screen.id,
      airedAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString(),
    });
    const fresh = event({ screenId: screen.id });
    const batch = { events: [stale, fresh] };

    const res = await callEvents(token, batch);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ accepted: 1, duplicates: 0, dropped: 1 });

    expect(
      await prisma.playbackEvent.findFirst({ where: { id: stale.id } }),
    ).toBeNull();
    expect(
      await prisma.playbackEvent.findFirst({ where: { id: fresh.id } }),
    ).not.toBeNull();
  });

  it("rejects a body whose declared content-length exceeds the cap with 413 and stores nothing", async () => {
    const token = `events-${Date.now()}-${rand()}`;
    const { screen } = await seed(token);
    const before = await prisma.playbackEvent.count();

    const { POST } = await import("@/app/api/player/events/route");
    const res = await POST(
      new NextRequest("http://x/api/player/events", {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-length": String(2 * 1024 * 1024),
        },
        body: JSON.stringify({ events: [event({ screenId: screen.id })] }),
      }),
    );

    expect(res.status).toBe(413);
    expect(await res.json()).toMatchObject({ type: "payload_too_large" });
    expect(await prisma.playbackEvent.count()).toBe(before);
  });

  it("returns all-dropped for a batch entirely outside the ingest window and inserts nothing", async () => {
    const token = `events-${Date.now()}-${rand()}`;
    const { screen } = await seed(token);
    const before = await prisma.playbackEvent.count();

    const stale = () =>
      event({
        screenId: screen.id,
        airedAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
      });
    const batch = { events: [stale(), stale(), stale()] };

    const res = await callEvents(token, batch);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ accepted: 0, duplicates: 0, dropped: 3 });
    expect(await prisma.playbackEvent.count()).toBe(before);
    const stored = await prisma.playbackEvent.findMany({
      where: { id: { in: batch.events.map((e) => e.id) } },
    });
    expect(stored).toHaveLength(0);
  });

  it("counts a duplicate id within a single batch as one insert and one duplicate", async () => {
    const token = `events-${Date.now()}-${rand()}`;
    const { screen } = await seed(token);

    const shared = event({ screenId: screen.id });
    const batch = { events: [shared, { ...shared }] };

    const res = await callEvents(token, batch);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ accepted: 1, duplicates: 1, dropped: 0 });

    const stored = await prisma.playbackEvent.findMany({ where: { id: shared.id } });
    expect(stored).toHaveLength(1);
  });

  it("rejects a request with no Authorization header with 401", async () => {
    const res = await callEvents(undefined, { events: [event({})] });
    expect(res.status).toBe(401);
    expect(await res.json()).toHaveProperty("title");
  });
});
