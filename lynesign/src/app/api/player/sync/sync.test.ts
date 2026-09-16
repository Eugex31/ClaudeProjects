import { describe, it, expect, vi } from "vitest";
import { NextRequest } from "next/server";

import { prisma } from "@/lib/db/root";
import { hashDeviceToken } from "@/lib/pairing";
import { storage, assetStorageKey } from "@/lib/storage";
import { zonedNow } from "@/lib/player/schedule";

vi.stubEnv("APP_ENCRYPTION_KEY", "test-key-please-change");

// This suite needs a live S3 endpoint (local MinIO via `npm run storage:up`).
// When nothing answers on the health endpoint, skip the whole suite with a
// warning instead of failing the run. Mirrors src/lib/storage/s3.test.ts.
const HEALTH = `${process.env.STORAGE_ENDPOINT ?? "http://localhost:9000"}/minio/health/live`;
const minioLive = await fetch(HEALTH)
  .then((r) => r.ok)
  .catch(() => false);

if (!minioLive) {
  console.warn("MinIO not running; run npm run storage:up. Skipping sync suite.");
}

const suite = minioLive ? describe : describe.skip;

async function callSync(token?: string): Promise<Response> {
  const { GET } = await import("@/app/api/player/sync/route");
  const headers: Record<string, string> = {};
  if (token) headers.authorization = `Bearer ${token}`;
  return GET(new NextRequest("http://x/api/player/sync", { headers }));
}

async function makeOrgAndLocation() {
  const org = await prisma.organization.create({
    data: { name: "Sync", slug: `sync-${Date.now()}-${Math.random().toString(36).slice(2)}` },
  });
  const loc = await prisma.location.create({
    data: { organizationId: org.id, name: "L" },
  });
  return { org, loc };
}

