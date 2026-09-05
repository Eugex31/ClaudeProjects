import { describe, it, expect, vi } from "vitest";
import { prisma } from "@/lib/db/root";
import { forOrg } from "@/lib/db/tenant";

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

async function orgOnPlan(prefix: string, planKey: "TRIAL" | "GROWTH") {
  const org = await prisma.organization.create({
    data: { name: prefix, slug: `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` },
  });
  await prisma.subscription.create({ data: { organizationId: org.id, planKey } });
  return org;
}

describe("createScreen", () => {
  it("creates a screen scoped to the active org and returns a pairing code", async () => {
    const org = await orgOnPlan("scr", "GROWTH");
    const loc = await prisma.location.create({ data: { organizationId: org.id, name: "HQ" } });
    ctx.organizationId = org.id;
    ctx.db = forOrg(org.id);

    const { createScreen } = await import("@/app/(app)/screens/actions");
    const fd = new FormData();
    fd.set("name", "Lobby Screen");
    fd.set("locationId", loc.id);
    const res = await createScreen(fd);

    expect(res.error).toBeUndefined();
    expect(res.pairingCode).toMatch(/^[A-Z2-9]{8}$/);
    const rows = await prisma.screen.findMany({
      where: { organizationId: org.id, name: "Lobby Screen" },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe("UNPAIRED");
    expect(rows[0]?.pairingCode).toBe(res.pairingCode);
  });

  it("enforces the TRIAL screen cap of 3", async () => {
    const org = await orgOnPlan("cap", "TRIAL");
    const loc = await prisma.location.create({ data: { organizationId: org.id, name: "Site" } });
    for (let i = 0; i < 3; i++) {
      await prisma.screen.create({
        data: { organizationId: org.id, locationId: loc.id, name: `S${i}`, status: "UNPAIRED" },
      });
    }
    ctx.organizationId = org.id;
    ctx.db = forOrg(org.id);

    const { createScreen } = await import("@/app/(app)/screens/actions");
    const fd = new FormData();
    fd.set("name", "Fourth");
    fd.set("locationId", loc.id);
    const res = await createScreen(fd);

    expect(res.error).toMatch(/plan allows 3 screens/);
    expect(await prisma.screen.count({ where: { organizationId: org.id } })).toBe(3);
  });

  it("rejects a locationId from another organization and creates nothing", async () => {
    const other = await orgOnPlan("other", "GROWTH");
    const foreignLoc = await prisma.location.create({
      data: { organizationId: other.id, name: "Foreign Site" },
    });

    const org = await orgOnPlan("mine", "GROWTH");
    ctx.organizationId = org.id;
    ctx.db = forOrg(org.id);

    const { createScreen } = await import("@/app/(app)/screens/actions");
    const fd = new FormData();
    fd.set("name", "Child Screen");
    fd.set("locationId", foreignLoc.id);
    const res = await createScreen(fd);

    expect(res.error).toBeTruthy();
    expect(await prisma.screen.count({ where: { organizationId: org.id } })).toBe(0);
  });
});

describe("setScreenContentSource", () => {
  async function screenFixture(prefix: string) {
    const org = await orgOnPlan(prefix, "GROWTH");
    const loc = await prisma.location.create({
      data: { organizationId: org.id, name: "HQ" },
    });
    const screen = await prisma.screen.create({
      data: { organizationId: org.id, locationId: loc.id, name: "Wall", status: "UNPAIRED" },
    });
    ctx.organizationId = org.id;
    ctx.db = forOrg(org.id);
    return { org, screen };
  }

  it("points the screen at a canvas and clears any playlist pointer", async () => {
    const { org, screen } = await screenFixture("csrc-canvas");
    const playlist = await prisma.playlist.create({
      data: { organizationId: org.id, name: "Loop" },
    });
    await prisma.screen.update({
      where: { id: screen.id },
      data: { playlistId: playlist.id },
    });
    const canvas = await prisma.canvas.create({
      data: { organizationId: org.id, name: "Lobby", width: 1920, height: 1080 },
    });

    const { setScreenContentSource } = await import("@/app/(app)/screens/actions");
    const res = await setScreenContentSource({
      screenId: screen.id,
      source: "canvas",
      canvasId: canvas.id,
    });

    expect(res).toEqual({ ok: true });
    const row = await prisma.screen.findUnique({ where: { id: screen.id } });
    expect(row?.canvasId).toBe(canvas.id);
    expect(row?.playlistId).toBeNull();
    const audit = await prisma.auditLog.findFirst({
      where: { action: "screen.setContentSource", targetId: screen.id },
    });
    expect(audit).not.toBeNull();
  });

  it("points the screen at a playlist and clears any canvas pointer", async () => {
    const { org, screen } = await screenFixture("csrc-playlist");
    const canvas = await prisma.canvas.create({
      data: { organizationId: org.id, name: "Lobby", width: 1920, height: 1080 },
    });
    await prisma.screen.update({
      where: { id: screen.id },
      data: { canvasId: canvas.id },
    });
    const playlist = await prisma.playlist.create({
      data: { organizationId: org.id, name: "Loop" },
    });

    const { setScreenContentSource } = await import("@/app/(app)/screens/actions");
    const res = await setScreenContentSource({
      screenId: screen.id,
      source: "playlist",
      playlistId: playlist.id,
    });

    expect(res).toEqual({ ok: true });
    const row = await prisma.screen.findUnique({ where: { id: screen.id } });
    expect(row?.playlistId).toBe(playlist.id);
    expect(row?.canvasId).toBeNull();
  });

  it("clears both pointers when the source is none", async () => {
    const { org, screen } = await screenFixture("csrc-none");
    const canvas = await prisma.canvas.create({
      data: { organizationId: org.id, name: "Lobby", width: 1920, height: 1080 },
    });
    await prisma.screen.update({
      where: { id: screen.id },
      data: { canvasId: canvas.id },
    });

    const { setScreenContentSource } = await import("@/app/(app)/screens/actions");
    const res = await setScreenContentSource({ screenId: screen.id, source: "none" });

    expect(res).toEqual({ ok: true });
    const row = await prisma.screen.findUnique({ where: { id: screen.id } });
    expect(row?.playlistId).toBeNull();
    expect(row?.canvasId).toBeNull();
  });

  it("rejects a canvasId from another organization and leaves the screen unchanged", async () => {
    const other = await orgOnPlan("csrc-foreign", "GROWTH");
    const foreignCanvas = await prisma.canvas.create({
      data: { organizationId: other.id, name: "Theirs", width: 1920, height: 1080 },
    });
    const { screen } = await screenFixture("csrc-mine");

    const { setScreenContentSource } = await import("@/app/(app)/screens/actions");
    const res = await setScreenContentSource({
      screenId: screen.id,
      source: "canvas",
      canvasId: foreignCanvas.id,
    });

    expect("error" in res).toBe(true);
    const row = await prisma.screen.findUnique({ where: { id: screen.id } });
    expect(row?.canvasId).toBeNull();
    expect(row?.playlistId).toBeNull();
  });

  it("rejects a canvas source with no canvasId through the schema refine", async () => {
    const { screen } = await screenFixture("csrc-missing");

    const { setScreenContentSource } = await import("@/app/(app)/screens/actions");
    const res = await setScreenContentSource({ screenId: screen.id, source: "canvas" });

    expect("error" in res).toBe(true);
  });
});
