import { describe, it, expect, vi, beforeEach } from "vitest";

import { prisma } from "@/lib/db/root";
import { forOrg } from "@/lib/db/tenant";
import { resetDb, seedPlans } from "@/test/helpers/db";
import { NotFoundError } from "@/lib/errors";

/**
 * Integration coverage for the playlist CRUD actions against the real dev
 * database. `requireRole` / `requireOrg` are mocked to a module-scope `ctx`
 * bound to a freshly created organization and user in `beforeEach`;
 * `revalidatePath` is a no-op.
 */

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
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

beforeEach(async () => {
  await resetDb();
  await seedPlans();

  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const org = await prisma.organization.create({
    data: { name: "Playlists Org", slug: `playlists-${suffix}` },
  });
  const user = await prisma.user.create({
    data: { email: `playlists-${suffix}@test.local`, name: "Tester" },
  });

  ctx.organizationId = org.id;
  ctx.user = { id: user.id, email: user.email, isSuperAdmin: false };
  ctx.db = forOrg(org.id);
});

async function makePlaylist(name = "Lobby") {
  const { createPlaylist } = await import("@/app/(app)/playlists/actions");
  const res = await createPlaylist({ name });
  if ("error" in res) throw new Error(res.error);
  return res.id;
}

describe("createPlaylist", () => {
  it("creates a playlist at revision 1 with the creator recorded and audits it", async () => {
    const { createPlaylist } = await import("@/app/(app)/playlists/actions");

    const res = await createPlaylist({ name: "Lobby" });

    expect("error" in res).toBe(false);
    if ("error" in res) throw new Error(res.error);

    const row = await prisma.playlist.findUnique({ where: { id: res.id } });
    expect(row?.name).toBe("Lobby");
    expect(row?.revision).toBe(1);
    expect(row?.organizationId).toBe(ctx.organizationId);
    expect(row?.createdByUserId).toBe(ctx.user.id);

    const audit = await prisma.auditLog.findFirst({
      where: { action: "playlist.create", targetId: res.id },
    });
    expect(audit).not.toBeNull();
  });

  it("rejects a blank name and writes no row", async () => {
    const { createPlaylist } = await import("@/app/(app)/playlists/actions");

    const res = await createPlaylist({ name: "   " });

    expect("error" in res && res.error).toBeTruthy();
    expect(await prisma.playlist.count({ where: { organizationId: ctx.organizationId } })).toBe(0);
  });
});

describe("updatePlaylist", () => {
  it("applies the patch and bumps revision to 2", async () => {
    const id = await makePlaylist();
    const { updatePlaylist } = await import("@/app/(app)/playlists/actions");

    const res = await updatePlaylist(id, { defaultImageDurationSeconds: 20 });

    expect(res).toEqual({});
    const row = await prisma.playlist.findUnique({ where: { id } });
    expect(row?.defaultImageDurationSeconds).toBe(20);
    expect(row?.revision).toBe(2);
  });

  it("throws NotFoundError for an id that does not resolve", async () => {
    const { updatePlaylist } = await import("@/app/(app)/playlists/actions");

    await expect(updatePlaylist("does-not-exist", { name: "x" })).rejects.toThrow(NotFoundError);
  });
});

describe("archivePlaylist / restorePlaylist", () => {
  it("archives without touching revision, then restores", async () => {
    const id = await makePlaylist();
    const { updatePlaylist, archivePlaylist, restorePlaylist } = await import(
      "@/app/(app)/playlists/actions"
    );

    await updatePlaylist(id, { defaultImageDurationSeconds: 20 });

    const archived = await archivePlaylist(id);
    expect(archived).toEqual({});
    let row = await prisma.playlist.findUnique({ where: { id } });
    expect(row?.archivedAt).not.toBeNull();
    expect(row?.revision).toBe(2);

    const restored = await restorePlaylist(id);
    expect(restored).toEqual({});
    row = await prisma.playlist.findUnique({ where: { id } });
    expect(row?.archivedAt).toBeNull();
    expect(row?.revision).toBe(2);
  });
});

