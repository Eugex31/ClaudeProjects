import { describe, it, expect, vi, beforeEach } from "vitest";

import { prisma } from "@/lib/db/root";
import { forOrg } from "@/lib/db/tenant";
import { storage, assetStorageKey } from "@/lib/storage";
import { UnauthorizedError } from "@/lib/errors";

// The route is gated by `requireRole("screen.view")`. The mock is a spy so a
// single test can make it reject to stand in for a missing session; every other
// test gets the shared `ctx`, pointed at whichever org it just built. Mirrors
// src/app/api/canvas/[id]/preview/preview.test.ts.
const { requireRoleMock } = vi.hoisted(() => ({ requireRoleMock: vi.fn() }));

const ctx: {
  user: { id: string; email: string; isSuperAdmin: boolean };
  organizationId: string;
  role: "MANAGER";
  actor: never;
  db: ReturnType<typeof forOrg>;
} = {
  user: { id: "", email: "", isSuperAdmin: false },
  organizationId: "",
  role: "MANAGER",
  actor: {} as never,
  db: {} as never,
};

vi.mock("@/lib/auth/context", () => ({
  requireRole: requireRoleMock,
  requireOrg: requireRoleMock,
}));

const HEALTH = `${process.env.STORAGE_ENDPOINT ?? "http://localhost:9000"}/minio/health/live`;
const minioLive = await fetch(HEALTH)
  .then((r) => r.ok)
  .catch(() => false);
if (!minioLive) {
  console.warn("MinIO not running; run npm run storage:up. Skipping screen preview suite.");
}
const suite = minioLive ? describe : describe.skip;

beforeEach(() => {
  requireRoleMock.mockReset();
  requireRoleMock.mockImplementation(async () => ctx);
});

async function bindOrg(name: string) {
  const org = await prisma.organization.create({
    data: { name, slug: `${name}-${Date.now()}-${Math.random().toString(36).slice(2)}` },
  });
  const user = await prisma.user.create({
    data: { email: `${Math.random().toString(36).slice(2)}@x.com`, name: "U" },
  });
  const location = await prisma.location.create({
    data: { organizationId: org.id, name: "L" },
  });
  ctx.user = { id: user.id, email: user.email, isSuperAdmin: false };
  ctx.organizationId = org.id;
  ctx.db = forOrg(org.id);
  return { org, user, location };
}

async function call(id: string): Promise<Response> {
  const { GET } = await import("@/app/api/screens/[id]/preview/route");
  return GET(new Request(`http://x/api/screens/${id}/preview`), {
    params: Promise.resolve({ id }),
  });
}

async function makeScreen(orgId: string, locationId: string, name: string) {
  return prisma.screen.create({
    data: { organizationId: orgId, locationId, name, status: "ONLINE" },
  });
}

async function readyImage(orgId: string, name: string) {
  const asset = await prisma.mediaAsset.create({
    data: { organizationId: orgId, kind: "IMAGE", status: "READY", name, sizeBytes: BigInt(1) },
  });
  const key = assetStorageKey(orgId, asset.id, ".png");
  await storage.putObject(key, Buffer.from("png"), "image/png");
  await prisma.mediaAsset.update({ where: { id: asset.id }, data: { storageKey: key } });
  return asset;
}

/** One canvas with a single panel whose only frame is a ready IMAGE picture. */
async function seedImageCanvas(orgId: string) {
  const asset = await readyImage(orgId, "Poster");
  const canvas = await prisma.canvas.create({
    data: { organizationId: orgId, name: "Lobby", width: 1920, height: 1080, revision: 3 },
  });
  const panel = await prisma.panel.create({
    data: { organizationId: orgId, canvasId: canvas.id, x: 0, y: 0, width: 960, height: 540, zIndex: 0 },
  });
  const frame = await prisma.frame.create({
    data: { organizationId: orgId, panelId: panel.id, type: "PICTURE", sortOrder: 0, durationSeconds: 12 },
  });
  await prisma.content.create({
    data: {
      organizationId: orgId,
      frameId: frame.id,
      picture: { create: { organizationId: orgId, mode: "fill", mediaAssetId: asset.id } },
    },
  });
  return { canvas, panel };
}

