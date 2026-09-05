import { describe, it, expect, vi, beforeEach } from "vitest";

import { prisma } from "@/lib/db/root";
import { forOrg } from "@/lib/db/tenant";
import { resetDb, seedPlans } from "@/test/helpers/db";

/**
 * Integration coverage for the canvas-level CRUD actions against the real dev
 * database. `requireRole` / `requireOrg` are mocked to a module-scope `ctx`
 * bound to a freshly created organization and OWNER user in `beforeEach`;
 * `revalidatePath` and `redirect` are no-ops.
 */

const ctx: {
  user: { id: string; email: string; isSuperAdmin: boolean };
  organizationId: string;
  role: "OWNER";
  actor: never;
  db: ReturnType<typeof forOrg>;
} = {
  user: { id: "", email: "", isSuperAdmin: false },
  organizationId: "",
  role: "OWNER",
  actor: {} as never,
  db: {} as never,
};

vi.mock("@/lib/auth/context", () => ({
  requireRole: async () => ctx,
  requireOrg: async () => ctx,
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

let imageAssetId = "";

beforeEach(async () => {
  await resetDb();
  await seedPlans();

  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const org = await prisma.organization.create({
    data: { name: "Canvas Org", slug: `canvas-${suffix}` },
  });
  const user = await prisma.user.create({
    data: { email: `canvas-${suffix}@test.local`, name: "Tester" },
  });
  const image = await prisma.mediaAsset.create({
    data: {
      organizationId: org.id,
      kind: "IMAGE",
      status: "READY",
      name: "Backdrop",
    },
  });

  ctx.organizationId = org.id;
  ctx.user = { id: user.id, email: user.email, isSuperAdmin: false };
  ctx.db = forOrg(org.id);
  imageAssetId = image.id;
});

async function makeCanvas(over: { name?: string } = {}) {
  const { createCanvas } = await import("@/app/(app)/canvas/actions");
  const res = await createCanvas({
    name: over.name ?? "Lobby",
    width: 1920,
    height: 1080,
  });
  if ("error" in res) throw new Error(res.error);
  return res.id;
}

describe("createCanvas", () => {
  it("creates a canvas at revision 1 and audits it", async () => {
    const { createCanvas } = await import("@/app/(app)/canvas/actions");

    const res = await createCanvas({ name: "Lobby", width: 1920, height: 1080 });

    expect("error" in res).toBe(false);
    if ("error" in res) throw new Error(res.error);

    const row = await prisma.canvas.findUnique({ where: { id: res.id } });
    expect(row?.name).toBe("Lobby");
    expect(row?.revision).toBe(1);
    expect(row?.organizationId).toBe(ctx.organizationId);

    const audit = await prisma.auditLog.findFirst({
      where: { action: "canvas.create", targetId: res.id },
    });
    expect(audit).not.toBeNull();
  });

  it("rejects a background image that is a video or is not ready and writes no row", async () => {
    const video = await prisma.mediaAsset.create({
      data: {
        organizationId: ctx.organizationId,
        kind: "VIDEO",
        status: "READY",
        name: "Clip",
      },
    });
    const pending = await prisma.mediaAsset.create({
      data: {
        organizationId: ctx.organizationId,
        kind: "IMAGE",
        status: "UPLOADING",
        name: "Half",
      },
    });
    const { createCanvas } = await import("@/app/(app)/canvas/actions");

    const asVideo = await createCanvas({
      name: "A",
      width: 1920,
      height: 1080,
      backgroundImageId: video.id,
    });
    const asPending = await createCanvas({
      name: "B",
      width: 1920,
      height: 1080,
      backgroundImageId: pending.id,
    });

    expect("error" in asVideo && asVideo.error).toBeTruthy();
    expect("error" in asPending && asPending.error).toBeTruthy();
    expect(
      await prisma.canvas.count({ where: { organizationId: ctx.organizationId } }),
    ).toBe(0);
  });
});

describe("updateCanvas", () => {
  it("applies a width change and bumps revision to 2", async () => {
    const id = await makeCanvas();
    const { updateCanvas } = await import("@/app/(app)/canvas/actions");

    const res = await updateCanvas(id, { width: 1280 });

    expect("error" in res).toBe(false);
    const row = await prisma.canvas.findUnique({ where: { id } });
    expect(row?.width).toBe(1280);
    expect(row?.revision).toBe(2);

    const panels = await prisma.panel.count({ where: { canvasId: id } });
    expect(panels).toBe(0);
  });

  it("serializes two concurrent edits and lands on revision 3 with one consistent row", async () => {
    const id = await makeCanvas();
    const { updateCanvas } = await import("@/app/(app)/canvas/actions");

    await Promise.all([
      updateCanvas(id, { width: 800 }),
      updateCanvas(id, { width: 900 }),
    ]);

    const row = await prisma.canvas.findUnique({ where: { id } });
    expect(row?.revision).toBe(3);
    expect([800, 900]).toContain(row?.width);
  });
});

describe("duplicateCanvas", () => {
  it("deep copies panels, frames, content and typed rows with fresh ids", async () => {
    const src = await prisma.canvas.create({
      data: { organizationId: ctx.organizationId, name: "Src", width: 1920, height: 1080 },
    });
    const p1 = await prisma.panel.create({
      data: {
        organizationId: ctx.organizationId,
        canvasId: src.id,
        x: 0,
        y: 0,
        width: 960,
        height: 1080,
        zIndex: 0,
      },
    });
    const p2 = await prisma.panel.create({
      data: {
        organizationId: ctx.organizationId,
        canvasId: src.id,
        name: "Right",
        x: 960,
        y: 0,
        width: 960,
        height: 1080,
        zIndex: 1,
        noScroll: true,
      },
    });

    const f1 = await prisma.frame.create({
      data: {
        organizationId: ctx.organizationId,
        panelId: p1.id,
        sortOrder: 0,
        durationSeconds: 10,
        type: "MEMO",
      },
    });
    const c1 = await prisma.content.create({
      data: { organizationId: ctx.organizationId, frameId: f1.id, name: "Memo one" },
    });
    await prisma.memo.create({
      data: { organizationId: ctx.organizationId, contentId: c1.id, body: "Hello from memo" },
    });

    const f2 = await prisma.frame.create({
      data: {
        organizationId: ctx.organizationId,
        panelId: p1.id,
        sortOrder: 1,
        durationSeconds: 15,
        type: "WEB",
      },
    });
    const c2 = await prisma.content.create({
      data: { organizationId: ctx.organizationId, frameId: f2.id },
    });
    await prisma.web.create({
      data: {
        organizationId: ctx.organizationId,
        contentId: c2.id,
        url: "https://example.com/board",
      },
    });

    const f3 = await prisma.frame.create({
      data: {
        organizationId: ctx.organizationId,
        panelId: p2.id,
        sortOrder: 0,
        durationSeconds: 20,
        type: "PICTURE",
      },
    });
    const c3 = await prisma.content.create({
      data: { organizationId: ctx.organizationId, frameId: f3.id },
    });
    await prisma.picture.create({
      data: {
        organizationId: ctx.organizationId,
        contentId: c3.id,
        mediaAssetId: imageAssetId,
        mode: "cover",
      },
    });

    const { duplicateCanvas } = await import("@/app/(app)/canvas/actions");
    const res = await duplicateCanvas(src.id);

    expect("error" in res).toBe(false);
    if ("error" in res) throw new Error(res.error);
    expect(res.id).not.toBe(src.id);

    const copy = await prisma.canvas.findUnique({ where: { id: res.id } });
    expect(copy?.name).toBe("Src copy");
    expect(copy?.revision).toBe(1);
    expect(copy?.width).toBe(1920);
    expect(copy?.height).toBe(1080);

    const copyPanels = await prisma.panel.findMany({
      where: { canvasId: res.id },
      orderBy: { zIndex: "asc" },
    });
    expect(copyPanels).toHaveLength(2);
    expect(copyPanels.some((p) => [p1.id, p2.id].includes(p.id))).toBe(false);
    expect(copyPanels[1]?.name).toBe("Right");
    expect(copyPanels[1]?.noScroll).toBe(true);

    const copyFrames = await prisma.frame.findMany({
      where: { panelId: { in: copyPanels.map((p) => p.id) } },
    });
    expect(copyFrames).toHaveLength(3);
    expect(copyFrames.some((f) => [f1.id, f2.id, f3.id].includes(f.id))).toBe(false);

    const copyContents = await prisma.content.findMany({
      where: { frameId: { in: copyFrames.map((f) => f.id) } },
      include: { memo: true, web: true, picture: true },
    });
    expect(copyContents).toHaveLength(3);
    expect(copyContents.some((c) => [c1.id, c2.id, c3.id].includes(c.id))).toBe(false);

    const memo = copyContents.find((c) => c.memo);
    expect(memo?.memo?.body).toBe("Hello from memo");
    const web = copyContents.find((c) => c.web);
    expect(web?.web?.url).toBe("https://example.com/board");
    const pic = copyContents.find((c) => c.picture);
    expect(pic?.picture?.mediaAssetId).toBe(imageAssetId);

    const audit = await prisma.auditLog.findFirst({
      where: { action: "canvas.duplicate", targetId: res.id },
    });
    expect(audit).not.toBeNull();

    const original = await prisma.canvas.findUnique({ where: { id: src.id } });
    expect(original?.revision).toBe(1);
    expect(await prisma.panel.count({ where: { canvasId: src.id } })).toBe(2);
  });
});

describe("archiveCanvas / restoreCanvas", () => {
  it("archives and restores without touching revision", async () => {
    const id = await makeCanvas();
    const { updateCanvas, archiveCanvas, restoreCanvas } = await import(
      "@/app/(app)/canvas/actions"
    );

    await updateCanvas(id, { width: 1280 });

    const archived = await archiveCanvas(id);
    expect(archived).toEqual({ ok: true });
    let row = await prisma.canvas.findUnique({ where: { id } });
    expect(row?.archivedAt).not.toBeNull();
    expect(row?.revision).toBe(2);

    const restored = await restoreCanvas(id);
    expect(restored).toEqual({ ok: true });
    row = await prisma.canvas.findUnique({ where: { id } });
    expect(row?.archivedAt).toBeNull();
    expect(row?.revision).toBe(2);
  });
});

describe("deleteCanvas", () => {
  it("refuses while a screen points at it, then cascade-deletes once freed", async () => {
    const id = await makeCanvas();

    const panel = await prisma.panel.create({
      data: {
        organizationId: ctx.organizationId,
        canvasId: id,
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        zIndex: 0,
      },
    });
    const frame = await prisma.frame.create({
      data: {
        organizationId: ctx.organizationId,
        panelId: panel.id,
        sortOrder: 0,
        durationSeconds: 10,
        type: "MEMO",
      },
    });
    const content = await prisma.content.create({
      data: { organizationId: ctx.organizationId, frameId: frame.id },
    });
    await prisma.memo.create({
      data: { organizationId: ctx.organizationId, contentId: content.id, body: "x" },
    });

    const location = await prisma.location.create({
      data: { organizationId: ctx.organizationId, name: "Lobby" },
    });
    const screen = await prisma.screen.create({
      data: {
        organizationId: ctx.organizationId,
        locationId: location.id,
        name: "Screen 1",
        canvasId: id,
      },
    });

    const { deleteCanvas } = await import("@/app/(app)/canvas/actions");

    const blocked = await deleteCanvas(id);
    expect(blocked).toEqual({
      error: "That canvas is assigned to 1 screen. Change their content source first.",
    });
    expect(await prisma.canvas.findUnique({ where: { id } })).not.toBeNull();

    await prisma.screen.update({ where: { id: screen.id }, data: { canvasId: null } });

    const ok = await deleteCanvas(id);
    expect(ok).toEqual({ ok: true });
    expect(await prisma.canvas.findUnique({ where: { id } })).toBeNull();
    expect(await prisma.panel.findUnique({ where: { id: panel.id } })).toBeNull();
    expect(await prisma.frame.findUnique({ where: { id: frame.id } })).toBeNull();
    expect(await prisma.content.findUnique({ where: { id: content.id } })).toBeNull();
    expect(await prisma.memo.findUnique({ where: { contentId: content.id } })).toBeNull();
  });
});

async function revisionOf(id: string): Promise<number> {
  const row = await prisma.canvas.findUnique({
    where: { id },
    select: { revision: true },
  });
  if (!row) throw new Error("canvas row is gone");
  return row.revision;
}

async function seedPanel(canvasId: string, over: Record<string, unknown> = {}) {
  return prisma.panel.create({
    data: {
      organizationId: ctx.organizationId,
      canvasId,
      x: 0,
      y: 0,
      width: 200,
      height: 200,
      zIndex: 0,
      ...over,
    },
  });
}

async function makeCanvasWithPanel() {
  const canvasId = await makeCanvas();
  const panel = await seedPanel(canvasId);
  return { canvasId, panelId: panel.id };
}

describe("createPanel", () => {
  it("creates a panel and bumps the canvas revision by one", async () => {
    const canvasId = await makeCanvas();
    const before = await revisionOf(canvasId);
    const { createPanel } = await import("@/app/(app)/canvas/actions");

    const res = await createPanel({
      canvasId,
      name: "Left",
      x: 10,
      y: 20,
      width: 300,
      height: 400,
      zIndex: 2,
      noScroll: true,
    });

    expect("error" in res).toBe(false);
    if ("error" in res) throw new Error(res.error);

    const row = await prisma.panel.findUnique({ where: { id: res.id } });
    expect(row?.canvasId).toBe(canvasId);
    expect(row?.name).toBe("Left");
    expect(row?.x).toBe(10);
    expect(row?.noScroll).toBe(true);
    expect(await revisionOf(canvasId)).toBe(before + 1);

    const audit = await prisma.auditLog.findFirst({
      where: { action: "panel.create", targetId: res.id },
    });
    expect(audit?.targetType).toBe("Panel");
  });

  it("rejects a canvas id that does not resolve and writes no panel", async () => {
    const { createPanel } = await import("@/app/(app)/canvas/actions");

    const res = await createPanel({
      canvasId: "clzzzzzzzzzzzzzzzzzzzzzzzz",
      x: 0,
      y: 0,
      width: 10,
      height: 10,
      zIndex: 0,
      noScroll: false,
    });

    expect("error" in res).toBe(true);
    expect(await prisma.panel.count()).toBe(0);
  });
});

describe("updatePanels", () => {
  it("applies two panels' geometry in one call and bumps the revision exactly once", async () => {
    const canvasId = await makeCanvas();
    const a = await seedPanel(canvasId, { x: 0, zIndex: 0 });
    const b = await seedPanel(canvasId, { x: 200, zIndex: 1 });
    const before = await revisionOf(canvasId);
    const { updatePanels } = await import("@/app/(app)/canvas/actions");

    const res = await updatePanels(canvasId, {
      panels: [
        { id: a.id, x: 5, y: 6 },
        { id: b.id, width: 250, noScroll: true },
      ],
    });

    expect(res).toEqual({ ok: true });
    const ra = await prisma.panel.findUnique({ where: { id: a.id } });
    const rb = await prisma.panel.findUnique({ where: { id: b.id } });
    expect(ra?.x).toBe(5);
    expect(ra?.y).toBe(6);
    expect(rb?.width).toBe(250);
    expect(rb?.noScroll).toBe(true);
    expect(await revisionOf(canvasId)).toBe(before + 1);
  });

  it("rejects a batch that names a panel from another canvas and changes nothing", async () => {
    const canvasId = await makeCanvas();
    const mine = await seedPanel(canvasId);
    const otherCanvasId = await makeCanvas({ name: "Other" });
    const foreign = await seedPanel(otherCanvasId);
    const before = await revisionOf(canvasId);
    const { updatePanels } = await import("@/app/(app)/canvas/actions");

    const res = await updatePanels(canvasId, {
      panels: [
        { id: mine.id, x: 42 },
        { id: foreign.id, x: 42 },
      ],
    });

    expect("error" in res).toBe(true);
    expect((await prisma.panel.findUnique({ where: { id: mine.id } }))?.x).toBe(0);
    expect((await prisma.panel.findUnique({ where: { id: foreign.id } }))?.x).toBe(0);
    expect(await revisionOf(canvasId)).toBe(before);
  });

  it("serializes two concurrent updatePanels calls onto a consistent revision", async () => {
    const canvasId = await makeCanvas();
    const p = await seedPanel(canvasId);
    const before = await revisionOf(canvasId);
    const { updatePanels } = await import("@/app/(app)/canvas/actions");

    await Promise.all([
      updatePanels(canvasId, { panels: [{ id: p.id, x: 10 }] }),
      updatePanels(canvasId, { panels: [{ id: p.id, x: 20 }] }),
    ]);

    expect(await revisionOf(canvasId)).toBe(before + 2);
    expect([10, 20]).toContain(
      (await prisma.panel.findUnique({ where: { id: p.id } }))?.x,
    );
  });
});

describe("deletePanel", () => {
  it("cascade-deletes the panel's frames and content and bumps the revision", async () => {
    const { canvasId, panelId } = await makeCanvasWithPanel();
    const frame = await prisma.frame.create({
      data: {
        organizationId: ctx.organizationId,
        panelId,
        sortOrder: 0,
        durationSeconds: 10,
        type: "MEMO",
      },
    });
    const content = await prisma.content.create({
      data: { organizationId: ctx.organizationId, frameId: frame.id },
    });
    await prisma.memo.create({
      data: { organizationId: ctx.organizationId, contentId: content.id, body: "x" },
    });
    const before = await revisionOf(canvasId);
    const { deletePanel } = await import("@/app/(app)/canvas/actions");

    const res = await deletePanel(panelId);

    expect(res).toEqual({ ok: true });
    expect(await prisma.panel.findUnique({ where: { id: panelId } })).toBeNull();
    expect(await prisma.frame.findUnique({ where: { id: frame.id } })).toBeNull();
    expect(await prisma.content.findUnique({ where: { id: content.id } })).toBeNull();
    expect(await prisma.memo.findUnique({ where: { contentId: content.id } })).toBeNull();
    expect(await revisionOf(canvasId)).toBe(before + 1);
  });
});

describe("duplicatePanel", () => {
  it("deep-copies the panel, its frames and typed rows with fresh ids and a grid offset", async () => {
    const { canvasId, panelId } = await makeCanvasWithPanel();
    await prisma.panel.update({
      where: { id: panelId },
      data: { x: 40, y: 60, name: "Src", noScroll: true, zIndex: 3 },
    });
    const frame = await prisma.frame.create({
      data: {
        organizationId: ctx.organizationId,
        panelId,
        sortOrder: 0,
        durationSeconds: 12,
        type: "MEMO",
      },
    });
    const content = await prisma.content.create({
      data: { organizationId: ctx.organizationId, frameId: frame.id, name: "Memo one" },
    });
    await prisma.memo.create({
      data: { organizationId: ctx.organizationId, contentId: content.id, body: "Body copy" },
    });
    const before = await revisionOf(canvasId);
    const { duplicatePanel } = await import("@/app/(app)/canvas/actions");

    const res = await duplicatePanel(panelId);

    expect("error" in res).toBe(false);
    if ("error" in res) throw new Error(res.error);
    expect(res.id).not.toBe(panelId);

    const copy = await prisma.panel.findUnique({ where: { id: res.id } });
    expect(copy?.canvasId).toBe(canvasId);
    expect(copy?.x).toBe(48);
    expect(copy?.y).toBe(68);
    expect(copy?.name).toBe("Src");
    expect(copy?.noScroll).toBe(true);
    // The copy takes the next free zIndex, not the source's. Two panels sharing
    // a zIndex could never be separated again: `swapZ` looks for a strictly
    // higher or strictly lower neighbour.
    expect(copy?.zIndex).toBe(4);

    const copyFrames = await prisma.frame.findMany({ where: { panelId: res.id } });
    expect(copyFrames).toHaveLength(1);
    const copyFrame = copyFrames[0];
    if (!copyFrame) throw new Error("frame copy missing");
    expect(copyFrame.id).not.toBe(frame.id);
    expect(copyFrame.durationSeconds).toBe(12);

    const copyContent = await prisma.content.findUnique({
      where: { frameId: copyFrame.id },
      include: { memo: true },
    });
    expect(copyContent?.id).not.toBe(content.id);
    expect(copyContent?.memo?.body).toBe("Body copy");

    expect(await revisionOf(canvasId)).toBe(before + 1);
    const audit = await prisma.auditLog.findFirst({
      where: { action: "panel.duplicate", targetId: res.id },
    });
    expect(audit?.targetType).toBe("Panel");

    expect(await prisma.panel.count({ where: { canvasId } })).toBe(2);
  });
});

describe("createFrame", () => {
  it("creates a frame with an empty content row and the next sortOrder", async () => {
    const { canvasId, panelId } = await makeCanvasWithPanel();
    const before = await revisionOf(canvasId);
    const { createFrame } = await import("@/app/(app)/canvas/actions");

    const first = await createFrame({ panelId, type: "MEMO", durationSeconds: 10 });
    expect("error" in first).toBe(false);
    if ("error" in first) throw new Error(first.error);

    const f1 = await prisma.frame.findUnique({ where: { id: first.id } });
    expect(f1?.sortOrder).toBe(0);
    const c1 = await prisma.content.findUnique({ where: { frameId: first.id } });
    expect(c1).not.toBeNull();
    expect(c1?.name).toBeNull();
    expect(await revisionOf(canvasId)).toBe(before + 1);

    const second = await createFrame({ panelId, type: "WEB", durationSeconds: 5 });
    if ("error" in second) throw new Error(second.error);
    const f2 = await prisma.frame.findUnique({ where: { id: second.id } });
    expect(f2?.sortOrder).toBe(1);

    const audit = await prisma.auditLog.findFirst({
      where: { action: "frame.create", targetId: first.id },
    });
    expect(audit?.targetType).toBe("Frame");
  });

  it("rejects a panel id that does not resolve", async () => {
    const { createFrame } = await import("@/app/(app)/canvas/actions");
    const res = await createFrame({
      panelId: "clzzzzzzzzzzzzzzzzzzzzzzzz",
      type: "MEMO",
      durationSeconds: 10,
    });
    expect("error" in res).toBe(true);
  });
});

describe("reorderFrames", () => {
  it("rewrites sortOrder for a valid permutation and rejects a wrong id set", async () => {
    const { canvasId, panelId } = await makeCanvasWithPanel();
    const mk = (sortOrder: number, type: "MEMO" | "WEB" | "CLOCK") =>
      prisma.frame.create({
        data: {
          organizationId: ctx.organizationId,
          panelId,
          sortOrder,
          durationSeconds: 10,
          type,
        },
      });
    const a = await mk(0, "MEMO");
    const b = await mk(1, "WEB");
    const c = await mk(2, "CLOCK");
    const { reorderFrames } = await import("@/app/(app)/canvas/actions");

    const before = await revisionOf(canvasId);
    const ok = await reorderFrames({ panelId, frameIds: [c.id, a.id, b.id] });
    expect(ok).toEqual({ ok: true });
    expect((await prisma.frame.findUnique({ where: { id: c.id } }))?.sortOrder).toBe(0);
    expect((await prisma.frame.findUnique({ where: { id: a.id } }))?.sortOrder).toBe(1);
    expect((await prisma.frame.findUnique({ where: { id: b.id } }))?.sortOrder).toBe(2);
    expect(await revisionOf(canvasId)).toBe(before + 1);

    const afterOk = await revisionOf(canvasId);
    const missing = await reorderFrames({ panelId, frameIds: [c.id, a.id] });
    expect("error" in missing).toBe(true);
    const extra = await reorderFrames({
      panelId,
      frameIds: [c.id, a.id, b.id, "clextraaaaaaaaaaaaaaaaaaaa"],
    });
    expect("error" in extra).toBe(true);

    expect((await prisma.frame.findUnique({ where: { id: c.id } }))?.sortOrder).toBe(0);
    expect((await prisma.frame.findUnique({ where: { id: a.id } }))?.sortOrder).toBe(1);
    expect((await prisma.frame.findUnique({ where: { id: b.id } }))?.sortOrder).toBe(2);
    expect(await revisionOf(canvasId)).toBe(afterOk);
  });
});

describe("setFrameDuration / deleteFrame", () => {
  it("setFrameDuration updates the value and bumps the revision", async () => {
    const { canvasId, panelId } = await makeCanvasWithPanel();
    const frame = await prisma.frame.create({
      data: {
        organizationId: ctx.organizationId,
        panelId,
        sortOrder: 0,
        durationSeconds: 10,
        type: "MEMO",
      },
    });
    const before = await revisionOf(canvasId);
    const { setFrameDuration } = await import("@/app/(app)/canvas/actions");

    const res = await setFrameDuration({ id: frame.id, durationSeconds: 45 });

    expect(res).toEqual({ ok: true });
    expect(
      (await prisma.frame.findUnique({ where: { id: frame.id } }))?.durationSeconds,
    ).toBe(45);
    expect(await revisionOf(canvasId)).toBe(before + 1);
  });

  it("deleteFrame cascades its content away and bumps the revision", async () => {
    const { canvasId, panelId } = await makeCanvasWithPanel();
    const frame = await prisma.frame.create({
      data: {
        organizationId: ctx.organizationId,
        panelId,
        sortOrder: 0,
        durationSeconds: 10,
        type: "MEMO",
      },
    });
    const content = await prisma.content.create({
      data: { organizationId: ctx.organizationId, frameId: frame.id },
    });
    await prisma.memo.create({
      data: { organizationId: ctx.organizationId, contentId: content.id, body: "x" },
    });
    const before = await revisionOf(canvasId);
    const { deleteFrame } = await import("@/app/(app)/canvas/actions");

    const res = await deleteFrame(frame.id);

    expect(res).toEqual({ ok: true });
    expect(await prisma.frame.findUnique({ where: { id: frame.id } })).toBeNull();
    expect(await prisma.content.findUnique({ where: { id: content.id } })).toBeNull();
    expect(await prisma.memo.findUnique({ where: { contentId: content.id } })).toBeNull();
    expect(await revisionOf(canvasId)).toBe(before + 1);
  });
});

async function makeCanvasPanelFrame(
  type: "CLOCK" | "PICTURE" | "VIDEO" | "MEMO" | "WEB" = "MEMO",
) {
  const { canvasId, panelId } = await makeCanvasWithPanel();
  const { createFrame } = await import("@/app/(app)/canvas/actions");
  const res = await createFrame({ panelId, type, durationSeconds: 10 });
  if ("error" in res) throw new Error(res.error);
  return { canvasId, panelId, frameId: res.id };
}

async function contentIdOf(frameId: string): Promise<string> {
  const row = await prisma.content.findUniqueOrThrow({ where: { frameId } });
  return row.id;
}

async function makeReadyAsset(
  kind: "IMAGE" | "VIDEO",
  over: Record<string, unknown> = {},
) {
  return prisma.mediaAsset.create({
    data: {
      organizationId: ctx.organizationId,
      kind,
      status: "READY",
      name: `${kind} asset`,
      ...over,
    },
  });
}

describe("setImageContent", () => {
  it("attaches a Picture, sets Frame.type PICTURE and bumps the revision", async () => {
    const { canvasId, frameId } = await makeCanvasPanelFrame("MEMO");
    const before = await revisionOf(canvasId);
    const { setImageContent } = await import("@/app/(app)/canvas/actions");

    const res = await setImageContent({
      frameId,
      mediaAssetId: imageAssetId,
      mode: "cover",
    });

    expect(res).toEqual({ ok: true });
    const content = await prisma.content.findUnique({
      where: { frameId },
      include: { picture: true },
    });
    expect(content?.picture?.mediaAssetId).toBe(imageAssetId);
    expect(content?.picture?.mode).toBe("cover");
    const frame = await prisma.frame.findUnique({ where: { id: frameId } });
    expect(frame?.type).toBe("PICTURE");
    expect(await revisionOf(canvasId)).toBe(before + 1);

    const audit = await prisma.auditLog.findFirst({
      where: { action: "content.setImage", targetId: frameId },
    });
    expect(audit?.targetType).toBe("Frame");
  });

  it("rejects a VIDEO asset, an archived asset and a non-ready asset without writing a Picture", async () => {
    const { frameId } = await makeCanvasPanelFrame("MEMO");
    const video = await makeReadyAsset("VIDEO");
    const archived = await makeReadyAsset("IMAGE", { archivedAt: new Date() });
    const pending = await prisma.mediaAsset.create({
      data: {
        organizationId: ctx.organizationId,
        kind: "IMAGE",
        status: "UPLOADING",
        name: "Half",
      },
    });
    const { setImageContent } = await import("@/app/(app)/canvas/actions");

    const asVideo = await setImageContent({ frameId, mediaAssetId: video.id });
    const asArchived = await setImageContent({ frameId, mediaAssetId: archived.id });
    const asPending = await setImageContent({ frameId, mediaAssetId: pending.id });

    expect("error" in asVideo).toBe(true);
    expect("error" in asArchived).toBe(true);
    expect("error" in asPending).toBe(true);
    const content = await prisma.content.findUnique({
      where: { frameId },
      include: { picture: true },
    });
    expect(content?.picture).toBeNull();
  });
});

describe("setVideoContent", () => {
  it("attaches a Video from a READY VIDEO asset and rejects an image asset", async () => {
    const { canvasId, frameId } = await makeCanvasPanelFrame("MEMO");
    const video = await makeReadyAsset("VIDEO");
    const before = await revisionOf(canvasId);
    const { setVideoContent } = await import("@/app/(app)/canvas/actions");

    const res = await setVideoContent({ frameId, mediaAssetId: video.id });

    expect(res).toEqual({ ok: true });
    const content = await prisma.content.findUnique({
      where: { frameId },
      include: { video: true },
    });
    expect(content?.video?.mediaAssetId).toBe(video.id);
    const frame = await prisma.frame.findUnique({ where: { id: frameId } });
    expect(frame?.type).toBe("VIDEO");
    expect(await revisionOf(canvasId)).toBe(before + 1);

    const asImage = await setVideoContent({ frameId, mediaAssetId: imageAssetId });
    expect("error" in asImage).toBe(true);
  });
});

describe("setWebContent", () => {
  it("drops a former Picture row and swaps the frame to WEB", async () => {
    const { canvasId, frameId } = await makeCanvasPanelFrame("MEMO");
    const { setImageContent, setWebContent } = await import(
      "@/app/(app)/canvas/actions"
    );

    await setImageContent({ frameId, mediaAssetId: imageAssetId });
    const before = await revisionOf(canvasId);

    const res = await setWebContent({ frameId, url: "https://example.com/live" });

    expect(res).toEqual({ ok: true });
    const content = await prisma.content.findUnique({
      where: { frameId },
      include: { picture: true, web: true },
    });
    expect(content?.picture).toBeNull();
    expect(content?.web?.url).toBe("https://example.com/live");
    const frame = await prisma.frame.findUnique({ where: { id: frameId } });
    expect(frame?.type).toBe("WEB");
    expect(await revisionOf(canvasId)).toBe(before + 1);
  });

  it("also drops a typed row this plan has no editor for, leaving exactly one child", async () => {
    const { frameId } = await makeCanvasPanelFrame("MEMO");
    const contentId = await contentIdOf(frameId);
    // Weather has no set*Content action in Plan 1, but a legacy or imported
    // Content can already carry one. A frame must end up with exactly one typed
    // child whatever it started with.
    await prisma.weather.create({
      data: { organizationId: ctx.organizationId, contentId },
    });
    const { setWebContent } = await import("@/app/(app)/canvas/actions");

    const res = await setWebContent({ frameId, url: "https://example.com/x" });

    expect(res).toEqual({ ok: true });
    expect(await prisma.weather.findUnique({ where: { contentId } })).toBeNull();
    expect(await prisma.web.findUnique({ where: { contentId } })).not.toBeNull();
    expect(await prisma.memo.findUnique({ where: { contentId } })).toBeNull();
  });
});

describe("setClockContent", () => {
  it("upserts one Clock row and stays ok and persistent on a second call", async () => {
    const { frameId } = await makeCanvasPanelFrame("MEMO");
    const { setClockContent } = await import("@/app/(app)/canvas/actions");

    const first = await setClockContent({
      frameId,
      style: 1,
      showDate: true,
      showTime: true,
      showSeconds: true,
      label: "Lobby",
      timeZone: "UTC",
    });
    expect(first).toEqual({ ok: true });

    const second = await setClockContent({
      frameId,
      style: 1,
      showDate: true,
      showTime: true,
      showSeconds: false,
    });
    expect(second).toEqual({ ok: true });

    const rows = await prisma.clock.findMany({
      where: { contentId: await contentIdOf(frameId) },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.type).toBe(1);
    expect(rows[0]?.showSeconds).toBe(false);
  });

  it("clears a saved label and time zone when the editor sends null", async () => {
    const { frameId } = await makeCanvasPanelFrame("MEMO");
    const { setClockContent } = await import("@/app/(app)/canvas/actions");
    const contentId = await contentIdOf(frameId);

    await setClockContent({
      frameId,
      style: 0,
      showDate: false,
      showTime: true,
      showSeconds: false,
      label: "Lobby",
      timeZone: "Europe/London",
    });
    const saved = await prisma.clock.findUnique({ where: { contentId } });
    expect(saved?.label).toBe("Lobby");
    expect(saved?.timeZone).toBe("Europe/London");

    const cleared = await setClockContent({
      frameId,
      style: 0,
      showDate: false,
      showTime: true,
      showSeconds: false,
      label: null,
      timeZone: null,
    });

    expect(cleared).toEqual({ ok: true });
    const row = await prisma.clock.findUnique({ where: { contentId } });
    expect(row?.label).toBeNull();
    expect(row?.timeZone).toBeNull();
  });
});

describe("setTextContent", () => {
  it("accepts an empty body and swaps the frame to MEMO", async () => {
    const { canvasId, frameId } = await makeCanvasPanelFrame("WEB");
    const before = await revisionOf(canvasId);
    const { setTextContent } = await import("@/app/(app)/canvas/actions");

    const res = await setTextContent({ frameId, body: "" });

    expect(res).toEqual({ ok: true });
    const content = await prisma.content.findUnique({
      where: { frameId },
      include: { memo: true },
    });
    expect(content?.memo?.body).toBe("");
    const frame = await prisma.frame.findUnique({ where: { id: frameId } });
    expect(frame?.type).toBe("MEMO");
    expect(await revisionOf(canvasId)).toBe(before + 1);
  });

  it("rejects a frameId that does not resolve", async () => {
    const { setTextContent } = await import("@/app/(app)/canvas/actions");
    const res = await setTextContent({
      frameId: "clzzzzzzzzzzzzzzzzzzzzzzzz",
      body: "hi",
    });
    expect(res).toEqual({ error: "That frame no longer exists." });
  });
});