describe("deletePlaylist", () => {
  it("removes the row", async () => {
    const id = await makePlaylist();
    const { deletePlaylist } = await import("@/app/(app)/playlists/actions");

    const res = await deletePlaylist(id);

    expect(res).toEqual({});
    expect(await prisma.playlist.findUnique({ where: { id } })).toBeNull();
  });

  it("refuses to delete a playlist that a campaign uses", async () => {
    const plId = await makePlaylist();
    const { deletePlaylist } = await import("@/app/(app)/playlists/actions");

    await prisma.campaign.create({
      data: {
        organizationId: ctx.organizationId,
        name: "C",
        playlistId: plId,
        startsAt: new Date("2026-01-01T00:00:00.000Z"),
        endsAt: new Date("2026-12-31T00:00:00.000Z"),
      },
    });

    const res = await deletePlaylist(plId);

    expect("error" in res).toBe(true);
    expect(res.error).toContain("campaign");
    expect(await prisma.playlist.findUnique({ where: { id: plId } })).not.toBeNull();
  });

  it("refuses to delete a playlist that a schedule rule uses", async () => {
    const plId = await makePlaylist();
    const { deletePlaylist } = await import("@/app/(app)/playlists/actions");

    await prisma.scheduleRule.create({
      data: {
        organizationId: ctx.organizationId,
        name: "Morning",
        playlistId: plId,
        daysOfWeek: [0, 1, 2, 3, 4],
        startMinute: 480,
        endMinute: 1080,
      },
    });

    const res = await deletePlaylist(plId);

    expect("error" in res).toBe(true);
    expect(res.error).toBe("That playlist is used by a schedule rule. Remove it from the schedule first.");
    expect(await prisma.playlist.findUnique({ where: { id: plId } })).not.toBeNull();
  });

  it("allows deleting a playlist after removing the schedule rule that used it", async () => {
    const plId = await makePlaylist();
    const { deletePlaylist } = await import("@/app/(app)/playlists/actions");

    const rule = await prisma.scheduleRule.create({
      data: {
        organizationId: ctx.organizationId,
        name: "Morning",
        playlistId: plId,
        daysOfWeek: [0, 1, 2, 3, 4],
        startMinute: 480,
        endMinute: 1080,
      },
    });

    let res = await deletePlaylist(plId);
    expect("error" in res).toBe(true);

    await prisma.scheduleRule.delete({ where: { id: rule.id } });

    res = await deletePlaylist(plId);
    expect(res).toEqual({});
    expect(await prisma.playlist.findUnique({ where: { id: plId } })).toBeNull();
  });
});

async function makeAsset(
  name: string,
  over: { status?: "READY" | "FAILED" | "UPLOADING"; archivedAt?: Date } = {},
) {
  const asset = await prisma.mediaAsset.create({
    data: {
      organizationId: ctx.organizationId,
      kind: "IMAGE",
      status: over.status ?? "READY",
      name,
      sizeBytes: BigInt(1),
      archivedAt: over.archivedAt ?? null,
    },
  });
  return asset.id;
}

async function itemsByPosition(playlistId: string) {
  return prisma.playlistItem.findMany({
    where: { playlistId },
    orderBy: { position: "asc" },
  });
}

async function revisionOf(playlistId: string) {
  const row = await prisma.playlist.findUnique({ where: { id: playlistId } });
  return row?.revision;
}