suite("GET /api/player/sync", () => {
  it("returns the assembled manifest for the screen's playlist", async () => {
    const { org, loc } = await makeOrgAndLocation();

    const token = `sync-token-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const screen = await prisma.screen.create({
      data: {
        organizationId: org.id,
        locationId: loc.id,
        name: "Lobby",
        status: "ONLINE",
        deviceTokenHash: hashDeviceToken(token),
        pollIntervalSeconds: 45,
      },
    });

    const playlist = await prisma.playlist.create({
      data: {
        organizationId: org.id,
        name: "Main",
        defaultImageDurationSeconds: 12,
        defaultWebDurationSeconds: 20,
      },
    });

    // item A -- READY image with a real object in storage.
    const imageAsset = await prisma.mediaAsset.create({
      data: {
        organizationId: org.id,
        kind: "IMAGE",
        status: "READY",
        name: "poster",
        mimeType: "image/png",
        width: 800,
        height: 600,
      },
    });
    const imageKey = assetStorageKey(org.id, imageAsset.id, ".png");
    await storage.putObject(imageKey, Buffer.from("fake-png-bytes"), "image/png");
    await prisma.mediaAsset.update({
      where: { id: imageAsset.id },
      data: { storageKey: imageKey },
    });

    // item B -- READY video with a real object in storage.
    const videoAsset = await prisma.mediaAsset.create({
      data: {
        organizationId: org.id,
        kind: "VIDEO",
        status: "READY",
        name: "clip",
        mimeType: "video/mp4",
        durationSeconds: 99,
      },
    });
    const videoKey = assetStorageKey(org.id, videoAsset.id, ".mp4");
    await storage.putObject(videoKey, Buffer.from("fake-mp4-bytes"), "video/mp4");
    await prisma.mediaAsset.update({
      where: { id: videoAsset.id },
      data: { storageKey: videoKey },
    });

    // item C -- WEB asset, external url.
    const webAsset = await prisma.mediaAsset.create({
      data: {
        organizationId: org.id,
        kind: "WEB",
        status: "READY",
        name: "dashboard",
        url: "https://example.com",
      },
    });

    // item D -- READY image but the item is disabled.
    const disabledAsset = await prisma.mediaAsset.create({
      data: {
        organizationId: org.id,
        kind: "IMAGE",
        status: "READY",
        name: "hidden",
        storageKey: assetStorageKey(org.id, "disabled-placeholder", ".png"),
      },
    });

    // item E -- enabled item whose asset is archived.
    const archivedAsset = await prisma.mediaAsset.create({
      data: {
        organizationId: org.id,
        kind: "IMAGE",
        status: "READY",
        name: "archived",
        storageKey: assetStorageKey(org.id, "archived-placeholder", ".png"),
        archivedAt: new Date(),
      },
    });

    await prisma.playlistItem.createMany({
      data: [
        {
          organizationId: org.id,
          playlistId: playlist.id,
          mediaAssetId: imageAsset.id,
          position: 0,
          enabled: true,
        },
        {
          organizationId: org.id,
          playlistId: playlist.id,
          mediaAssetId: videoAsset.id,
          position: 1,
          durationSeconds: 30,
          enabled: true,
        },
        {
          organizationId: org.id,
          playlistId: playlist.id,
          mediaAssetId: webAsset.id,
          position: 2,
          enabled: true,
        },
        {
          organizationId: org.id,
          playlistId: playlist.id,
          mediaAssetId: disabledAsset.id,
          position: 3,
          enabled: false,
        },
        {
          organizationId: org.id,
          playlistId: playlist.id,
          mediaAssetId: archivedAsset.id,
          position: 4,
          enabled: true,
        },
      ],
    });

    await prisma.screen.update({
      where: { id: screen.id },
      data: { playlistId: playlist.id },
    });

    const res = await callSync(token);
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.screenId).toBe(screen.id);
    expect(body.pollIntervalSeconds).toBe(45);
    expect(body.source).toBe("playlist");
    expect(body.campaign).toBeNull();
    expect(body.canvas).toBeNull();
    expect("manifest" in body).toBe(false);

    expect(body.playlist.id).toBe(playlist.id);
    expect(body.playlist.name).toBe("Main");
    const row = await prisma.playlist.findUnique({ where: { id: playlist.id } });
    expect(body.playlist.revision).toBe(row?.revision);
    expect("canvas" in body.playlist).toBe(false);

    const items = body.playlist.items;
    expect(items).toHaveLength(3);
    expect(items.map((i: { kind: string }) => i.kind)).toEqual(["IMAGE", "VIDEO", "WEB"]);

    const [a, b, c] = items;
    expect(a.url.startsWith("http://localhost:9000/")).toBe(true);
    expect(a.url).toContain("X-Amz-");
    expect(a.durationSeconds).toBe(12); // playlist image default
    expect(b.url.startsWith("http://localhost:9000/")).toBe(true);
    expect(b.url).toContain("X-Amz-");
    expect(b.durationSeconds).toBe(30); // item override
    expect(c.url).toBe("https://example.com");
    expect(c.durationSeconds).toBe(20); // playlist web default
  });

  it("returns playlist: null when the screen has no playlist assigned", async () => {
    const { org, loc } = await makeOrgAndLocation();
    const token = `sync-none-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const screen = await prisma.screen.create({
      data: {
        organizationId: org.id,
        locationId: loc.id,
        name: "Bare",
        status: "ONLINE",
        deviceTokenHash: hashDeviceToken(token),
      },
    });

    const res = await callSync(token);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.screenId).toBe(screen.id);
    expect(body.source).toBe("none");
    expect(body.campaign).toBeNull();
    expect(body.playlist).toBeNull();
    expect(body.canvas).toBeNull();
    expect("manifest" in body).toBe(false);
  });

  it("rejects a request with no Authorization header with 401", async () => {
    const res = await callSync();
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toHaveProperty("title");
  });

  it("rejects an unknown bearer token with 401", async () => {
    const res = await callSync("not-a-real-token");
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toHaveProperty("title");
  });
});