async function makePlaylist(orgId: string, name: string) {
  return prisma.playlist.create({
    data: {
      organizationId: orgId,
      name,
      defaultImageDurationSeconds: 10,
      defaultWebDurationSeconds: 15,
    },
  });
}

suite("GET /api/screens/[id]/preview", () => {
  it("reports source canvas with the canvas id for a canvas-mode screen", async () => {
    const { org, location } = await bindOrg("screen-prev-canvas");
    const { canvas } = await seedImageCanvas(org.id);
    const screen = await makeScreen(org.id, location.id, "Lobby display");
    await prisma.screen.update({ where: { id: screen.id }, data: { canvasId: canvas.id } });

    const res = await call(screen.id);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      source: string;
      canvasId: string;
      screenName: string;
    };
    expect(body.source).toBe("canvas");
    expect(body.canvasId).toBe(canvas.id);
    expect(body.screenName).toBe("Lobby display");
  });

  it("reports source campaign with the campaign's playlist and name as the label", async () => {
    const { org, location } = await bindOrg("screen-prev-campaign");
    const screen = await makeScreen(org.id, location.id, "Atrium");
    const basePlaylist = await makePlaylist(org.id, "Base");
    const campaignPlaylist = await makePlaylist(org.id, "Campaign playlist");
    await prisma.screen.update({
      where: { id: screen.id },
      data: { playlistId: basePlaylist.id },
    });
    const campaign = await prisma.campaign.create({
      data: {
        organizationId: org.id,
        name: "Holiday push",
        playlistId: campaignPlaylist.id,
        startsAt: new Date(Date.now() - 3_600_000),
        endsAt: new Date(Date.now() + 86_400_000),
        enabled: true,
        screens: { create: { organizationId: org.id, screenId: screen.id } },
      },
    });

    const res = await call(screen.id);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      source: string;
      playlistId: string;
      label: string;
      screenName: string;
    };
    expect(body.source).toBe("campaign");
    expect(body.playlistId).toBe(campaignPlaylist.id);
    expect(body.label).toBe("Holiday push");
    expect(body.screenName).toBe("Atrium");
    expect(campaign.id).toBeTruthy();
  });

  it("reports source playlist for a screen with only a base playlist", async () => {
    const { org, location } = await bindOrg("screen-prev-playlist");
    const screen = await makeScreen(org.id, location.id, "Hallway");
    const playlist = await makePlaylist(org.id, "Hallway loop");
    await prisma.screen.update({
      where: { id: screen.id },
      data: { playlistId: playlist.id },
    });

    const res = await call(screen.id);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { source: string; playlistId: string };
    expect(body.source).toBe("playlist");
    expect(body.playlistId).toBe(playlist.id);
  });

  it("reports source none for a screen with nothing to play", async () => {
    const { org, location } = await bindOrg("screen-prev-none");
    const screen = await makeScreen(org.id, location.id, "Dark screen");

    const res = await call(screen.id);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { source: string; screenName: string };
    expect(body.source).toBe("none");
    expect(body.screenName).toBe("Dark screen");
  });

  it("404s for a screen in another organization", async () => {
    const { org: orgB, location: locB } = await bindOrg("screen-prev-b");
    const screenB = await makeScreen(orgB.id, locB.id, "Foreign");

    await bindOrg("screen-prev-a");
    const res = await call(screenB.id);
    expect(res.status).toBe(404);
    const body = (await res.json()) as { type: string };
    expect(body.type).toBe("not_found");
  });

  it("401s when there is no session", async () => {
    requireRoleMock.mockRejectedValueOnce(new UnauthorizedError("You are not signed in."));
    const res = await call("any-screen-id");
    expect(res.status).toBe(401);
  });
});