describe("addItems", () => {
  it("appends assets in order at positions 0..n-1 and bumps revision once", async () => {
    const pl = await makePlaylist();
    const { addItems } = await import("@/app/(app)/playlists/actions");
    const a = await makeAsset("A");
    const b = await makeAsset("B");
    const c = await makeAsset("C");

    const res = await addItems(pl, { mediaAssetIds: [a, b, c] });
    expect(res).toEqual({ added: 3 });

    const rows = await itemsByPosition(pl);
    expect(rows.map((r) => r.position)).toEqual([0, 1, 2]);
    expect(rows.map((r) => r.mediaAssetId)).toEqual([a, b, c]);
    expect(rows.every((r) => r.enabled === true && r.durationSeconds === null)).toBe(true);
    expect(await revisionOf(pl)).toBe(2);

    const audit = await prisma.auditLog.findFirst({
      where: { action: "playlist.items.add", targetId: pl },
    });
    expect(audit?.metadata).toMatchObject({ count: 3 });
  });

  it("appends a second batch after the existing items", async () => {
    const pl = await makePlaylist();
    const { addItems } = await import("@/app/(app)/playlists/actions");
    await addItems(pl, {
      mediaAssetIds: [await makeAsset("A"), await makeAsset("B"), await makeAsset("C")],
    });

    const d = await makeAsset("D");
    const res = await addItems(pl, { mediaAssetIds: [d] });
    expect(res).toEqual({ added: 1 });

    const rows = await itemsByPosition(pl);
    expect(rows.map((r) => r.position)).toEqual([0, 1, 2, 3]);
    expect(rows[3].mediaAssetId).toBe(d);
    expect(await revisionOf(pl)).toBe(3);
  });

  it("rejects an archived asset and writes nothing", async () => {
    const pl = await makePlaylist();
    const { addItems } = await import("@/app/(app)/playlists/actions");
    const archived = await makeAsset("Arch", { archivedAt: new Date() });

    const res = await addItems(pl, { mediaAssetIds: [archived] });
    expect("error" in res).toBe(true);
    expect(await prisma.playlistItem.count({ where: { playlistId: pl } })).toBe(0);
    expect(await revisionOf(pl)).toBe(1);
  });

  it("rejects a not-ready asset and writes nothing", async () => {
    const pl = await makePlaylist();
    const { addItems } = await import("@/app/(app)/playlists/actions");
    const failed = await makeAsset("Fail", { status: "FAILED" });

    const res = await addItems(pl, { mediaAssetIds: [failed] });
    expect("error" in res).toBe(true);
    expect(await prisma.playlistItem.count({ where: { playlistId: pl } })).toBe(0);
  });

  it("allows the same asset to appear more than once in a batch", async () => {
    const pl = await makePlaylist();
    const { addItems } = await import("@/app/(app)/playlists/actions");
    const a = await makeAsset("A");

    const res = await addItems(pl, { mediaAssetIds: [a, a] });
    expect(res).toEqual({ added: 2 });

    const rows = await itemsByPosition(pl);
    expect(rows.map((r) => r.position)).toEqual([0, 1]);
    expect(rows.map((r) => r.mediaAssetId)).toEqual([a, a]);
  });

  it("rejects a batch containing an id that does not exist and writes nothing", async () => {
    const pl = await makePlaylist();
    const { addItems } = await import("@/app/(app)/playlists/actions");
    const a = await makeAsset("A");
    const b = await makeAsset("B");

    const res = await addItems(pl, { mediaAssetIds: [a, "does-not-exist", b] });
    expect("error" in res).toBe(true);
    expect(await prisma.playlistItem.count({ where: { playlistId: pl } })).toBe(0);
    expect(await revisionOf(pl)).toBe(1);
  });

  it("writes nothing when only one asset in the batch is unavailable", async () => {
    const pl = await makePlaylist();
    const { addItems } = await import("@/app/(app)/playlists/actions");
    const good = await makeAsset("Good");
    const archived = await makeAsset("Arch", { archivedAt: new Date() });

    const res = await addItems(pl, { mediaAssetIds: [good, archived] });
    expect("error" in res).toBe(true);
    expect(await prisma.playlistItem.count({ where: { playlistId: pl } })).toBe(0);
    expect(await revisionOf(pl)).toBe(1);
  });
});

describe("reorderItems", () => {
  it("permutes positions to match the given order and bumps revision", async () => {
    const pl = await makePlaylist();
    const { addItems, reorderItems } = await import("@/app/(app)/playlists/actions");
    await addItems(pl, {
      mediaAssetIds: [await makeAsset("A"), await makeAsset("B"), await makeAsset("C")],
    });
    const [id0, id1, id2] = (await itemsByPosition(pl)).map((r) => r.id);

    const res = await reorderItems(pl, { itemIds: [id2, id0, id1] });
    expect(res).toEqual({});

    const pos = Object.fromEntries((await itemsByPosition(pl)).map((r) => [r.id, r.position]));
    expect(pos[id2]).toBe(0);
    expect(pos[id0]).toBe(1);
    expect(pos[id1]).toBe(2);
    expect(await revisionOf(pl)).toBe(3);
  });

  it("rejects a set missing an item and leaves positions untouched", async () => {
    const pl = await makePlaylist();
    const { addItems, reorderItems } = await import("@/app/(app)/playlists/actions");
    await addItems(pl, {
      mediaAssetIds: [await makeAsset("A"), await makeAsset("B"), await makeAsset("C")],
    });
    const [id0, id1] = (await itemsByPosition(pl)).map((r) => r.id);

    const res = await reorderItems(pl, { itemIds: [id0, id1] });
    expect(res).toEqual({ error: "That reorder does not match the playlist." });
    expect((await itemsByPosition(pl)).map((r) => r.position)).toEqual([0, 1, 2]);
    expect(await revisionOf(pl)).toBe(2);
  });

  it("rejects a set with a duplicated id and leaves positions untouched", async () => {
    const pl = await makePlaylist();
    const { addItems, reorderItems } = await import("@/app/(app)/playlists/actions");
    await addItems(pl, {
      mediaAssetIds: [await makeAsset("A"), await makeAsset("B"), await makeAsset("C")],
    });
    const [id0, id1, id2] = (await itemsByPosition(pl)).map((r) => r.id);

    const res = await reorderItems(pl, { itemIds: [id0, id1, id2, id2] });
    expect(res).toEqual({ error: "That reorder does not match the playlist." });
    expect((await itemsByPosition(pl)).map((r) => r.position)).toEqual([0, 1, 2]);
    expect(await revisionOf(pl)).toBe(2);
  });

  it("rejects a set with an unknown id", async () => {
    const pl = await makePlaylist();
    const { addItems, reorderItems } = await import("@/app/(app)/playlists/actions");
    await addItems(pl, {
      mediaAssetIds: [await makeAsset("A"), await makeAsset("B"), await makeAsset("C")],
    });
    const [id0, id1] = (await itemsByPosition(pl)).map((r) => r.id);

    const res = await reorderItems(pl, { itemIds: [id0, id1, "bogus"] });
    expect(res).toEqual({ error: "That reorder does not match the playlist." });
    expect((await itemsByPosition(pl)).map((r) => r.position)).toEqual([0, 1, 2]);
  });
});