async function makePlaylistWithImage(orgId: string, name: string, assetName: string) {
  const playlist = await prisma.playlist.create({
    data: {
      organizationId: orgId,
      name,
      defaultImageDurationSeconds: 10,
      defaultWebDurationSeconds: 15,
    },
  });
  const asset = await prisma.mediaAsset.create({
    data: {
      organizationId: orgId,
      kind: "IMAGE",
      status: "READY",
      name: assetName,
      mimeType: "image/png",
      width: 640,
      height: 480,
    },
  });
  const key = assetStorageKey(orgId, asset.id, ".png");
  await storage.putObject(key, Buffer.from(`bytes-${assetName}`), "image/png");
  await prisma.mediaAsset.update({ where: { id: asset.id }, data: { storageKey: key } });
  await prisma.playlistItem.create({
    data: {
      organizationId: orgId,
      playlistId: playlist.id,
      mediaAssetId: asset.id,
      position: 0,
      enabled: true,
    },
  });
  return { ...playlist, assetName };
}

async function makeCampaignScenario() {
  const { org, loc } = await makeOrgAndLocation();
  const token = `sync-camp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const screen = await prisma.screen.create({
    data: {
      organizationId: org.id,
      locationId: loc.id,
      name: "Lobby",
      status: "ONLINE",
      deviceTokenHash: hashDeviceToken(token),
      pollIntervalSeconds: 30,
    },
  });
  const basePlaylist = await makePlaylistWithImage(org.id, "Base", "base-poster");
  const campaignPlaylist = await makePlaylistWithImage(org.id, "Campaign", "camp-poster");
  await prisma.screen.update({
    where: { id: screen.id },
    data: { playlistId: basePlaylist.id },
  });
  return { org, loc, token, screen, basePlaylist, campaignPlaylist };
}

const HOUR = 3_600_000;
const DAY = 86_400_000;

suite("GET /api/player/sync -- campaigns", () => {
  it("serves an active campaign's playlist over the base playlist", async () => {
    const { token, screen, campaignPlaylist } = await makeCampaignScenario();
    const endsAt = new Date(Date.now() + DAY);
    const campaign = await prisma.campaign.create({
      data: {
        organizationId: screen.organizationId,
        name: "Holiday",
        playlistId: campaignPlaylist.id,
        startsAt: new Date(Date.now() - HOUR),
        endsAt,
        enabled: true,
        screens: {
          create: { organizationId: screen.organizationId, screenId: screen.id },
        },
      },
    });

    const res = await callSync(token);
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.source).toBe("campaign");
    expect(body.campaign.id).toBe(campaign.id);
    expect(body.campaign.name).toBe("Holiday");
    const row = await prisma.campaign.findUnique({ where: { id: campaign.id } });
    expect(body.campaign.revision).toBe(row?.revision);
    expect(typeof body.campaign.endsAt).toBe("string");
    expect(body.campaign.endsAt).toBe(endsAt.toISOString());

    expect(body.playlist.id).toBe(campaignPlaylist.id);
    expect(body.playlist.items).toHaveLength(1);
    expect(body.playlist.items[0].kind).toBe("IMAGE");

    expect(body.canvas).toBeNull();
    expect("manifest" in body).toBe(false);
  });

  it("resolves a campaign that targets the screen's location", async () => {
    const { token, loc, screen, campaignPlaylist } = await makeCampaignScenario();
    const campaign = await prisma.campaign.create({
      data: {
        organizationId: screen.organizationId,
        name: "LocationWide",
        playlistId: campaignPlaylist.id,
        startsAt: new Date(Date.now() - HOUR),
        endsAt: new Date(Date.now() + DAY),
        enabled: true,
        locations: {
          create: { organizationId: screen.organizationId, locationId: loc.id },
        },
      },
    });

    const res = await callSync(token);
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.source).toBe("campaign");
    expect(body.campaign.id).toBe(campaign.id);
    expect(body.playlist.id).toBe(campaignPlaylist.id);
    expect(body.canvas).toBeNull();
    expect("manifest" in body).toBe(false);
  });

  it("picks the higher-priority campaign when several are active", async () => {
    const { token, screen, org, campaignPlaylist } = await makeCampaignScenario();
    const hiPlaylist = await makePlaylistWithImage(org.id, "Hi", "hi-poster");

    await prisma.campaign.create({
      data: {
        organizationId: screen.organizationId,
        name: "Low",
        playlistId: campaignPlaylist.id,
        priority: 1,
        startsAt: new Date(Date.now() - HOUR),
        endsAt: new Date(Date.now() + DAY),
        enabled: true,
        screens: {
          create: { organizationId: screen.organizationId, screenId: screen.id },
        },
      },
    });
    await prisma.campaign.create({
      data: {
        organizationId: screen.organizationId,
        name: "High",
        playlistId: hiPlaylist.id,
        priority: 5,
        startsAt: new Date(Date.now() - HOUR),
        endsAt: new Date(Date.now() + DAY),
        enabled: true,
        screens: {
          create: { organizationId: screen.organizationId, screenId: screen.id },
        },
      },
    });

    const res = await callSync(token);
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.source).toBe("campaign");
    expect(body.campaign.name).toBe("High");
    expect(body.playlist.id).toBe(hiPlaylist.id);
    expect(body.canvas).toBeNull();
    expect("manifest" in body).toBe(false);
  });

  it("ignores a campaign whose window has ended", async () => {
    const { token, screen, basePlaylist, campaignPlaylist } = await makeCampaignScenario();
    await prisma.campaign.create({
      data: {
        organizationId: screen.organizationId,
        name: "Expired",
        playlistId: campaignPlaylist.id,
        startsAt: new Date(Date.now() - 2 * DAY),
        endsAt: new Date(Date.now() - DAY),
        enabled: true,
        screens: {
          create: { organizationId: screen.organizationId, screenId: screen.id },
        },
      },
    });

    const res = await callSync(token);
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.source).toBe("playlist");
    expect(body.campaign).toBeNull();
    expect(body.playlist.id).toBe(basePlaylist.id);
    expect(body.canvas).toBeNull();
    expect("manifest" in body).toBe(false);
  });

  it("returns source none when the screen has no playlist and no campaign", async () => {
    const { org, loc } = await makeOrgAndLocation();
    const token = `sync-camp-none-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const screen = await prisma.screen.create({
      data: {
        organizationId: org.id,
        locationId: loc.id,
        name: "Bare",
        status: "ONLINE",
        deviceTokenHash: hashDeviceToken(token),
      },
    });

    const res = await callSync(token);
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.screenId).toBe(screen.id);
    expect(body.source).toBe("none");
    expect(body.playlist).toBeNull();
    expect(body.campaign).toBeNull();
    expect(body.canvas).toBeNull();
    expect("manifest" in body).toBe(false);
  });
});

