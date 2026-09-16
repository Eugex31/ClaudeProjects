import { describe, it, expect, vi } from "vitest";

import { prisma } from "@/lib/db/root";
import { forOrg } from "@/lib/db/tenant";
import { storage, assetStorageKey } from "@/lib/storage";

// The route is gated by `requireRole("campaign.view")`; point the mocked context
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

const HOUR = 3_600_000;
const DAY = 86_400_000;

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
  const { GET } = await import("@/app/api/campaigns/[id]/preview/route");
  return GET(new Request(`http://x/api/campaigns/${id}/preview`), {
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

async function makeCampaign(orgId: string) {
  const img = await readyImage(orgId, "Poster");
  const web = await prisma.mediaAsset.create({
    data: {
      organizationId: orgId,
      kind: "WEB",
      status: "READY",
      name: "Site",
      sizeBytes: BigInt(0),
      url: "https://example.com",
    },
  });
  const playlist = await prisma.playlist.create({
    data: {
      organizationId: orgId,
      name: "Loop",
      defaultImageDurationSeconds: 9,
      defaultWebDurationSeconds: 14,
    },
  });
  await prisma.playlistItem.createMany({
    data: [
      { organizationId: orgId, playlistId: playlist.id, mediaAssetId: img.id, position: 0 },
      { organizationId: orgId, playlistId: playlist.id, mediaAssetId: web.id, position: 1 },
    ],
  });
  const campaign = await prisma.campaign.create({
    data: {
      organizationId: orgId,
      name: "Holiday",
      playlistId: playlist.id,
      startsAt: new Date(Date.now() - HOUR),
      endsAt: new Date(Date.now() + DAY),
      enabled: true,
    },
  });
  return { campaign, playlist };
}

suite("GET /api/campaigns/[id]/preview", () => {
  it("returns the campaign's playlist manifest in position order", async () => {
    const { org } = await bindOrg("camp-prev");
    const { campaign, playlist } = await makeCampaign(org.id);

    const res = await call(campaign.id);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      id: string;
      name: string;
      revision: number;
      items: { id: string; kind: string; url: string; durationSeconds: number }[];
    };

    // Id, name and revision are the PLAYLIST's, not the campaign's.
    expect(body.id).toBe(playlist.id);
    expect(body.name).toBe("Loop");
    expect(body.revision).toBe(playlist.revision);

    expect(body.items).toHaveLength(2);
    expect(body.items.map((i) => i.kind)).toEqual(["IMAGE", "WEB"]);
    expect(body.items[0].url).toContain(
      process.env.STORAGE_ENDPOINT ?? "http://localhost:9000",
    );
    expect(body.items[1].url).toBe("https://example.com");
  });

  it("404s for a campaign in another organization", async () => {
    const { org: orgB } = await bindOrg("camp-prev-b");
    const { campaign: campaignB } = await makeCampaign(orgB.id);

    // Rebind the context to org A and ask for B's campaign.
    await bindOrg("camp-prev-a");
    const res = await call(campaignB.id);
    expect(res.status).toBe(404);
  });
});