describe("removeItem", () => {
  it("deletes the row and compacts remaining positions with no gap", async () => {
    const pl = await makePlaylist();
    const { addItems, removeItem } = await import("@/app/(app)/playlists/actions");
    await addItems(pl, {
      mediaAssetIds: [await makeAsset("A"), await makeAsset("B"), await makeAsset("C")],
    });
    const [id0, id1, id2] = (await itemsByPosition(pl)).map((r) => r.id);

    const res = await removeItem(id1);
    expect(res).toEqual({});
    expect(await prisma.playlistItem.findUnique({ where: { id: id1 } })).toBeNull();

    const rows = await itemsByPosition(pl);
    expect(rows.map((r) => r.id)).toEqual([id0, id2]);
    expect(rows.map((r) => r.position)).toEqual([0, 1]);
    expect(await revisionOf(pl)).toBe(3);
  });

  it("throws NotFoundError for an item that does not resolve", async () => {
    const { removeItem } = await import("@/app/(app)/playlists/actions");
    await expect(removeItem("does-not-exist")).rejects.toThrow(NotFoundError);
  });
});

describe("setItemDuration / setItemEnabled", () => {
  it("sets then clears the duration and bumps revision each time", async () => {
    const pl = await makePlaylist();
    const { addItems, setItemDuration } = await import("@/app/(app)/playlists/actions");
    await addItems(pl, { mediaAssetIds: [await makeAsset("A")] });
    const id = (await itemsByPosition(pl))[0].id;

    expect(await setItemDuration(id, { durationSeconds: 25 })).toEqual({});
    expect((await prisma.playlistItem.findUnique({ where: { id } }))?.durationSeconds).toBe(25);
    expect(await revisionOf(pl)).toBe(3);

    expect(await setItemDuration(id, { durationSeconds: null })).toEqual({});
    expect((await prisma.playlistItem.findUnique({ where: { id } }))?.durationSeconds).toBeNull();
    expect(await revisionOf(pl)).toBe(4);
  });

  it("toggles enabled and bumps revision", async () => {
    const pl = await makePlaylist();
    const { addItems, setItemEnabled } = await import("@/app/(app)/playlists/actions");
    await addItems(pl, { mediaAssetIds: [await makeAsset("A")] });
    const id = (await itemsByPosition(pl))[0].id;

    expect(await setItemEnabled(id, false)).toEqual({});
    expect((await prisma.playlistItem.findUnique({ where: { id } }))?.enabled).toBe(false);
    expect(await revisionOf(pl)).toBe(3);
  });
});