async function makeScheduleScenario(timeZone?: string) {
  const org = await prisma.organization.create({
    data: {
      name: "Sync",
      slug: `sync-sched-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    },
  });
  const loc = await prisma.location.create({
    data: {
      organizationId: org.id,
      name: "L",
      ...(timeZone ? { timeZone } : {}),
    },
  });
  const token = `sync-sched-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const screen = await prisma.screen.create({
    data: {
      organizationId: org.id,
      locationId: loc.id,
      name: "Lobby",
      status: "ONLINE",
      deviceTokenHash: hashDeviceToken(token),
      pollIntervalSeconds: 30,
    },
  });
  const basePlaylist = await makePlaylistWithImage(org.id, "Base", `base-${Math.random().toString(36).slice(2)}`);
  const rulePlaylist = await makePlaylistWithImage(org.id, "Rule", `rule-${Math.random().toString(36).slice(2)}`);
  const campaignPlaylist = await makePlaylistWithImage(org.id, "Camp", `camp-${Math.random().toString(36).slice(2)}`);
  await prisma.screen.update({
    where: { id: screen.id },
    data: { playlistId: basePlaylist.id },
  });
  return { org, loc, token, screen, basePlaylist, rulePlaylist, campaignPlaylist };
}

// A day/minute window that contains the real current time in `tz`, so a seeded
// rule is in-window without the route accepting an injectable `now`.
function inWindow(tz: string) {
  const { weekday, minute } = zonedNow(new Date(), tz);
  return {
    daysOfWeek: [weekday],
    startMinute: Math.max(0, minute - 60),
    endMinute: Math.min(1440, minute + 60),
  };
}

// A weekday that is never today, so a seeded rule is guaranteed out of window.
function otherDay(tz: string) {
  const { weekday } = zonedNow(new Date(), tz);
  return { daysOfWeek: [(weekday + 3) % 7], startMinute: 0, endMinute: 1440 };
}

suite("GET /api/player/sync -- schedule rules", () => {
  it("serves a matching rule's playlist over the base playlist", async () => {
    const { token, screen, rulePlaylist } = await makeScheduleScenario();
    const rule = await prisma.scheduleRule.create({
      data: {
        organizationId: screen.organizationId,
        name: "Morning",
        playlistId: rulePlaylist.id,
        ...inWindow("UTC"),
        screens: {
          create: { organizationId: screen.organizationId, screenId: screen.id },
        },
      },
    });

    const res = await callSync(token);
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.source).toBe("schedule");
    expect(body.schedule.id).toBe(rule.id);
    expect(body.schedule.name).toBe("Morning");
    expect(body.schedule.campaignId).toBeNull();
    expect(body.campaign).toBeNull();
    expect(body.playlist.id).toBe(rulePlaylist.id);
    expect(body.playlist.items).toHaveLength(1);
    expect(body.playlist.items[0].kind).toBe("IMAGE");
  });

  it("picks the lowest-id rule and logs a tiebreak when two enabled rules both match one screen", async () => {
    const { token, screen, org, rulePlaylist } = await makeScheduleScenario();
    const otherPlaylist = await makePlaylistWithImage(
      org.id,
      "Rule2",
      `rule2-${Math.random().toString(36).slice(2)}`,
    );
    const win = inWindow("UTC");

    const ruleA = await prisma.scheduleRule.create({
      data: {
        organizationId: screen.organizationId,
        name: "First",
        playlistId: rulePlaylist.id,
        ...win,
        screens: {
          create: { organizationId: screen.organizationId, screenId: screen.id },
        },
      },
    });
    const ruleB = await prisma.scheduleRule.create({
      data: {
        organizationId: screen.organizationId,
        name: "Second",
        playlistId: otherPlaylist.id,
        ...win,
        screens: {
          create: { organizationId: screen.organizationId, screenId: screen.id },
        },
      },
    });

    const res = await callSync(token);
    expect(res.status).toBe(200);
    const body = await res.json();

    const lowestId = ruleA.id < ruleB.id ? ruleA.id : ruleB.id;
    const lowestPlaylistId =
      lowestId === ruleA.id ? rulePlaylist.id : otherPlaylist.id;

    expect(body.source).toBe("schedule");
    expect(body.schedule.id).toBe(lowestId);
    expect(body.playlist.id).toBe(lowestPlaylistId);
  });

  it("falls back to the base playlist when the rule is out of window", async () => {
    const { token, screen, basePlaylist, rulePlaylist } = await makeScheduleScenario();
    await prisma.scheduleRule.create({
      data: {
        organizationId: screen.organizationId,
        name: "Overnight",
        playlistId: rulePlaylist.id,
        ...otherDay("UTC"),
        screens: {
          create: { organizationId: screen.organizationId, screenId: screen.id },
        },
      },
    });

    const res = await callSync(token);
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.source).toBe("playlist");
    expect(body.schedule).toBeNull();
    expect(body.playlist.id).toBe(basePlaylist.id);
  });

  it("lets an active campaign win over an in-window rule", async () => {
    const { token, screen, rulePlaylist, campaignPlaylist } = await makeScheduleScenario();
    await prisma.scheduleRule.create({
      data: {
        organizationId: screen.organizationId,
        name: "Daytime",
        playlistId: rulePlaylist.id,
        ...inWindow("UTC"),
        screens: {
          create: { organizationId: screen.organizationId, screenId: screen.id },
        },
      },
    });
    const campaign = await prisma.campaign.create({
      data: {
        organizationId: screen.organizationId,
        name: "Holiday",
        playlistId: campaignPlaylist.id,
        startsAt: new Date(Date.now() - HOUR),
        endsAt: new Date(Date.now() + DAY),
        enabled: true,
        screens: {
          create: { organizationId: screen.organizationId, screenId: screen.id },
        },
      },
    });

    const res = await callSync(token);
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.source).toBe("campaign");
    expect(body.campaign.id).toBe(campaign.id);
    expect(body.schedule).toBeNull();
    expect(body.playlist.id).toBe(campaignPlaylist.id);
  });

  it("serves the campaign playlist for a rule that points at a campaign", async () => {
    const { token, screen, campaignPlaylist } = await makeScheduleScenario();
    // A campaign the rule references but that targets nothing directly, so it is
    // never a higher-priority direct campaign match.
    const campaign = await prisma.campaign.create({
      data: {
        organizationId: screen.organizationId,
        name: "Referenced",
        playlistId: campaignPlaylist.id,
        startsAt: new Date(Date.now() - HOUR),
        endsAt: new Date(Date.now() + DAY),
        enabled: true,
      },
    });
    const rule = await prisma.scheduleRule.create({
      data: {
        organizationId: screen.organizationId,
        name: "CampaignWindow",
        campaignId: campaign.id,
        ...inWindow("UTC"),
        screens: {
          create: { organizationId: screen.organizationId, screenId: screen.id },
        },
      },
    });

    const res = await callSync(token);
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.source).toBe("schedule");
    expect(body.schedule.id).toBe(rule.id);
    expect(body.schedule.campaignId).toBe(campaign.id);
    expect(body.campaign.id).toBe(campaign.id);
    expect(body.campaign.name).toBe("Referenced");
    expect(body.playlist.id).toBe(campaignPlaylist.id);
  });

  it("returns 200 and skips the schedule tier when the location time zone is bogus", async () => {
    const { token, basePlaylist } = await makeScheduleScenario("Not/AZone");

    const res = await callSync(token);
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(["playlist", "none"]).toContain(body.source);
    expect(body.source).toBe("playlist");
    expect(body.schedule).toBeNull();
    expect(body.playlist.id).toBe(basePlaylist.id);
  });
});

