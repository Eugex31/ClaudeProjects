import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import type { Role } from "@prisma/client";

import { prisma } from "@/lib/db/root";
import { forOrg, withOrgTransaction } from "@/lib/db/tenant";
import { hashDeviceToken } from "@/lib/pairing";
import type { AnalyticsRange } from "@/lib/analytics/types";
import { resetDb, seedPlans } from "@/test/helpers/db";

/**
 * Cross-tenant isolation, exercised without a browser: every entry point is
 * called directly with organization A's server context while the target id
 * belongs to organization B.
 *
 * Two independent guards must each hold:
 *   - the `forOrg` facade (argument rewriting) never returns or mutates a row
 *     outside the bound org, and
 *   - Postgres row-level security, reached through `withOrgTransaction` + raw
 *     SQL, returns none of B's rows under A's GUC.
 *
 * Every negative case asserts B's row is byte-for-byte unchanged afterwards,
 * not merely that an error was returned.
 *
 * The browser-driven cross-tenant checks (hitting routes with A's session
 * cookie) live in the Playwright suite; this file is the vitest half and runs
 * under `npm run test`.
 */

// A mutable context the mocked `requireRole` / `requireOrg` hand back. Populated
// by `setup()` with organization A's user, role, actor and scoped db facade.
const ctx: {
  user: { id: string; email: string; isSuperAdmin: boolean };
  organizationId: string;
  role: Role;
  actor: { kind: "user"; userId: string; isSuperAdmin: boolean; role: Role };
  db: ReturnType<typeof forOrg>;
} = {
  user: { id: "", email: "", isSuperAdmin: false },
  organizationId: "",
  role: "OWNER",
  actor: { kind: "user", userId: "", isSuperAdmin: false, role: "OWNER" },
  db: {} as never,
};