describe("assignPlaylistToScreen", () => {
  async function makeScreen() {
    const loc = await prisma.location.create({
      data: { organizationId: ctx.organizationId, name: "Site" },
    });
    return prisma.screen.create({
      data: {
        organizationId: ctx.organizationId,
        locationId: loc.id,
        name: "S1",
        status: "UNPAIRED",
        pairingCode: "ABCD1234",
      },
    });
  }

  it("sets the screen's playlist without touching the playlist revision and audits it", async () => {
    const pl = await makePlaylist();
    const screen = await makeScreen();
    const { assignPlaylistToScreen } = await import("@/app/(app)/playlists/actions");

    const res = await assignPlaylistToScreen(screen.id, pl);
    expect(res).toEqual({});

    const row = await prisma.screen.findUnique({ where: { id: screen.id } });
    expect(row?.playlistId).toBe(pl);
    expect(await revisionOf(pl)).toBe(1);

    const audit = await prisma.auditLog.findFirst({
      where: { action: "screen.playlist.assign", targetId: screen.id },
    });
    expect(audit).not.toBeNull();
  });

  it("clears the assignment when given null", async () => {
    const pl = await makePlaylist();
    const screen = await makeScreen();
    const { assignPlaylistToScreen } = await import("@/app/(app)/playlists/actions");

    await assignPlaylistToScreen(screen.id, pl);
    const res = await assignPlaylistToScreen(screen.id, null);
    expect(res).toEqual({});

    const row = await prisma.screen.findUnique({ where: { id: screen.id } });
    expect(row?.playlistId).toBeNull();
  });

  it("clears a canvas assignment when a playlist is assigned", async () => {
    const pl = await makePlaylist();
    const screen = await makeScreen();
    const canvas = await prisma.canvas.create({
      data: {
        organizationId: ctx.organizationId,
        name: "Lobby Board",
        width: 1920,
        height: 1080,
      },
    });
    await prisma.screen.update({
      where: { id: screen.id },
      data: { canvasId: canvas.id },
    });
    const { assignPlaylistToScreen } = await import("@/app/(app)/playlists/actions");

    const res = await assignPlaylistToScreen(screen.id, pl);
    expect(res).toEqual({});

    // `playlistId` and `canvasId` are mutually exclusive, and the resolver
    // checks the canvas first, so a leftover canvas would keep winning.
    const row = await prisma.screen.findUnique({ where: { id: screen.id } });
    expect(row?.playlistId).toBe(pl);
    expect(row?.canvasId).toBeNull();
  });

  it("leaves a canvas assignment alone when the playlist is cleared", async () => {
    const screen = await makeScreen();
    const canvas = await prisma.canvas.create({
      data: {
        organizationId: ctx.organizationId,
        name: "Portrait Menu",
        width: 1080,
        height: 1920,
      },
    });
    await prisma.screen.update({
      where: { id: screen.id },
      data: { canvasId: canvas.id },
    });
    const { assignPlaylistToScreen } = await import("@/app/(app)/playlists/actions");

    await assignPlaylistToScreen(screen.id, null);

    const row = await prisma.screen.findUnique({ where: { id: screen.id } });
    expect(row?.playlistId).toBeNull();
    expect(row?.canvasId).toBe(canvas.id);
  });

  it("rejects an archived playlist and leaves the screen unchanged", async () => {
    const pl = await makePlaylist();
    const screen = await makeScreen();
    const { archivePlaylist, assignPlaylistToScreen } = await import(
      "@/app/(app)/playlists/actions"
    );
    await archivePlaylist(pl);

    const res = await assignPlaylistToScreen(screen.id, pl);
    expect("error" in res && res.error).toBeTruthy();

    const row = await prisma.screen.findUnique({ where: { id: screen.id } });
    expect(row?.playlistId).toBeNull();
  });

  it("returns an error for a screen that does not resolve", async () => {
    const pl = await makePlaylist();
    const { assignPlaylistToScreen } = await import("@/app/(app)/playlists/actions");

    const res = await assignPlaylistToScreen("no-such-screen", pl);
    expect("error" in res && res.error).toBeTruthy();
  });
});

describe("playlist item position invariant", () => {
  it("keeps positions a dense 0..n-1 range through a full sequence of edits", async () => {
    const pl = await makePlaylist();
    const { addItems, removeItem, reorderItems, setItemDuration, setItemEnabled } = await import(
      "@/app/(app)/playlists/actions"
    );

    const assets: string[] = [];
    for (const n of ["A", "B", "C", "D", "E"]) assets.push(await makeAsset(n));
    await addItems(pl, { mediaAssetIds: assets.slice(0, 3) });
    await addItems(pl, { mediaAssetIds: assets.slice(3) });

    const ids = (await itemsByPosition(pl)).map((r) => r.id);
    await reorderItems(pl, { itemIds: [ids[4], ids[0], ids[2], ids[1], ids[3]] });
    await removeItem(ids[2]);
    await setItemDuration(ids[0], { durationSeconds: 12 });
    await setItemDuration(ids[0], { durationSeconds: null });
    await setItemEnabled(ids[1], false);
    await removeItem(ids[4]);

    const positions = (await itemsByPosition(pl)).map((r) => r.position);
    expect(positions).toEqual(positions.map((_, i) => i));
    expect(new Set(positions).size).toBe(positions.length);
  });
});