async function makeReadyImageAsset(orgId: string, name: string) {
  const asset = await prisma.mediaAsset.create({
    data: {
      organizationId: orgId,
      kind: "IMAGE",
      status: "READY",
      name,
      mimeType: "image/png",
      width: 800,
      height: 600,
    },
  });
  const key = assetStorageKey(orgId, asset.id, ".png");
  await storage.putObject(key, Buffer.from(`bytes-${name}`), "image/png");
  await prisma.mediaAsset.update({ where: { id: asset.id }, data: { storageKey: key } });
  return asset;
}

// One canvas with a single panel whose only frame is a ready IMAGE picture, so
// the assembled manifest has exactly one renderable panel.
async function seedCanvasWithImagePanel(orgId: string, name: string) {
  const asset = await makeReadyImageAsset(orgId, `${name}-poster`);
  const canvas = await prisma.canvas.create({
    data: { organizationId: orgId, name, width: 1920, height: 1080, revision: 2 },
  });
  const panel = await prisma.panel.create({
    data: {
      organizationId: orgId,
      canvasId: canvas.id,
      x: 0,
      y: 0,
      width: 960,
      height: 540,
      zIndex: 0,
    },
  });
  const frame = await prisma.frame.create({
    data: {
      organizationId: orgId,
      panelId: panel.id,
      type: "PICTURE",
      sortOrder: 0,
      durationSeconds: 12,
    },
  });
  await prisma.content.create({
    data: {
      organizationId: orgId,
      frameId: frame.id,
      picture: { create: { organizationId: orgId, mode: "fill", mediaAssetId: asset.id } },
    },
  });
  return { canvas, panel, frame, asset };
}