vi.mock("@/lib/auth/context", () => ({
  requireRole: async () => ctx,
  requireOrg: async () => ctx,
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

function uid(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

interface Fixture {
  orgAId: string;
  orgBId: string;
  aLocationId: string;
  bLocationId: string;
  bScreenId: string;
  bIngestScreenId: string;
  bIngestToken: string;
  bPlaybackEventId: string;
  bMembershipId: string;
  bOwnerId: string;
  bFolderId: string;
  bAssetId: string;
  bPlaylistId: string;
  bItemId: string;
  bCampaignId: string;
  bCampaignScreenId: string;
  bCampaignLocationId: string;
  bScheduleRuleId: string;
  bScheduleRuleScreenId: string;
  bScheduleRuleLocationId: string;
  bCanvasId: string;
  bPanelId: string;
  bFrameId: string;
  bWebContentId: string;
}

/**
 * Build org A (with user A as OWNER and one location) and org B (with user B as
 * OWNER, one location and one screen), then point the mocked auth context at A.
 */
async function setup(): Promise<Fixture> {
  const userA = await prisma.user.create({ data: { email: `${uid("a")}@x.com`, name: "User A" } });
  const orgA = await prisma.organization.create({ data: { name: "Org A", slug: uid("org-a") } });
  await prisma.membership.create({ data: { userId: userA.id, organizationId: orgA.id, role: "OWNER" } });
  await prisma.subscription.create({ data: { organizationId: orgA.id, planKey: "GROWTH" } });

  const userB = await prisma.user.create({ data: { email: `${uid("b")}@x.com`, name: "User B" } });
  const orgB = await prisma.organization.create({ data: { name: "Org B", slug: uid("org-b") } });
  const bMembership = await prisma.membership.create({
    data: { userId: userB.id, organizationId: orgB.id, role: "OWNER" },
  });
  await prisma.subscription.create({ data: { organizationId: orgB.id, planKey: "GROWTH" } });
  const bLocation = await prisma.location.create({ data: { organizationId: orgB.id, name: "B Site" } });
  const bScreen = await prisma.screen.create({
    data: {
      organizationId: orgB.id,
      locationId: bLocation.id,
      name: "B Screen",
      status: "UNPAIRED",
      pairingCode: "BBBB2222",
    },
  });

  // A second B screen carrying a device token, so the ingest route can
  // authenticate as org B without touching the token-free screen the pairing
  // cases above assert on.
  const bIngestToken = uid("b-device-token");
  const bIngestScreen = await prisma.screen.create({
    data: {
      organizationId: orgB.id,
      locationId: bLocation.id,
      name: "B Ingest Screen",
      status: "ONLINE",
      deviceTokenHash: hashDeviceToken(bIngestToken),
    },
  });

  const bFolder = await prisma.mediaFolder.create({
    data: { organizationId: orgB.id, name: "B Folder" },
  });
  const bAsset = await prisma.mediaAsset.create({
    data: {
      organizationId: orgB.id,
      folderId: bFolder.id,
      kind: "IMAGE",
      status: "READY",
      name: "B Asset",
      sizeBytes: BigInt(1000),
      storageKey: `org/${orgB.id}/b-asset/original.png`,
    },
  });

  const bPlaylist = await prisma.playlist.create({
    data: { organizationId: orgB.id, name: "B Playlist" },
  });
  const bItem = await prisma.playlistItem.create({
    data: {
      organizationId: orgB.id,
      playlistId: bPlaylist.id,
      mediaAssetId: bAsset.id,
      position: 0,
    },
  });

  const bCampaign = await prisma.campaign.create({
    data: {
      organizationId: orgB.id,
      name: "B Campaign",
      playlistId: bPlaylist.id,
      startsAt: new Date("2026-01-01T00:00:00.000Z"),
      endsAt: new Date("2026-12-31T00:00:00.000Z"),
    },
  });
  const bCampaignScreen = await prisma.campaignScreen.create({
    data: { organizationId: orgB.id, campaignId: bCampaign.id, screenId: bScreen.id },
  });
  const bCampaignLocation = await prisma.campaignLocation.create({
    data: { organizationId: orgB.id, campaignId: bCampaign.id, locationId: bLocation.id },
  });

  const bScheduleRule = await prisma.scheduleRule.create({
    data: {
      organizationId: orgB.id,
      name: "B Schedule Rule",
      playlistId: bPlaylist.id,
      daysOfWeek: [1, 2, 3],
      startMinute: 540,
      endMinute: 1020,
      enabled: true,
    },
  });
  const bScheduleRuleScreen = await prisma.scheduleRuleScreen.create({
    data: { organizationId: orgB.id, scheduleRuleId: bScheduleRule.id, screenId: bScreen.id },
  });
  const bScheduleRuleLocation = await prisma.scheduleRuleLocation.create({
    data: { organizationId: orgB.id, scheduleRuleId: bScheduleRule.id, locationId: bLocation.id },
  });

  // One recorded airing on a B screen. `airedAt` is two days back so any range
  // running from roughly 30 days ago to tomorrow covers it. It carries an asset,
  // a campaign and a schedule rule so every reporting function has something to
  // return for org B in the positive control.
  const bPlaybackEvent = await prisma.playbackEvent.create({
    data: {
      id: uid("b-playback-event"),
      organizationId: orgB.id,
      screenId: bScreen.id,
      mediaAssetId: bAsset.id,
      playlistId: bPlaylist.id,
      source: "campaign",
      campaignId: bCampaign.id,
      scheduleRuleId: bScheduleRule.id,
      airedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
      durationSeconds: 30,
    },
  });

  // One canvas subtree owned entirely by org B: a canvas, a panel on it, a WEB
  // frame in that panel, the frame's Content row (mirrors what `createFrame`
  // attaches) and a Web row on that content. The canvas / panel / frame / web
  // isolation cases act as org A against these ids.
  const bCanvas = await prisma.canvas.create({
    data: { organizationId: orgB.id, name: "B Canvas", width: 1920, height: 1080 },
  });
  const bPanel = await prisma.panel.create({
    data: {
      organizationId: orgB.id,
      canvasId: bCanvas.id,
      name: "B Panel",
      x: 0,
      y: 0,
      width: 200,
      height: 200,
      zIndex: 0,
      noScroll: false,
    },
  });
  const bFrame = await prisma.frame.create({
    data: {
      organizationId: orgB.id,
      panelId: bPanel.id,
      type: "WEB",
      sortOrder: 0,
      durationSeconds: 10,
    },
  });
  const bContent = await prisma.content.create({
    data: { organizationId: orgB.id, frameId: bFrame.id, name: null },
  });
  const bWeb = await prisma.web.create({
    data: { organizationId: orgB.id, contentId: bContent.id, url: "https://b-org.test" },
  });

  const aLocation = await prisma.location.create({ data: { organizationId: orgA.id, name: "A Site" } });

  ctx.user = { id: userA.id, email: userA.email, isSuperAdmin: false };
  ctx.organizationId = orgA.id;
  ctx.role = "OWNER";
  ctx.actor = { kind: "user", userId: userA.id, isSuperAdmin: false, role: "OWNER" };
  ctx.db = forOrg(orgA.id);

  return {
    orgAId: orgA.id,
    orgBId: orgB.id,
    aLocationId: aLocation.id,
    bLocationId: bLocation.id,
    bScreenId: bScreen.id,
    bIngestScreenId: bIngestScreen.id,
    bIngestToken,
    bPlaybackEventId: bPlaybackEvent.id,
    bMembershipId: bMembership.id,
    bOwnerId: userB.id,
    bFolderId: bFolder.id,
    bAssetId: bAsset.id,
    bPlaylistId: bPlaylist.id,
    bItemId: bItem.id,
    bCampaignId: bCampaign.id,
    bCampaignScreenId: bCampaignScreen.id,
    bCampaignLocationId: bCampaignLocation.id,
    bScheduleRuleId: bScheduleRule.id,
    bScheduleRuleScreenId: bScheduleRuleScreen.id,
    bScheduleRuleLocationId: bScheduleRuleLocation.id,
    bCanvasId: bCanvas.id,
    bPanelId: bPanel.id,
    bFrameId: bFrame.id,
    bWebContentId: bWeb.contentId,
  };
}

beforeEach(async () => {
  await resetDb();
  await seedPlans();
});

describe("tenant isolation (direct calls, no browser)", () => {
  it("forOrg(A) cannot read organization B's location", async () => {
    const f = await setup();

    const viaA = await forOrg(f.orgAId).location.findMany();
    expect(viaA.map((l) => l.id)).not.toContain(f.bLocationId);
    expect(viaA.map((l) => l.id)).toEqual([f.aLocationId]);

    expect(await forOrg(f.orgAId).location.findUnique({ where: { id: f.bLocationId } })).toBeNull();

    // Control: B's own facade does see it, so the null above is isolation,
    // not an empty database.
    const viaB = await forOrg(f.orgBId).location.findMany();
    expect(viaB.map((l) => l.id)).toEqual([f.bLocationId]);
  });

  it("updateMemberRole refuses a B membership id and leaves the row unchanged", async () => {
    const f = await setup();
    const before = await prisma.membership.findUnique({ where: { id: f.bMembershipId } });

    const { updateMemberRole } = await import("@/app/(app)/users/actions");
    const res = await updateMemberRole(f.bMembershipId, "VIEWER");

    expect(res.error).toMatch(/not found/i);
    const after = await prisma.membership.findUnique({ where: { id: f.bMembershipId } });
    expect(after).toEqual(before);
    expect(after?.role).toBe("OWNER");
  });

  it("removeMember refuses a B membership id and deletes nothing", async () => {
    const f = await setup();
    const before = await prisma.membership.findUnique({ where: { id: f.bMembershipId } });
    const beforeCount = await prisma.membership.count({ where: { organizationId: f.orgBId } });

    const { removeMember } = await import("@/app/(app)/users/actions");
    const res = await removeMember(f.bMembershipId);

    expect(res.error).toMatch(/not found/i);
    const after = await prisma.membership.findUnique({ where: { id: f.bMembershipId } });
    expect(after).toEqual(before);
    expect(await prisma.membership.count({ where: { organizationId: f.orgBId } })).toBe(beforeCount);
  });

  it("createScreen refuses a B locationId and creates no screen in either org", async () => {
    const f = await setup();
    const bScreenBefore = await prisma.screen.findUnique({ where: { id: f.bScreenId } });
    const bScreensBefore = await prisma.screen.count({ where: { organizationId: f.orgBId } });

    const { createScreen } = await import("@/app/(app)/screens/actions");
    const fd = new FormData();
    fd.set("name", "Poached Screen");
    fd.set("locationId", f.bLocationId);
    const res = await createScreen(fd);

    expect(res.error).toBeTruthy();
    expect(res.pairingCode).toBeUndefined();
    expect(await prisma.screen.count({ where: { organizationId: f.orgAId } })).toBe(0);
    expect(await prisma.screen.count({ where: { organizationId: f.orgBId } })).toBe(bScreensBefore);
    expect(await prisma.screen.findUnique({ where: { id: f.bScreenId } })).toEqual(bScreenBefore);
  });

  it("regeneratePairingCode refuses a B screen id and leaves the screen byte-unchanged", async () => {
    const f = await setup();
    const before = await prisma.screen.findUnique({ where: { id: f.bScreenId } });

    const { regeneratePairingCode } = await import("@/app/(app)/screens/actions");
    let res: { error?: string; pairingCode?: string };
    try {
      res = await regeneratePairingCode(f.bScreenId);
    } catch (err) {
      res = { error: err instanceof Error ? err.message : String(err) };
    }

    expect(res.error).toBeTruthy();
    expect(res.pairingCode).toBeUndefined();
    const after = await prisma.screen.findUnique({ where: { id: f.bScreenId } });
    expect(after).toEqual(before);
    expect(after?.pairingCode).toBe("BBBB2222");
    expect(after?.status).toBe("UNPAIRED");
    expect(after?.deviceTokenHash).toBeNull();
  });

  it("withOrgTransaction(A) raw SQL sees none of B's rows (RLS backstop)", async () => {
    const f = await setup();

    const locations = await withOrgTransaction(f.orgAId, (tx) =>
      tx.$queryRawUnsafe<{ id: string }[]>(`SELECT id FROM "Location"`),
    );
    expect(locations.map((r) => r.id)).toEqual([f.aLocationId]);
    expect(locations.map((r) => r.id)).not.toContain(f.bLocationId);

    const screens = await withOrgTransaction(f.orgAId, (tx) =>
      tx.$queryRawUnsafe<{ id: string }[]>(`SELECT id FROM "Screen"`),
    );
    expect(screens).toEqual([]);

    const memberships = await withOrgTransaction(f.orgAId, (tx) =>
      tx.$queryRawUnsafe<{ id: string }[]>(`SELECT id FROM "Membership"`),
    );
    expect(memberships.map((r) => r.id)).not.toContain(f.bMembershipId);
  });
});

/**
 * Normalize an action call to a `{ error }` shape whether it returns an error
 * object or throws (`NotFoundError` and friends), mirroring the
 * `regeneratePairingCode` case above.
 */
async function callOrError<T extends { error?: string }>(
  run: () => Promise<T>,
): Promise<T | { error: string }> {
  try {
    return await run();
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

describe("tenant isolation for media (direct calls, no browser)", () => {
  it("forOrg(A) cannot see organization B's media rows", async () => {
    const f = await setup();

    const assetsViaA = await forOrg(f.orgAId).mediaAsset.findMany();
    expect(assetsViaA.map((r) => r.id)).not.toContain(f.bAssetId);
    expect(assetsViaA.map((r) => r.id)).toEqual([]);

    const foldersViaA = await forOrg(f.orgAId).mediaFolder.findMany();
    expect(foldersViaA.map((r) => r.id)).not.toContain(f.bFolderId);
    expect(foldersViaA.map((r) => r.id)).toEqual([]);

    expect(
      await forOrg(f.orgAId).mediaAsset.findUnique({ where: { id: f.bAssetId } }),
    ).toBeNull();
    expect(
      await forOrg(f.orgAId).mediaFolder.findUnique({ where: { id: f.bFolderId } }),
    ).toBeNull();

    // Control: B's own facade does see its asset, so the nulls above are
    // isolation, not an empty database.
    const assetsViaB = await forOrg(f.orgBId).mediaAsset.findMany();
    expect(assetsViaB.map((r) => r.id)).toEqual([f.bAssetId]);
  });

  it("updateAsset refuses a B asset id and leaves the row byte-unchanged", async () => {
    const f = await setup();
    const before = await prisma.mediaAsset.findUnique({ where: { id: f.bAssetId } });

    const { updateAsset } = await import("@/app/(app)/media/actions");
    const res = await callOrError(() => updateAsset(f.bAssetId, { name: "hijacked" }));

    expect(res.error).toBeTruthy();
    const after = await prisma.mediaAsset.findUnique({ where: { id: f.bAssetId } });
    expect(after).toEqual(before);
    expect(after?.name).toBe("B Asset");
  });

  it("deleteAssets refuses a B asset id and archives nothing", async () => {
    const f = await setup();
    const before = await prisma.mediaAsset.findUnique({ where: { id: f.bAssetId } });
    const liveBefore = await prisma.mediaAsset.count({
      where: { organizationId: f.orgBId, archivedAt: null },
    });

    const { deleteAssets } = await import("@/app/(app)/media/actions");
    let res: { archived?: number; error?: string };
    try {
      res = await deleteAssets([f.bAssetId]);
    } catch (err) {
      res = { error: err instanceof Error ? err.message : String(err) };
    }

    if (res.error === undefined) expect(res.archived).toBe(0);
    const after = await prisma.mediaAsset.findUnique({ where: { id: f.bAssetId } });
    expect(after).toEqual(before);
    expect(after?.archivedAt).toBeNull();
    expect(
      await prisma.mediaAsset.count({ where: { organizationId: f.orgBId, archivedAt: null } }),
    ).toBe(liveBefore);
  });

  it("restoreAsset refuses a B asset id and leaves the row byte-unchanged", async () => {
    const f = await setup();
    const before = await prisma.mediaAsset.findUnique({ where: { id: f.bAssetId } });

    const { restoreAsset } = await import("@/app/(app)/media/actions");
    const res = await callOrError(() => restoreAsset(f.bAssetId));

    expect(res.error).toBeTruthy();
    const after = await prisma.mediaAsset.findUnique({ where: { id: f.bAssetId } });
    expect(after).toEqual(before);
  });

  it("renameFolder refuses a B folder id and leaves the row byte-unchanged", async () => {
    const f = await setup();
    const before = await prisma.mediaFolder.findUnique({ where: { id: f.bFolderId } });

    const { renameFolder } = await import("@/app/(app)/media/actions");
    const res = await callOrError(() => renameFolder(f.bFolderId, "hijacked"));

    expect(res.error).toBeTruthy();
    const after = await prisma.mediaFolder.findUnique({ where: { id: f.bFolderId } });
    expect(after).toEqual(before);
    expect(after?.name).toBe("B Folder");
  });

  it("moveFolder refuses a B folder id and leaves the row byte-unchanged", async () => {
    const f = await setup();
    const before = await prisma.mediaFolder.findUnique({ where: { id: f.bFolderId } });

    const { moveFolder } = await import("@/app/(app)/media/actions");
    const res = await callOrError(() => moveFolder(f.bFolderId, null));

    expect(res.error).toBeTruthy();
    const after = await prisma.mediaFolder.findUnique({ where: { id: f.bFolderId } });
    expect(after).toEqual(before);
  });

  it("deleteFolder refuses a B folder id and cascades into nothing", async () => {
    const f = await setup();
    const before = await prisma.mediaFolder.findUnique({ where: { id: f.bFolderId } });
    const foldersBefore = await prisma.mediaFolder.count({ where: { organizationId: f.orgBId } });

    const { deleteFolder } = await import("@/app/(app)/media/actions");
    const res = await callOrError(() => deleteFolder(f.bFolderId));

    expect(res.error).toBeTruthy();
    const after = await prisma.mediaFolder.findUnique({ where: { id: f.bFolderId } });
    expect(after).toEqual(before);
    expect(await prisma.mediaFolder.count({ where: { organizationId: f.orgBId } })).toBe(
      foldersBefore,
    );
    // A cross-org cascade would be the nightmare bug: B's asset must still sit
    // in B's folder.
    const bAsset = await prisma.mediaAsset.findUnique({ where: { id: f.bAssetId } });
    expect(bAsset?.folderId).toBe(f.bFolderId);
  });

  it("requestUpload refuses a B folder id and creates no asset in A", async () => {
    const f = await setup();

    const { requestUpload } = await import("@/app/(app)/media/actions");
    let res: { assetId?: string; error?: string };
    try {
      res = await requestUpload({
        folderId: f.bFolderId,
        filename: "x.png",
        mimeType: "image/png",
        sizeBytes: 1000,
      });
    } catch (err) {
      res = { error: err instanceof Error ? err.message : String(err) };
    }

    expect(res.error).toBeTruthy();
    expect(res.assetId).toBeUndefined();
    expect(await prisma.mediaAsset.count({ where: { organizationId: f.orgAId } })).toBe(0);
  });

  it("finalizeUpload refuses a B asset id and leaves the row byte-unchanged", async () => {
    const f = await setup();
    const before = await prisma.mediaAsset.findUnique({ where: { id: f.bAssetId } });

    const { finalizeUpload } = await import("@/app/(app)/media/actions");
    const res = await callOrError(() => finalizeUpload(f.bAssetId) as Promise<{ error?: string }>);

    expect(res.error).toBeTruthy();
    const after = await prisma.mediaAsset.findUnique({ where: { id: f.bAssetId } });
    expect(after).toEqual(before);
  });

  it("GET /api/media/[id]/url 404s for a B asset id", async () => {
    const f = await setup();

    const { GET } = await import("@/app/api/media/[id]/url/route");
    const res = await GET(new Request("http://localhost/api/media/x/url"), {
      params: Promise.resolve({ id: f.bAssetId }),
    });

    expect(res.status).toBe(404);
    const after = await prisma.mediaAsset.findUnique({ where: { id: f.bAssetId } });
    expect(after?.name).toBe("B Asset");
  });

  it("withOrgTransaction(A) raw SQL sees none of B's media rows (RLS backstop)", async () => {
    const f = await setup();

    const assets = await withOrgTransaction(f.orgAId, (tx) =>
      tx.$queryRawUnsafe<{ id: string }[]>(`SELECT id FROM "MediaAsset"`),
    );
    expect(assets.map((r) => r.id)).not.toContain(f.bAssetId);
    expect(assets.map((r) => r.id)).toEqual([]);

    const folders = await withOrgTransaction(f.orgAId, (tx) =>
      tx.$queryRawUnsafe<{ id: string }[]>(`SELECT id FROM "MediaFolder"`),
    );
    expect(folders.map((r) => r.id)).not.toContain(f.bFolderId);
    expect(folders.map((r) => r.id)).toEqual([]);
  });
});

describe("tenant isolation for playlists (direct calls, no browser)", () => {
  it("forOrg(A) cannot see organization B's playlist rows", async () => {
    const f = await setup();

    const playlistsViaA = await forOrg(f.orgAId).playlist.findMany();
    expect(playlistsViaA.map((r) => r.id)).not.toContain(f.bPlaylistId);
    expect(playlistsViaA.map((r) => r.id)).toEqual([]);

    const itemsViaA = await forOrg(f.orgAId).playlistItem.findMany();
    expect(itemsViaA.map((r) => r.id)).not.toContain(f.bItemId);
    expect(itemsViaA.map((r) => r.id)).toEqual([]);

    expect(
      await forOrg(f.orgAId).playlist.findUnique({ where: { id: f.bPlaylistId } }),
    ).toBeNull();
    expect(
      await forOrg(f.orgAId).playlistItem.findUnique({ where: { id: f.bItemId } }),
    ).toBeNull();

    // Control: B's own facade does see its playlist, so the nulls above are
    // isolation, not an empty database.
    const playlistsViaB = await forOrg(f.orgBId).playlist.findMany();
    expect(playlistsViaB.map((r) => r.id)).toEqual([f.bPlaylistId]);
  });

  it("updatePlaylist refuses a B playlist id and leaves the row byte-unchanged", async () => {
    const f = await setup();
    const before = await prisma.playlist.findUnique({ where: { id: f.bPlaylistId } });

    const { updatePlaylist } = await import("@/app/(app)/playlists/actions");
    const res = await callOrError(() => updatePlaylist(f.bPlaylistId, { name: "hijacked" }));

    expect(res.error).toBeTruthy();
    const after = await prisma.playlist.findUnique({ where: { id: f.bPlaylistId } });
    expect(after).toEqual(before);
    expect(after?.name).toBe("B Playlist");
  });

  it("archivePlaylist refuses a B playlist id and leaves the row byte-unchanged", async () => {
    const f = await setup();
    const before = await prisma.playlist.findUnique({ where: { id: f.bPlaylistId } });

    const { archivePlaylist } = await import("@/app/(app)/playlists/actions");
    const res = await callOrError(() => archivePlaylist(f.bPlaylistId));

    expect(res.error).toBeTruthy();
    const after = await prisma.playlist.findUnique({ where: { id: f.bPlaylistId } });
    expect(after).toEqual(before);
    expect(after?.archivedAt).toBeNull();
  });

  it("deletePlaylist refuses a B playlist id and deletes nothing", async () => {
    const f = await setup();
    const before = await prisma.playlist.findUnique({ where: { id: f.bPlaylistId } });

    const { deletePlaylist } = await import("@/app/(app)/playlists/actions");
    const res = await callOrError(() => deletePlaylist(f.bPlaylistId));

    expect(res.error).toBeTruthy();
    const after = await prisma.playlist.findUnique({ where: { id: f.bPlaylistId } });
    expect(after).toEqual(before);
    // A cross-org delete must not succeed.
    expect(after).not.toBeNull();
  });

  it("addItems refuses a B playlist id and creates no item", async () => {
    const f = await setup();
    const before = await prisma.playlist.findUnique({ where: { id: f.bPlaylistId } });
    const countBefore = await prisma.playlistItem.count({ where: { playlistId: f.bPlaylistId } });

    const { addItems } = await import("@/app/(app)/playlists/actions");
    let res: { added?: number; error?: string };
    try {
      res = await addItems(f.bPlaylistId, { mediaAssetIds: [f.bAssetId] });
    } catch (err) {
      res = { error: err instanceof Error ? err.message : String(err) };
    }

    expect(res.error).toBeTruthy();
    const after = await prisma.playlist.findUnique({ where: { id: f.bPlaylistId } });
    expect(after).toEqual(before);
    expect(await prisma.playlistItem.count({ where: { playlistId: f.bPlaylistId } })).toBe(
      countBefore,
    );
    expect(countBefore).toBe(1);
  });

  it("reorderItems refuses a B playlist id and leaves the items byte-unchanged", async () => {
    const f = await setup();
    const before = await prisma.playlistItem.findUnique({ where: { id: f.bItemId } });

    const { reorderItems } = await import("@/app/(app)/playlists/actions");
    const res = await callOrError(() => reorderItems(f.bPlaylistId, { itemIds: [f.bItemId] }));

    expect(res.error).toBeTruthy();
    const after = await prisma.playlistItem.findUnique({ where: { id: f.bItemId } });
    expect(after).toEqual(before);
  });

  it("removeItem refuses a B item id and deletes nothing", async () => {
    const f = await setup();
    const before = await prisma.playlistItem.findUnique({ where: { id: f.bItemId } });

    const { removeItem } = await import("@/app/(app)/playlists/actions");
    const res = await callOrError(() => removeItem(f.bItemId));

    expect(res.error).toBeTruthy();
    const after = await prisma.playlistItem.findUnique({ where: { id: f.bItemId } });
    expect(after).toEqual(before);
    expect(after).not.toBeNull();
  });

  it("setItemDuration refuses a B item id and leaves the row byte-unchanged", async () => {
    const f = await setup();
    const before = await prisma.playlistItem.findUnique({ where: { id: f.bItemId } });

    const { setItemDuration } = await import("@/app/(app)/playlists/actions");
    const res = await callOrError(() => setItemDuration(f.bItemId, { durationSeconds: 99 }));

    expect(res.error).toBeTruthy();
    const after = await prisma.playlistItem.findUnique({ where: { id: f.bItemId } });
    expect(after).toEqual(before);
    expect(after?.durationSeconds).toBeNull();
  });

  it("setItemEnabled refuses a B item id and leaves the row byte-unchanged", async () => {
    const f = await setup();
    const before = await prisma.playlistItem.findUnique({ where: { id: f.bItemId } });

    const { setItemEnabled } = await import("@/app/(app)/playlists/actions");
    const res = await callOrError(() => setItemEnabled(f.bItemId, false));

    expect(res.error).toBeTruthy();
    const after = await prisma.playlistItem.findUnique({ where: { id: f.bItemId } });
    expect(after).toEqual(before);
    expect(after?.enabled).toBe(true);
  });

  it("assignPlaylistToScreen refuses a B screen and playlist and changes no assignment", async () => {
    const f = await setup();
    const before = await prisma.screen.findUnique({ where: { id: f.bScreenId } });

    const { assignPlaylistToScreen } = await import("@/app/(app)/playlists/actions");
    const res = await callOrError(() => assignPlaylistToScreen(f.bScreenId, f.bPlaylistId));

    expect(res.error).toBeTruthy();
    const after = await prisma.screen.findUnique({ where: { id: f.bScreenId } });
    expect(after).toEqual(before);
    expect(after?.playlistId).toBeNull();
  });

  it("addItems refuses a B mediaAssetId dropped into an A playlist", async () => {
    const f = await setup();

    const { createPlaylist, addItems } = await import("@/app/(app)/playlists/actions");
    const created = await createPlaylist({ name: "A" });
    if ("error" in created) throw new Error(created.error);
    const aPlaylistId = created.id;

    let res: { added?: number; error?: string };
    try {
      res = await addItems(aPlaylistId, { mediaAssetIds: [f.bAssetId] });
    } catch (err) {
      res = { error: err instanceof Error ? err.message : String(err) };
    }

    expect(res.error).toBeTruthy();
    expect(await prisma.playlistItem.count({ where: { playlistId: aPlaylistId } })).toBe(0);
  });

  it("withOrgTransaction(A) raw SQL sees none of B's playlist rows (RLS backstop)", async () => {
    const f = await setup();

    const playlists = await withOrgTransaction(f.orgAId, (tx) =>
      tx.$queryRawUnsafe<{ id: string }[]>(`SELECT id FROM "Playlist"`),
    );
    expect(playlists.map((r) => r.id)).not.toContain(f.bPlaylistId);

    const items = await withOrgTransaction(f.orgAId, (tx) =>
      tx.$queryRawUnsafe<{ id: string }[]>(`SELECT id FROM "PlaylistItem"`),
    );
    expect(items.map((r) => r.id)).not.toContain(f.bItemId);
  });
});

describe("tenant isolation for campaigns (direct calls, no browser)", () => {
  it("forOrg(A) cannot see organization B's campaign rows", async () => {
    const f = await setup();

    const campaignsViaA = await forOrg(f.orgAId).campaign.findMany();
    expect(campaignsViaA.map((r) => r.id)).not.toContain(f.bCampaignId);
    expect(campaignsViaA.map((r) => r.id)).toEqual([]);

    const campaignScreensViaA = await forOrg(f.orgAId).campaignScreen.findMany();
    expect(campaignScreensViaA.map((r) => r.id)).not.toContain(f.bCampaignScreenId);
    expect(campaignScreensViaA.map((r) => r.id)).toEqual([]);

    const campaignLocationsViaA = await forOrg(f.orgAId).campaignLocation.findMany();
    expect(campaignLocationsViaA.map((r) => r.id)).not.toContain(f.bCampaignLocationId);
    expect(campaignLocationsViaA.map((r) => r.id)).toEqual([]);

    expect(
      await forOrg(f.orgAId).campaign.findUnique({ where: { id: f.bCampaignId } }),
    ).toBeNull();

    // Control: B's own facade does see its campaign, so the nulls above are
    // isolation, not an empty database.
    const campaignsViaB = await forOrg(f.orgBId).campaign.findMany();
    expect(campaignsViaB.map((r) => r.id)).toEqual([f.bCampaignId]);
  });

  it("updateCampaign refuses a B campaign id and leaves the row byte-unchanged", async () => {
    const f = await setup();
    const before = await prisma.campaign.findUnique({ where: { id: f.bCampaignId } });

    const { updateCampaign } = await import("@/app/(app)/campaigns/actions");
    const res = await callOrError(() => updateCampaign(f.bCampaignId, { priority: 99 }));

    expect(res.error).toBeTruthy();
    const after = await prisma.campaign.findUnique({ where: { id: f.bCampaignId } });
    expect(after).toEqual(before);
    expect(after?.priority).toBe(0);
  });

  it("setCampaignEnabled refuses a B campaign id and leaves the row byte-unchanged", async () => {
    const f = await setup();
    const before = await prisma.campaign.findUnique({ where: { id: f.bCampaignId } });

    const { setCampaignEnabled } = await import("@/app/(app)/campaigns/actions");
    const res = await callOrError(() => setCampaignEnabled(f.bCampaignId, false));

    expect(res.error).toBeTruthy();
    const after = await prisma.campaign.findUnique({ where: { id: f.bCampaignId } });
    expect(after).toEqual(before);
    expect(after?.enabled).toBe(true);
  });

  it("archiveCampaign refuses a B campaign id and leaves the row byte-unchanged", async () => {
    const f = await setup();
    const before = await prisma.campaign.findUnique({ where: { id: f.bCampaignId } });

    const { archiveCampaign } = await import("@/app/(app)/campaigns/actions");
    const res = await callOrError(() => archiveCampaign(f.bCampaignId));

    expect(res.error).toBeTruthy();
    const after = await prisma.campaign.findUnique({ where: { id: f.bCampaignId } });
    expect(after).toEqual(before);
    expect(after?.archivedAt).toBeNull();
  });

  it("restoreCampaign refuses a B campaign id and leaves the row byte-unchanged", async () => {
    const f = await setup();
    await prisma.campaign.update({
      where: { id: f.bCampaignId },
      data: { archivedAt: new Date() },
    });
    const before = await prisma.campaign.findUnique({ where: { id: f.bCampaignId } });

    const { restoreCampaign } = await import("@/app/(app)/campaigns/actions");
    const res = await callOrError(() => restoreCampaign(f.bCampaignId));

    expect(res.error).toBeTruthy();
    const after = await prisma.campaign.findUnique({ where: { id: f.bCampaignId } });
    expect(after).toEqual(before);
    expect(after?.archivedAt).not.toBeNull();
  });

  it("deleteCampaign refuses a B campaign id and deletes nothing", async () => {
    const f = await setup();
    const before = await prisma.campaign.findUnique({ where: { id: f.bCampaignId } });

    const { deleteCampaign } = await import("@/app/(app)/campaigns/actions");
    const res = await callOrError(() => deleteCampaign(f.bCampaignId));

    expect(res.error).toBeTruthy();
    const after = await prisma.campaign.findUnique({ where: { id: f.bCampaignId } });
    expect(after).toEqual(before);
    // A cross-org delete must not succeed.
    expect(after).not.toBeNull();
  });

  it("setCampaignTargets refuses a B campaign id and changes no join rows", async () => {
    const f = await setup();
    const before = await prisma.campaign.findUnique({ where: { id: f.bCampaignId } });
    const screensBefore = await prisma.campaignScreen.count({
      where: { campaignId: f.bCampaignId },
    });

    const { setCampaignTargets } = await import("@/app/(app)/campaigns/actions");
    const res = await callOrError(() =>
      setCampaignTargets(f.bCampaignId, { screenIds: [f.bScreenId], locationIds: [] }),
    );

    expect(res.error).toBeTruthy();
    const after = await prisma.campaign.findUnique({ where: { id: f.bCampaignId } });
    expect(after).toEqual(before);
    expect(await prisma.campaignScreen.count({ where: { campaignId: f.bCampaignId } })).toBe(
      screensBefore,
    );
  });

  it("createCampaign refuses a B playlistId dropped into an A campaign", async () => {
    const f = await setup();

    const { createCampaign } = await import("@/app/(app)/campaigns/actions");
    let res: { id?: string; error?: string };
    try {
      res = await createCampaign({
        name: "A Campaign",
        playlistId: f.bPlaylistId,
        startsAt: "2027-01-01T00:00:00.000Z",
        endsAt: "2027-12-31T00:00:00.000Z",
      });
    } catch (err) {
      res = { error: err instanceof Error ? err.message : String(err) };
    }

    expect(res.error).toBeTruthy();
    expect(res.id).toBeUndefined();
    expect(await prisma.campaign.count({ where: { organizationId: f.orgAId } })).toBe(0);
  });

  it("setCampaignTargets refuses a B screenId dropped into an A campaign", async () => {
    const f = await setup();
    const aPlaylist = await prisma.playlist.create({
      data: { organizationId: f.orgAId, name: "A Playlist" },
    });

    const { createCampaign, setCampaignTargets } = await import("@/app/(app)/campaigns/actions");
    const created = await createCampaign({
      name: "A Campaign",
      playlistId: aPlaylist.id,
      startsAt: "2027-01-01T00:00:00.000Z",
      endsAt: "2027-12-31T00:00:00.000Z",
    });
    if ("error" in created) throw new Error(created.error);
    const aCampaignId = created.id;

    const res = await callOrError(() =>
      setCampaignTargets(aCampaignId, { screenIds: [f.bScreenId], locationIds: [] }),
    );

    expect(res.error).toBeTruthy();
    expect(await prisma.campaignScreen.count({ where: { campaignId: aCampaignId } })).toBe(0);
  });

  it("setCampaignTargets refuses a B locationId dropped into an A campaign", async () => {
    const f = await setup();
    const aPlaylist = await prisma.playlist.create({
      data: { organizationId: f.orgAId, name: "A Playlist" },
    });

    const { createCampaign, setCampaignTargets } = await import("@/app/(app)/campaigns/actions");
    const created = await createCampaign({
      name: "A Campaign",
      playlistId: aPlaylist.id,
      startsAt: "2027-01-01T00:00:00.000Z",
      endsAt: "2027-12-31T00:00:00.000Z",
    });
    if ("error" in created) throw new Error(created.error);
    const aCampaignId = created.id;

    const res = await callOrError(() =>
      setCampaignTargets(aCampaignId, { screenIds: [], locationIds: [f.bLocationId] }),
    );

    expect(res.error).toBeTruthy();
    expect(await prisma.campaignLocation.count({ where: { campaignId: aCampaignId } })).toBe(0);
  });

  it("withOrgTransaction(A) raw SQL sees none of B's campaign rows (RLS backstop)", async () => {
    const f = await setup();

    const campaigns = await withOrgTransaction(f.orgAId, (tx) =>
      tx.$queryRawUnsafe<{ id: string }[]>(`SELECT id FROM "Campaign"`),
    );
    expect(campaigns.map((r) => r.id)).not.toContain(f.bCampaignId);

    const campaignScreens = await withOrgTransaction(f.orgAId, (tx) =>
      tx.$queryRawUnsafe<{ id: string }[]>(`SELECT id FROM "CampaignScreen"`),
    );
    expect(campaignScreens.map((r) => r.id)).not.toContain(f.bCampaignScreenId);

    const campaignLocations = await withOrgTransaction(f.orgAId, (tx) =>
      tx.$queryRawUnsafe<{ id: string }[]>(`SELECT id FROM "CampaignLocation"`),
    );
    expect(campaignLocations.map((r) => r.id)).not.toContain(f.bCampaignLocationId);
  });
});

describe("tenant isolation for schedule rules (direct calls, no browser)", () => {
  it("forOrg(A) cannot see organization B's schedule rule rows", async () => {
    const f = await setup();

    const rulesViaA = await forOrg(f.orgAId).scheduleRule.findMany();
    expect(rulesViaA.map((r) => r.id)).not.toContain(f.bScheduleRuleId);
    expect(rulesViaA.map((r) => r.id)).toEqual([]);

    const ruleScreensViaA = await forOrg(f.orgAId).scheduleRuleScreen.findMany();
    expect(ruleScreensViaA.map((r) => r.id)).not.toContain(f.bScheduleRuleScreenId);
    expect(ruleScreensViaA.map((r) => r.id)).toEqual([]);

    const ruleLocationsViaA = await forOrg(f.orgAId).scheduleRuleLocation.findMany();
    expect(ruleLocationsViaA.map((r) => r.id)).not.toContain(f.bScheduleRuleLocationId);
    expect(ruleLocationsViaA.map((r) => r.id)).toEqual([]);

    expect(
      await forOrg(f.orgAId).scheduleRule.findUnique({ where: { id: f.bScheduleRuleId } }),
    ).toBeNull();

    // Control: B's own facade does see its rule, so the nulls above are
    // isolation, not an empty database.
    const rulesViaB = await forOrg(f.orgBId).scheduleRule.findMany();
    expect(rulesViaB.map((r) => r.id)).toEqual([f.bScheduleRuleId]);
  });

  it("updateScheduleRule refuses a B rule id and leaves the row byte-unchanged", async () => {
    const f = await setup();
    const before = await prisma.scheduleRule.findUnique({ where: { id: f.bScheduleRuleId } });

    const { updateScheduleRule } = await import("@/app/(app)/schedule/actions");
    let res: { id?: string; error?: string };
    try {
      res = await updateScheduleRule(f.bScheduleRuleId, { name: "hijacked" });
    } catch (err) {
      res = { error: err instanceof Error ? err.message : String(err) };
    }

    expect(res.error).toBeTruthy();
    const after = await prisma.scheduleRule.findUnique({ where: { id: f.bScheduleRuleId } });
    expect(after).toEqual(before);
    expect(after?.name).toBe("B Schedule Rule");
    expect(after?.revision).toBe(1);
    expect(after?.enabled).toBe(true);
    expect(after?.archivedAt).toBeNull();
  });

  it("setScheduleRuleEnabled refuses a B rule id and leaves the row byte-unchanged", async () => {
    const f = await setup();
    const before = await prisma.scheduleRule.findUnique({ where: { id: f.bScheduleRuleId } });

    const { setScheduleRuleEnabled } = await import("@/app/(app)/schedule/actions");
    let res: { id?: string; error?: string };
    try {
      res = await setScheduleRuleEnabled(f.bScheduleRuleId, false);
    } catch (err) {
      res = { error: err instanceof Error ? err.message : String(err) };
    }

    expect(res.error).toBeTruthy();
    const after = await prisma.scheduleRule.findUnique({ where: { id: f.bScheduleRuleId } });
    expect(after).toEqual(before);
    expect(after?.enabled).toBe(true);
    expect(after?.revision).toBe(1);
  });

  it("setScheduleRuleTargets refuses a B rule id and changes no join rows", async () => {
    const f = await setup();
    const before = await prisma.scheduleRule.findUnique({ where: { id: f.bScheduleRuleId } });
    const screensBefore = await prisma.scheduleRuleScreen.count({
      where: { scheduleRuleId: f.bScheduleRuleId },
    });
    const locationsBefore = await prisma.scheduleRuleLocation.count({
      where: { scheduleRuleId: f.bScheduleRuleId },
    });

    const { setScheduleRuleTargets } = await import("@/app/(app)/schedule/actions");
    let res: { id?: string; error?: string };
    try {
      res = await setScheduleRuleTargets(f.bScheduleRuleId, {
        screenIds: [f.bScreenId],
        locationIds: [],
      });
    } catch (err) {
      res = { error: err instanceof Error ? err.message : String(err) };
    }

    expect(res.error).toBeTruthy();
    const after = await prisma.scheduleRule.findUnique({ where: { id: f.bScheduleRuleId } });
    expect(after).toEqual(before);
    expect(after?.revision).toBe(1);
    expect(
      await prisma.scheduleRuleScreen.count({ where: { scheduleRuleId: f.bScheduleRuleId } }),
    ).toBe(screensBefore);
    expect(
      await prisma.scheduleRuleLocation.count({ where: { scheduleRuleId: f.bScheduleRuleId } }),
    ).toBe(locationsBefore);
  });

  it("archiveScheduleRule refuses a B rule id and leaves the row byte-unchanged", async () => {
    const f = await setup();
    const before = await prisma.scheduleRule.findUnique({ where: { id: f.bScheduleRuleId } });

    const { archiveScheduleRule } = await import("@/app/(app)/schedule/actions");
    let res: { ok?: true; error?: string };
    try {
      res = await archiveScheduleRule(f.bScheduleRuleId);
    } catch (err) {
      res = { error: err instanceof Error ? err.message : String(err) };
    }

    expect(res.error).toBeTruthy();
    const after = await prisma.scheduleRule.findUnique({ where: { id: f.bScheduleRuleId } });
    expect(after).toEqual(before);
    expect(after?.archivedAt).toBeNull();
  });

  it("restoreScheduleRule refuses a B rule id and leaves the row byte-unchanged", async () => {
    const f = await setup();
    await prisma.scheduleRule.update({
      where: { id: f.bScheduleRuleId },
      data: { archivedAt: new Date() },
    });
    const before = await prisma.scheduleRule.findUnique({ where: { id: f.bScheduleRuleId } });

    const { restoreScheduleRule } = await import("@/app/(app)/schedule/actions");
    let res: { ok?: true; error?: string };
    try {
      res = await restoreScheduleRule(f.bScheduleRuleId);
    } catch (err) {
      res = { error: err instanceof Error ? err.message : String(err) };
    }

    expect(res.error).toBeTruthy();
    const after = await prisma.scheduleRule.findUnique({ where: { id: f.bScheduleRuleId } });
    expect(after).toEqual(before);
    expect(after?.archivedAt).not.toBeNull();
  });

  it("deleteScheduleRule refuses a B rule id and deletes nothing", async () => {
    const f = await setup();
    const before = await prisma.scheduleRule.findUnique({ where: { id: f.bScheduleRuleId } });

    const { deleteScheduleRule } = await import("@/app/(app)/schedule/actions");
    let res: { ok?: true; error?: string };
    try {
      res = await deleteScheduleRule(f.bScheduleRuleId);
    } catch (err) {
      res = { error: err instanceof Error ? err.message : String(err) };
    }

    expect(res.error).toBeTruthy();
    const after = await prisma.scheduleRule.findUnique({ where: { id: f.bScheduleRuleId } });
    expect(after).toEqual(before);
    // A cross-org delete must not succeed.
    expect(after).not.toBeNull();
  });

  it("createScheduleRule refuses a B screenId dropped into an A rule and creates nothing", async () => {
    const f = await setup();
    const aPlaylist = await prisma.playlist.create({
      data: { organizationId: f.orgAId, name: "A Playlist" },
    });

    const { createScheduleRule } = await import("@/app/(app)/schedule/actions");
    let res: { id?: string; error?: string };
    try {
      res = await createScheduleRule({
        name: "A Rule",
        playlistId: aPlaylist.id,
        daysOfWeek: [1],
        startMinute: 540,
        endMinute: 1020,
        screenIds: [f.bScreenId],
        locationIds: [],
      });
    } catch (err) {
      res = { error: err instanceof Error ? err.message : String(err) };
    }

    expect(res.error).toBeTruthy();
    expect(await prisma.scheduleRule.count({ where: { organizationId: f.orgAId } })).toBe(0);
    expect(await prisma.scheduleRuleScreen.count({ where: { organizationId: f.orgAId } })).toBe(0);
  });

  it("withOrgTransaction(A) raw SQL sees none of B's schedule rule rows (RLS backstop)", async () => {
    const f = await setup();

    const rules = await withOrgTransaction(f.orgAId, (tx) =>
      tx.$queryRawUnsafe<{ count: number }[]>(
        `SELECT count(*)::int AS count FROM "ScheduleRule" WHERE id = '${f.bScheduleRuleId}'`,
      ),
    );
    expect(rules[0].count).toBe(0);

    const ruleScreens = await withOrgTransaction(f.orgAId, (tx) =>
      tx.$queryRawUnsafe<{ count: number }[]>(
        `SELECT count(*)::int AS count FROM "ScheduleRuleScreen" WHERE id = '${f.bScheduleRuleScreenId}'`,
      ),
    );
    expect(ruleScreens[0].count).toBe(0);

    const ruleLocations = await withOrgTransaction(f.orgAId, (tx) =>
      tx.$queryRawUnsafe<{ count: number }[]>(
        `SELECT count(*)::int AS count FROM "ScheduleRuleLocation" WHERE id = '${f.bScheduleRuleLocationId}'`,
      ),
    );
    expect(ruleLocations[0].count).toBe(0);
  });
});

describe("tenant isolation for playback events (direct calls, no browser)", () => {
  /**
   * A range from roughly 30 days ago to tomorrow. It always covers the
   * fixture's `bPlaybackEventId`, whose `airedAt` is two days back.
   */
  function coveringRange(): AnalyticsRange {
    const now = Date.now();
    return {
      from: new Date(now - 30 * 24 * 60 * 60 * 1000),
      to: new Date(now + 24 * 60 * 60 * 1000),
    };
  }

  it("reporting as org A never sees org B's playback event, while org B does", async () => {
    const f = await setup();
    const range = coveringRange();

    const { getPlaybackSummary } = await import("@/lib/analytics/summary");
    const { getContentPerformance } = await import("@/lib/analytics/content");
    const { getCampaignProofOfPlay, getScheduleProofOfPlay } = await import(
      "@/lib/analytics/proof-of-play"
    );

    // Acting as org A: every report is empty even though the range covers
    // org B's airing.
    expect(await getPlaybackSummary(f.orgAId, range)).toEqual({
      totalPlays: 0,
      totalPlaySeconds: 0,
      reportingScreens: 0,
      distinctAssets: 0,
    });

    const contentA = await getContentPerformance(f.orgAId, range);
    expect(contentA.rows).toEqual([]);
    expect(contentA.byDay.length).toBeGreaterThan(0);
    expect(contentA.byDay.every((d) => d.plays === 0)).toBe(true);

    expect(await getCampaignProofOfPlay(f.orgAId, range)).toEqual([]);
    expect(await getScheduleProofOfPlay(f.orgAId, range)).toEqual([]);

    // Positive control: org B sees its own airing over the same range, so
    // org A's zeros are real isolation and not a broken query.
    const summaryB = await getPlaybackSummary(f.orgBId, range);
    expect(summaryB.totalPlays).toBeGreaterThanOrEqual(1);
    expect(summaryB.totalPlaySeconds).toBeGreaterThanOrEqual(1);
    expect(summaryB.reportingScreens).toBeGreaterThanOrEqual(1);
    expect(summaryB.distinctAssets).toBeGreaterThanOrEqual(1);

    const contentB = await getContentPerformance(f.orgBId, range);
    expect(contentB.rows.length).toBeGreaterThanOrEqual(1);
    expect(contentB.byDay.some((d) => d.plays >= 1)).toBe(true);

    expect((await getCampaignProofOfPlay(f.orgBId, range)).map((r) => r.id)).toContain(
      f.bCampaignId,
    );
    expect((await getScheduleProofOfPlay(f.orgBId, range)).map((r) => r.id)).toContain(
      f.bScheduleRuleId,
    );
  });

  it("withOrgTransaction(A) raw SQL sees none of B's playback event rows (RLS backstop)", async () => {
    const f = await setup();

    const rows = await withOrgTransaction(f.orgAId, (tx) =>
      tx.$queryRawUnsafe<{ count: number }[]>(
        `SELECT count(*)::int AS count FROM "PlaybackEvent" WHERE id = '${f.bPlaybackEventId}'`,
      ),
    );
    expect(rows[0].count).toBe(0);
  });

  it("ingest as an org B screen rejects a batch naming an org A screen and writes nothing", async () => {
    const f = await setup();

    const aScreen = await prisma.screen.create({
      data: {
        organizationId: f.orgAId,
        locationId: f.aLocationId,
        name: "A Screen",
        status: "UNPAIRED",
        pairingCode: "AAAA1111",
      },
    });

    const before = await prisma.playbackEvent.count();

    const { POST } = await import("@/app/api/player/events/route");
    const res = await POST(
      new NextRequest("http://localhost/api/player/events", {
        method: "POST",
        headers: { authorization: `Bearer ${f.bIngestToken}` },
        body: JSON.stringify({
          events: [
            {
              id: uid("evt"),
              screenId: aScreen.id,
              mediaAssetId: null,
              playlistId: null,
              campaignId: null,
              scheduleRuleId: null,
              source: "playlist",
              airedAt: new Date().toISOString(),
              durationSeconds: 15,
            },
          ],
        }),
      }),
    );

    expect(res.status).toBe(400);
    expect(await prisma.playbackEvent.count()).toBe(before);
  });

  it("ingest for the org B screen nulls a cross-org campaignId and leaves the org A campaign untouched", async () => {
    const f = await setup();

    const aPlaylist = await prisma.playlist.create({
      data: { organizationId: f.orgAId, name: "A Playlist" },
    });
    const aCampaign = await prisma.campaign.create({
      data: {
        organizationId: f.orgAId,
        name: "A Campaign",
        playlistId: aPlaylist.id,
        startsAt: new Date("2026-01-01T00:00:00.000Z"),
        endsAt: new Date("2026-12-31T00:00:00.000Z"),
      },
    });
    const aCampaignBefore = await prisma.campaign.findUnique({ where: { id: aCampaign.id } });

    const eventId = uid("evt");
    const { POST } = await import("@/app/api/player/events/route");
    const res = await POST(
      new NextRequest("http://localhost/api/player/events", {
        method: "POST",
        headers: { authorization: `Bearer ${f.bIngestToken}` },
        body: JSON.stringify({
          events: [
            {
              id: eventId,
              screenId: f.bIngestScreenId,
              mediaAssetId: null,
              playlistId: null,
              campaignId: aCampaign.id,
              scheduleRuleId: null,
              source: "campaign",
              airedAt: new Date().toISOString(),
              durationSeconds: 15,
            },
          ],
        }),
      }),
    );

    expect(res.status).toBe(200);

    const stored = await prisma.playbackEvent.findFirst({ where: { id: eventId } });
    expect(stored).not.toBeNull();
    expect(stored?.organizationId).toBe(f.orgBId);
    expect(stored?.screenId).toBe(f.bIngestScreenId);
    expect(stored?.campaignId).toBeNull();

    // The org A campaign is byte-for-byte what it was before the cross-org POST.
    expect(await prisma.campaign.findUnique({ where: { id: aCampaign.id } })).toEqual(
      aCampaignBefore,
    );
  });
});

describe("tenant isolation for canvas (direct calls, no browser)", () => {
  it("updateCanvas refuses a B canvas id and leaves the row byte-unchanged", async () => {
    const f = await setup();
    const before = await prisma.canvas.findUnique({ where: { id: f.bCanvasId } });

    const { updateCanvas } = await import("@/app/(app)/canvas/actions");
    const res = await callOrError(
      () => updateCanvas(f.bCanvasId, { name: "hijacked" }) as Promise<{ error?: string }>,
    );

    expect(res.error).toBeTruthy();
    const after = await prisma.canvas.findUnique({ where: { id: f.bCanvasId } });
    expect(after).toEqual(before);
    expect(after?.name).toBe("B Canvas");
    expect(after?.revision).toBe(before?.revision);
  });

  it("duplicateCanvas refuses a B canvas id and creates no canvas in either org", async () => {
    const f = await setup();
    const aBefore = await prisma.canvas.count({ where: { organizationId: f.orgAId } });
    const bBefore = await prisma.canvas.count({ where: { organizationId: f.orgBId } });

    const { duplicateCanvas } = await import("@/app/(app)/canvas/actions");
    const res = await callOrError(
      () => duplicateCanvas(f.bCanvasId) as Promise<{ error?: string }>,
    );

    expect(res.error).toBeTruthy();
    expect(await prisma.canvas.count({ where: { organizationId: f.orgAId } })).toBe(aBefore);
    expect(await prisma.canvas.count({ where: { organizationId: f.orgBId } })).toBe(bBefore);
  });

  it("archiveCanvas refuses a B canvas id and leaves the row byte-unchanged", async () => {
    const f = await setup();
    const before = await prisma.canvas.findUnique({ where: { id: f.bCanvasId } });

    const { archiveCanvas } = await import("@/app/(app)/canvas/actions");
    const res = await callOrError(
      () => archiveCanvas(f.bCanvasId) as Promise<{ error?: string }>,
    );

    expect(res.error).toBeTruthy();
    const after = await prisma.canvas.findUnique({ where: { id: f.bCanvasId } });
    expect(after).toEqual(before);
    expect(after?.archivedAt).toBeNull();
  });

  it("restoreCanvas refuses a B canvas id and leaves the row byte-unchanged", async () => {
    const f = await setup();
    await prisma.canvas.update({
      where: { id: f.bCanvasId },
      data: { archivedAt: new Date() },
    });
    const before = await prisma.canvas.findUnique({ where: { id: f.bCanvasId } });

    const { restoreCanvas } = await import("@/app/(app)/canvas/actions");
    const res = await callOrError(
      () => restoreCanvas(f.bCanvasId) as Promise<{ error?: string }>,
    );

    expect(res.error).toBeTruthy();
    const after = await prisma.canvas.findUnique({ where: { id: f.bCanvasId } });
    expect(after).toEqual(before);
    expect(after?.archivedAt).not.toBeNull();
  });

  it("deleteCanvas refuses a B canvas id and deletes nothing", async () => {
    const f = await setup();
    const before = await prisma.canvas.findUnique({ where: { id: f.bCanvasId } });

    const { deleteCanvas } = await import("@/app/(app)/canvas/actions");
    const res = await callOrError(
      () => deleteCanvas(f.bCanvasId) as Promise<{ error?: string }>,
    );

    expect(res.error).toBeTruthy();
    const after = await prisma.canvas.findUnique({ where: { id: f.bCanvasId } });
    expect(after).toEqual(before);
    expect(after).not.toBeNull();
  });

  it("createPanel refuses a B canvas id and creates no panel", async () => {
    const f = await setup();
    const before = await prisma.panel.count({ where: { canvasId: f.bCanvasId } });

    const { createPanel } = await import("@/app/(app)/canvas/actions");
    const res = await callOrError(
      () =>
        createPanel({
          canvasId: f.bCanvasId,
          x: 0,
          y: 0,
          width: 10,
          height: 10,
          zIndex: 0,
          noScroll: false,
        }) as Promise<{ error?: string }>,
    );

    expect(res.error).toBeTruthy();
    expect(await prisma.panel.count({ where: { canvasId: f.bCanvasId } })).toBe(before);
  });

  it("updatePanels refuses a B canvas id and leaves the B panel byte-unchanged", async () => {
    const f = await setup();
    const before = await prisma.panel.findUnique({ where: { id: f.bPanelId } });

    const { updatePanels } = await import("@/app/(app)/canvas/actions");
    const res = await callOrError(
      () =>
        updatePanels(f.bCanvasId, { panels: [{ id: f.bPanelId, x: 999 }] }) as Promise<{
          error?: string;
        }>,
    );

    expect(res.error).toBeTruthy();
    const after = await prisma.panel.findUnique({ where: { id: f.bPanelId } });
    expect(after).toEqual(before);
    expect(after?.x).toBe(0);
  });

  it("deletePanel refuses a B panel id and deletes nothing", async () => {
    const f = await setup();
    const before = await prisma.panel.findUnique({ where: { id: f.bPanelId } });

    const { deletePanel } = await import("@/app/(app)/canvas/actions");
    const res = await callOrError(
      () => deletePanel(f.bPanelId) as Promise<{ error?: string }>,
    );

    expect(res.error).toBeTruthy();
    const after = await prisma.panel.findUnique({ where: { id: f.bPanelId } });
    expect(after).toEqual(before);
    expect(after).not.toBeNull();
  });

  it("createFrame refuses a B panel id and creates no frame", async () => {
    const f = await setup();
    const before = await prisma.frame.count({ where: { panelId: f.bPanelId } });

    const { createFrame } = await import("@/app/(app)/canvas/actions");
    const res = await callOrError(
      () =>
        createFrame({ panelId: f.bPanelId, type: "CLOCK", durationSeconds: 5 }) as Promise<{
          error?: string;
        }>,
    );

    expect(res.error).toBeTruthy();
    expect(await prisma.frame.count({ where: { panelId: f.bPanelId } })).toBe(before);
  });

  it("reorderFrames refuses a B panel id and leaves the B frame byte-unchanged", async () => {
    const f = await setup();
    const before = await prisma.frame.findUnique({ where: { id: f.bFrameId } });

    const { reorderFrames } = await import("@/app/(app)/canvas/actions");
    const res = await callOrError(
      () =>
        reorderFrames({ panelId: f.bPanelId, frameIds: [f.bFrameId] }) as Promise<{
          error?: string;
        }>,
    );

    expect(res.error).toBeTruthy();
    const after = await prisma.frame.findUnique({ where: { id: f.bFrameId } });
    expect(after).toEqual(before);
    expect(after?.sortOrder).toBe(0);
  });

  it("setFrameDuration refuses a B frame id and leaves the row byte-unchanged", async () => {
    const f = await setup();
    const before = await prisma.frame.findUnique({ where: { id: f.bFrameId } });

    const { setFrameDuration } = await import("@/app/(app)/canvas/actions");
    const res = await callOrError(
      () =>
        setFrameDuration({ id: f.bFrameId, durationSeconds: 999 }) as Promise<{
          error?: string;
        }>,
    );

    expect(res.error).toBeTruthy();
    const after = await prisma.frame.findUnique({ where: { id: f.bFrameId } });
    expect(after).toEqual(before);
    expect(after?.durationSeconds).toBe(10);
  });

  it("deleteFrame refuses a B frame id and deletes nothing", async () => {
    const f = await setup();
    const before = await prisma.frame.findUnique({ where: { id: f.bFrameId } });

    const { deleteFrame } = await import("@/app/(app)/canvas/actions");
    const res = await callOrError(
      () => deleteFrame(f.bFrameId) as Promise<{ error?: string }>,
    );

    expect(res.error).toBeTruthy();
    const after = await prisma.frame.findUnique({ where: { id: f.bFrameId } });
    expect(after).toEqual(before);
    expect(after).not.toBeNull();
  });

  it("setWebContent refuses a B frame id and leaves the B web row byte-unchanged", async () => {
    const f = await setup();
    const before = await prisma.web.findUnique({ where: { contentId: f.bWebContentId } });

    const { setWebContent } = await import("@/app/(app)/canvas/actions");
    const res = await callOrError(
      () =>
        setWebContent({ frameId: f.bFrameId, url: "https://hijacked.test" }) as Promise<{
          error?: string;
        }>,
    );

    expect(res.error).toBeTruthy();
    const after = await prisma.web.findUnique({ where: { contentId: f.bWebContentId } });
    expect(after).toEqual(before);
    expect(after?.url).toBe("https://b-org.test");
  });

  it("setScreenContentSource refuses a B canvas id for an A screen and changes no pointer", async () => {
    const f = await setup();
    const aScreen = await prisma.screen.create({
      data: {
        organizationId: f.orgAId,
        locationId: f.aLocationId,
        name: "A Screen",
        status: "UNPAIRED",
        pairingCode: "AAAA3333",
      },
    });
    const before = await prisma.screen.findUnique({ where: { id: aScreen.id } });

    const { setScreenContentSource } = await import("@/app/(app)/screens/actions");
    const res = await callOrError(
      () =>
        setScreenContentSource({
          screenId: aScreen.id,
          source: "canvas",
          canvasId: f.bCanvasId,
        }) as Promise<{ error?: string }>,
    );

    expect(res.error).toBeTruthy();
    const after = await prisma.screen.findUnique({ where: { id: aScreen.id } });
    expect(after).toEqual(before);
    expect(after?.canvasId).toBeNull();
  });

  it("withOrgTransaction(A) raw SQL sees none of B's canvas rows (RLS backstop)", async () => {
    const f = await setup();

    const canvases = await withOrgTransaction(f.orgAId, (tx) =>
      tx.$queryRawUnsafe<{ count: number }[]>(
        `SELECT count(*)::int AS count FROM "Canvas" WHERE id = '${f.bCanvasId}'`,
      ),
    );
    expect(canvases[0].count).toBe(0);

    const panels = await withOrgTransaction(f.orgAId, (tx) =>
      tx.$queryRawUnsafe<{ count: number }[]>(
        `SELECT count(*)::int AS count FROM "Panel" WHERE id = '${f.bPanelId}'`,
      ),
    );
    expect(panels[0].count).toBe(0);

    const frames = await withOrgTransaction(f.orgAId, (tx) =>
      tx.$queryRawUnsafe<{ count: number }[]>(
        `SELECT count(*)::int AS count FROM "Frame" WHERE id = '${f.bFrameId}'`,
      ),
    );
    expect(frames[0].count).toBe(0);

    const webRows = await withOrgTransaction(f.orgAId, (tx) =>
      tx.$queryRawUnsafe<{ count: number }[]>(
        `SELECT count(*)::int AS count FROM "Web" WHERE "contentId" = '${f.bWebContentId}'`,
      ),
    );
    expect(webRows[0].count).toBe(0);
  });
});
