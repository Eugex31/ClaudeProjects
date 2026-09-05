import { describe, it, expect, vi } from "vitest";

import { prisma } from "@/lib/db/root";
import { forOrg } from "@/lib/db/tenant";
import { storage, assetStorageKey } from "@/lib/storage";

// The route is gated by `requireRole("playlist.view")`; point the mocked context
// at whichever org the test just built.
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
  requireRole: async () => ctx,
  requireOrg: async () => ctx,
}));

const HEALTH = `${process.env.STORAGE_ENDPOINT ?? "http://localhost:9000"}/minio/health/live`;
const minioLive = await fetch(HEALTH)
  .then((r) => r.ok)
  .catch(() => false);
if (!minioLive) {
  console.warn("MinIO not running; run npm run storage:up. Skipping preview suite.");
}
const suite = minioLive ? describe : describe.skip;

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
  const { GET } = await import("@/app/api/playlists/[id]/preview/route");
  return GET(new Request(`http://x/api/playlists/${id}/preview`), {
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

suite("GET /api/playlists/[id]/preview", () => {
  it("returns the assembled manifest in position order and drops disabled and archived items", async () => {
    const { org } = await bindOrg("prev");

    const a = await readyImage(org.id, "Alpha");
    const b = await readyImage(org.id, "Bravo");
    const disabled = await readyImage(org.id, "Disabled");
    const archived = await prisma.mediaAsset.create({
      data: {
        organizationId: org.id,
        kind: "IMAGE",
        status: "READY",
        name: "Archived",
        sizeBytes: BigInt(1),
        storageKey: assetStorageKey(org.id, "archived", ".png"),
        archivedAt: new Date(),
      },
    });
    const web = await prisma.mediaAsset.create({
      data: {
        organizationId: org.id,
        kind: "WEB",
        status: "READY",
        name: "Site",
        sizeBytes: BigInt(0),
        url: "https://example.com",
      },
    });

    const playlist = await prisma.playlist.create({
      data: {
        organizationId: org.id,
        name: "Loop",
        defaultImageDurationSeconds: 9,
        defaultWebDurationSeconds: 14,
      },
    });
    await prisma.playlistItem.createMany({
      data: [
        { organizationId: org.id, playlistId: playlist.id, mediaAssetId: b.id, position: 0 },
        { organizationId: org.id, playlistId: playlist.id, mediaAssetId: a.id, position: 1, durationSeconds: 25 },
        { organizationId: org.id, playlistId: playlist.id, mediaAssetId: web.id, position: 2 },
        { organizationId: org.id, playlistId: playlist.id, mediaAssetId: disabled.id, position: 3, enabled: false },
        { organizationId: org.id, playlistId: playlist.id, mediaAssetId: archived.id, position: 4 },
      ],
    });

    const res = await call(playlist.id);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      id: string;
      name: string;
      revision: number;
      items: { id: string; kind: string; url: string; durationSeconds: number }[];
    };

    expect(body.name).toBe("Loop");
    expect(body.revision).toBe(1);
    expect(body.items).toHaveLength(3);
    expect(body.items.map((i) => i.kind)).toEqual(["IMAGE", "IMAGE", "WEB"]);
    // Bravo is first (position 0), Alpha second with its 25s override, then the web page on the 14s default.
    expect(body.items[0].url).toContain("http://localhost:9000/");
    expect(body.items[0].durationSeconds).toBe(9);
    expect(body.items[1].durationSeconds).toBe(25);
    expect(body.items[2].url).toBe("https://example.com");
    expect(body.items[2].durationSeconds).toBe(14);
  });

  it("404s for a playlist in another organization", async () => {
    const { org: orgB } = await bindOrg("prev-b");
    const playlistB = await prisma.playlist.create({
      data: { organizationId: orgB.id, name: "B" },
    });

    // Rebind the context to org A and ask for B's playlist.
    await bindOrg("prev-a");
    const res = await call(playlistB.id);
    expect(res.status).toBe(404);
  });

  it("returns an empty item list for a playlist with no enabled ready items", async () => {
    const { org } = await bindOrg("prev-empty");
    const playlist = await prisma.playlist.create({
      data: { organizationId: org.id, name: "Empty" },
    });
    const res = await call(playlist.id);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: unknown[] };
    expect(body.items).toEqual([]);
  });
});
