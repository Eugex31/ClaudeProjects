import { describe, it, expect, vi, beforeEach } from "vitest";

import { prisma } from "@/lib/db/root";
import { forOrg } from "@/lib/db/tenant";
import { storage, assetStorageKey } from "@/lib/storage";
import { UnauthorizedError } from "@/lib/errors";
import type { CanvasManifest } from "@/lib/player/canvas-manifest";

// The route is gated by `requireRole("canvas.view")`. The mock is a spy so a
// single test can make it reject to stand in for a missing session; every other
// test gets the shared `ctx`, pointed at whichever org it just built.
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
  console.warn("MinIO not running; run npm run storage:up. Skipping preview suite.");
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
  ctx.user = { id: user.id, email: user.email, isSuperAdmin: false };
  ctx.organizationId = org.id;
  ctx.db = forOrg(org.id);
  return { org, user };
}

async function call(id: string): Promise<Response> {
  const { GET } = await import("@/app/api/canvas/[id]/preview/route");
  return GET(new Request(`http://x/api/canvas/${id}/preview`), {
    params: Promise.resolve({ id }),
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

suite("GET /api/canvas/[id]/preview", () => {
  it("returns the assembled canvas manifest with a presigned image url", async () => {
    const { org } = await bindOrg("canvas-prev");
    const { canvas, panel } = await seedImageCanvas(org.id);

    const res = await call(canvas.id);
    expect(res.status).toBe(200);
    const body = (await res.json()) as CanvasManifest;

    expect(body.id).toBe(canvas.id);
    expect(body.name).toBe("Lobby");
    expect(body.revision).toBe(3);
    expect(body.width).toBe(1920);
    expect(body.height).toBe(1080);
    expect(body.panels).toHaveLength(1);

    const [previewPanel] = body.panels;
    expect(previewPanel.id).toBe(panel.id);
    expect(previewPanel.frames).toHaveLength(1);
    expect(previewPanel.frames[0].kind).toBe("image");
    expect(previewPanel.frames[0].durationSeconds).toBe(12);
    expect(previewPanel.frames[0].image?.mode).toBe("fill");
    expect(previewPanel.frames[0].image?.url).toContain(
      process.env.STORAGE_ENDPOINT ?? "http://localhost:9000",
    );
  });

  it("404s for a canvas in another organization", async () => {
    const { org: orgB } = await bindOrg("canvas-prev-b");
    const { canvas: canvasB } = await seedImageCanvas(orgB.id);

    // Rebind the context to org A and ask for B's canvas.
    await bindOrg("canvas-prev-a");
    const res = await call(canvasB.id);
    expect(res.status).toBe(404);
    const body = (await res.json()) as { type: string };
    // `toProblem(new NotFoundError(...))` sets `type` to the error `code`.
    expect(body.type).toBe("not_found");
  });

  it("401s when there is no session", async () => {
    requireRoleMock.mockRejectedValueOnce(new UnauthorizedError("You are not signed in."));
    const res = await call("any-canvas-id");
    expect(res.status).toBe(401);
  });
});