async function makeCanvasScenario() {
  const { org, loc } = await makeOrgAndLocation();
  const token = `sync-canvas-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const screen = await prisma.screen.create({
    data: {
      organizationId: org.id,
      locationId: loc.id,
      name: "Lobby",
      status: "ONLINE",
      deviceTokenHash: hashDeviceToken(token),
      pollIntervalSeconds: 30,
    },
  });
  return { org, loc, token, screen };
}

suite("GET /api/player/sync -- canvas", () => {
  it("serves the assembled canvas manifest for a canvas-mode screen", async () => {
    const { org, token, screen } = await makeCanvasScenario();
    const { canvas, panel } = await seedCanvasWithImagePanel(org.id, "Lobby");
    await prisma.screen.update({
      where: { id: screen.id },
      data: { canvasId: canvas.id },
    });

    const res = await callSync(token);
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.source).toBe("canvas");
    expect(body.campaign).toBeNull();
    expect(body.schedule).toBeNull();
    expect(body.playlist).toBeNull();

    expect(body.canvas).not.toBeNull();
    expect(typeof body.canvas).toBe("object");
    expect(body.canvas.id).toBe(canvas.id);
    expect(body.canvas.revision).toBe(2);
    expect(body.canvas.panels).toHaveLength(1);
    expect(body.canvas.panels[0].id).toBe(panel.id);
    expect(body.canvas.panels[0].frames[0].kind).toBe("image");
    expect(body.canvas.panels[0].frames[0].image.url).toContain(
      process.env.STORAGE_ENDPOINT ?? "http://localhost:9000",
    );
  });

  it("lets an active campaign win over a canvas-mode screen", async () => {
    const { org, token, screen } = await makeCanvasScenario();
    const { canvas } = await seedCanvasWithImagePanel(org.id, "Lobby");
    await prisma.screen.update({
      where: { id: screen.id },
      data: { canvasId: canvas.id },
    });

    const campaignPlaylist = await makePlaylistWithImage(
      org.id,
      "Campaign",
      `camp-${Math.random().toString(36).slice(2)}`,
    );
    const campaign = await prisma.campaign.create({
      data: {
        organizationId: org.id,
        name: "Holiday",
        playlistId: campaignPlaylist.id,
        startsAt: new Date(Date.now() - HOUR),
        endsAt: new Date(Date.now() + DAY),
        enabled: true,
        screens: {
          create: { organizationId: org.id, screenId: screen.id },
        },
      },
    });

    const res = await callSync(token);
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.source).toBe("campaign");
    expect(body.campaign.id).toBe(campaign.id);
    expect(body.canvas).toBeNull();
    expect(body.playlist.id).toBe(campaignPlaylist.id);
  });

  it("falls through to the base playlist when the canvas is not in the screen's organization", async () => {
    const { org, token, screen } = await makeCanvasScenario();
    const basePlaylist = await makePlaylistWithImage(
      org.id,
      "Base",
      `base-${Math.random().toString(36).slice(2)}`,
    );
    await prisma.screen.update({
      where: { id: screen.id },
      data: { playlistId: basePlaylist.id },
    });

    // A canvas owned by a different organization: the foreign key is satisfied,
    // but the org-scoped load in the sync route must not see it, so the canvas
    // tier yields nothing and the base playlist is served.
    const { org: otherOrg } = await makeOrgAndLocation();
    const { canvas: foreignCanvas } = await seedCanvasWithImagePanel(otherOrg.id, "Foreign");
    await prisma.screen.update({
      where: { id: screen.id },
      data: { canvasId: foreignCanvas.id },
    });

    const res = await callSync(token);
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.source).toBe("playlist");
    expect(body.canvas).toBeNull();
    expect(body.playlist.id).toBe(basePlaylist.id);
  });

  it("falls through to the base playlist when the screen's canvas is archived", async () => {
    const { org, token, screen } = await makeCanvasScenario();
    const basePlaylist = await makePlaylistWithImage(
      org.id,
      "Base",
      `arch-${Math.random().toString(36).slice(2)}`,
    );
    const { canvas } = await seedCanvasWithImagePanel(org.id, "Archived");
    await prisma.screen.update({
      where: { id: screen.id },
      data: { canvasId: canvas.id, playlistId: basePlaylist.id },
    });
    // Archived straight through the root client: the point is that the serving
    // path filters it, not that some action set the column.
    await prisma.canvas.update({
      where: { id: canvas.id },
      data: { archivedAt: new Date() },
    });

    const res = await callSync(token);
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.source).not.toBe("canvas");
    expect(body.source).toBe("playlist");
    expect(body.canvas).toBeNull();
    expect(body.playlist.id).toBe(basePlaylist.id);
  });

  it("excludes a panel row whose organizationId does not match the screen's org", async () => {
    const { org, token, screen } = await makeCanvasScenario();
    const { canvas, panel } = await seedCanvasWithImagePanel(org.id, "Mixed");
    await prisma.screen.update({
      where: { id: screen.id },
      data: { canvasId: canvas.id },
    });

    // Panel.organizationId carries no foreign key back to the canvas's org, so a
    // mis-owned row is insertable. Without the `where: { organizationId }` on the
    // nested panels include it would ride along in the manifest, because the
    // sync path uses the unscoped root client and there is no RLS session here.
    const { org: otherOrg } = await makeOrgAndLocation();
    const foreignPanel = await prisma.panel.create({
      data: {
        organizationId: otherOrg.id,
        canvasId: canvas.id,
        x: 0,
        y: 540,
        width: 960,
        height: 540,
        zIndex: 5,
      },
    });
    const foreignAsset = await makeReadyImageAsset(otherOrg.id, "Mixed-foreign");
    const foreignFrame = await prisma.frame.create({
      data: {
        organizationId: otherOrg.id,
        panelId: foreignPanel.id,
        type: "PICTURE",
        sortOrder: 0,
        durationSeconds: 12,
      },
    });
    await prisma.content.create({
      data: {
        organizationId: otherOrg.id,
        frameId: foreignFrame.id,
        picture: {
          create: {
            organizationId: otherOrg.id,
            mode: "fill",
            mediaAssetId: foreignAsset.id,
          },
        },
      },
    });

    const res = await callSync(token);
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.source).toBe("canvas");
    expect(body.canvas.panels).toHaveLength(1);
    expect(body.canvas.panels[0].id).toBe(panel.id);
    expect(
      body.canvas.panels.some(
        (p: { id: string }) => p.id === foreignPanel.id,
      ),
    ).toBe(false);
  });

  it("carries canvas null on the source none early return", async () => {
    const { token, screen } = await makeCanvasScenario();

    const res = await callSync(token);
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.screenId).toBe(screen.id);
    expect(body.source).toBe("none");
    expect(body.playlist).toBeNull();
    expect(body.campaign).toBeNull();
    expect(body.schedule).toBeNull();
    expect(body.canvas).toBeNull();
  });
});
