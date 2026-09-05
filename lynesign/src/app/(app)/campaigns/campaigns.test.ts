import { describe, it, expect, vi, beforeEach } from "vitest";

import { prisma } from "@/lib/db/root";
import { forOrg } from "@/lib/db/tenant";
import { resetDb, seedPlans } from "@/test/helpers/db";
import { NotFoundError } from "@/lib/errors";

/**
 * Integration coverage for the campaign CRUD actions against the real dev
 * database. `requireRole` / `requireOrg` are mocked to a module-scope `ctx`
 * bound to a freshly created organization, user and playlist in `beforeEach`;
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

let playlistId = "";
let loc1Id = "";
let s1Id = "";
let s2Id = "";

const DAY = 24 * 60 * 60 * 1000;
const base = Date.parse("2026-09-01T00:00:00.000Z");
const startsAt = new Date(base + DAY).toISOString();
const endsAt = new Date(base + 2 * DAY).toISOString();
const afterEndsAt = new Date(base + 3 * DAY).toISOString();

beforeEach(async () => {
  await resetDb();
  await seedPlans();

  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const org = await prisma.organization.create({
    data: { name: "Campaigns Org", slug: `campaigns-${suffix}` },
  });
  const user = await prisma.user.create({
    data: { email: `campaigns-${suffix}@test.local`, name: "Tester" },
  });
  const playlist = await prisma.playlist.create({
    data: { organizationId: org.id, name: "Lobby", createdByUserId: user.id },
  });

  const loc1 = await prisma.location.create({
    data: { organizationId: org.id, name: "North" },
  });
  const loc2 = await prisma.location.create({
    data: { organizationId: org.id, name: "South" },
  });
  const s1 = await prisma.screen.create({
    data: { organizationId: org.id, locationId: loc1.id, name: "Screen 1" },
  });
  const s2 = await prisma.screen.create({
    data: { organizationId: org.id, locationId: loc2.id, name: "Screen 2" },
  });

  ctx.organizationId = org.id;
  ctx.user = { id: user.id, email: user.email, isSuperAdmin: false };
  ctx.db = forOrg(org.id);
  playlistId = playlist.id;
  loc1Id = loc1.id;
  s1Id = s1.id;
  s2Id = s2.id;
});

async function makeCampaign(over: { priority?: number } = {}) {
  const { createCampaign } = await import("@/app/(app)/campaigns/actions");
  const res = await createCampaign({
    name: "Fall Sale",
    playlistId,
    startsAt,
    endsAt,
    priority: over.priority,
  });
  if ("error" in res) throw new Error(res.error);
  return res.id;
}

describe("createCampaign", () => {
  it("creates a campaign at revision 1 with the creator recorded and audits it", async () => {
    const { createCampaign } = await import("@/app/(app)/campaigns/actions");

    const res = await createCampaign({
      name: "Fall Sale",
      playlistId,
      startsAt,
      endsAt,
      priority: undefined,
    });

    expect("error" in res).toBe(false);
    if ("error" in res) throw new Error(res.error);

    const row = await prisma.campaign.findUnique({ where: { id: res.id } });
    expect(row?.name).toBe("Fall Sale");
    expect(row?.revision).toBe(1);
    expect(row?.priority).toBe(0);
    expect(row?.organizationId).toBe(ctx.organizationId);
    expect(row?.createdByUserId).toBe(ctx.user.id);

    const audit = await prisma.auditLog.findFirst({
      where: { action: "campaign.create", targetId: res.id },
    });
    expect(audit).not.toBeNull();
  });

  it("rejects an archived playlist and writes no row", async () => {
    const archived = await prisma.playlist.create({
      data: {
        organizationId: ctx.organizationId,
        name: "Old",
        createdByUserId: ctx.user.id,
        archivedAt: new Date(),
      },
    });
    const { createCampaign } = await import("@/app/(app)/campaigns/actions");

    const res = await createCampaign({
      name: "Fall Sale",
      playlistId: archived.id,
      startsAt,
      endsAt,
    });

    expect("error" in res && res.error).toBeTruthy();
    expect(await prisma.campaign.count({ where: { organizationId: ctx.organizationId } })).toBe(0);
  });

  it("rejects a reversed date window", async () => {
    const { createCampaign } = await import("@/app/(app)/campaigns/actions");

    const res = await createCampaign({
      name: "Fall Sale",
      playlistId,
      startsAt: endsAt,
      endsAt: startsAt,
    });

    expect("error" in res && res.error).toBeTruthy();
    expect(await prisma.campaign.count({ where: { organizationId: ctx.organizationId } })).toBe(0);
  });
});

describe("updateCampaign", () => {
  it("applies the patch and bumps revision to 2", async () => {
    const id = await makeCampaign();
    const { updateCampaign } = await import("@/app/(app)/campaigns/actions");

    const res = await updateCampaign(id, { priority: 20 });

    expect(res).toEqual({});
    const row = await prisma.campaign.findUnique({ where: { id } });
    expect(row?.priority).toBe(20);
    expect(row?.revision).toBe(2);
  });

  it("rejects a one-sided window change that reverses against the stored row", async () => {
    const id = await makeCampaign();
    const { updateCampaign } = await import("@/app/(app)/campaigns/actions");

    const res = await updateCampaign(id, { startsAt: afterEndsAt });

    expect(res).toEqual({ error: "The end must be after the start." });
    const row = await prisma.campaign.findUnique({ where: { id } });
    expect(row?.startsAt.toISOString()).toBe(startsAt);
    expect(row?.revision).toBe(1);
  });

  it("throws NotFoundError for an id that does not resolve", async () => {
    const { updateCampaign } = await import("@/app/(app)/campaigns/actions");

    await expect(updateCampaign("does-not-exist", { name: "x" })).rejects.toThrow(NotFoundError);
  });
});

describe("setCampaignEnabled", () => {
  it("toggles enabled off and bumps revision", async () => {
    const id = await makeCampaign();
    const { setCampaignEnabled } = await import("@/app/(app)/campaigns/actions");

    const res = await setCampaignEnabled(id, false);

    expect(res).toEqual({});
    const row = await prisma.campaign.findUnique({ where: { id } });
    expect(row?.enabled).toBe(false);
    expect(row?.revision).toBe(2);
  });
});

describe("archiveCampaign / restoreCampaign", () => {
  it("archives without touching revision, then restores", async () => {
    const id = await makeCampaign();
    const { updateCampaign, archiveCampaign, restoreCampaign } = await import(
      "@/app/(app)/campaigns/actions"
    );

    await updateCampaign(id, { priority: 20 });

    const archived = await archiveCampaign(id);
    expect(archived).toEqual({});
    let row = await prisma.campaign.findUnique({ where: { id } });
    expect(row?.archivedAt).not.toBeNull();
    expect(row?.revision).toBe(2);

    const restored = await restoreCampaign(id);
    expect(restored).toEqual({});
    row = await prisma.campaign.findUnique({ where: { id } });
    expect(row?.archivedAt).toBeNull();
    expect(row?.revision).toBe(2);
  });
});

describe("deleteCampaign", () => {
  it("removes the row", async () => {
    const id = await makeCampaign();
    const { deleteCampaign } = await import("@/app/(app)/campaigns/actions");

    const res = await deleteCampaign(id);

    expect(res).toEqual({});
    expect(await prisma.campaign.findUnique({ where: { id } })).toBeNull();
  });

  it("refuses to delete a campaign that a schedule rule uses", async () => {
    const campaignId = await makeCampaign();
    const { deleteCampaign } = await import("@/app/(app)/campaigns/actions");

    await prisma.scheduleRule.create({
      data: {
        organizationId: ctx.organizationId,
        name: "Evening",
        campaignId,
        daysOfWeek: [0, 1, 2, 3, 4],
        startMinute: 1080,
        endMinute: 1440,
      },
    });

    const res = await deleteCampaign(campaignId);

    expect("error" in res).toBe(true);
    expect(res.error).toBe("That campaign is used by a schedule rule. Remove it from the schedule first.");
    expect(await prisma.campaign.findUnique({ where: { id: campaignId } })).not.toBeNull();
  });

  it("allows deleting a campaign after removing the schedule rule that used it", async () => {
    const campaignId = await makeCampaign();
    const { deleteCampaign } = await import("@/app/(app)/campaigns/actions");

    const rule = await prisma.scheduleRule.create({
      data: {
        organizationId: ctx.organizationId,
        name: "Evening",
        campaignId,
        daysOfWeek: [0, 1, 2, 3, 4],
        startMinute: 1080,
        endMinute: 1440,
      },
    });

    let res = await deleteCampaign(campaignId);
    expect("error" in res).toBe(true);

    await prisma.scheduleRule.delete({ where: { id: rule.id } });

    res = await deleteCampaign(campaignId);
    expect(res).toEqual({});
    expect(await prisma.campaign.findUnique({ where: { id: campaignId } })).toBeNull();
  });
});

describe("setCampaignTargets", () => {
  async function counts(campaignId: string) {
    return {
      screens: await prisma.campaignScreen.count({ where: { campaignId } }),
      locations: await prisma.campaignLocation.count({ where: { campaignId } }),
    };
  }

  it("sets the initial screen and location targets and bumps revision by 1", async () => {
    const id = await makeCampaign();
    const { setCampaignTargets } = await import("@/app/(app)/campaigns/actions");

    const res = await setCampaignTargets(id, {
      screenIds: [s1Id, s2Id],
      locationIds: [loc1Id],
    });

    expect(res).toEqual({});
    expect(await counts(id)).toEqual({ screens: 2, locations: 1 });
    const row = await prisma.campaign.findUnique({ where: { id } });
    expect(row?.revision).toBe(2);

    const audit = await prisma.auditLog.findFirst({
      where: { action: "campaign.targets", targetId: id },
    });
    expect(audit).not.toBeNull();
  });

  it("replaces the sets on a second call, dropping stale rows and keeping the shared one", async () => {
    const id = await makeCampaign();
    const { setCampaignTargets } = await import("@/app/(app)/campaigns/actions");

    await setCampaignTargets(id, { screenIds: [s1Id, s2Id], locationIds: [loc1Id] });
    const kept = await prisma.campaignScreen.findFirst({
      where: { campaignId: id, screenId: s2Id },
    });

    const res = await setCampaignTargets(id, { screenIds: [s2Id], locationIds: [] });

    expect(res).toEqual({});
    expect(await counts(id)).toEqual({ screens: 1, locations: 0 });
    const stillThere = await prisma.campaignScreen.findFirst({
      where: { campaignId: id, screenId: s2Id },
    });
    expect(stillThere?.id).toBe(kept?.id);
    expect(
      await prisma.campaignScreen.findFirst({ where: { campaignId: id, screenId: s1Id } }),
    ).toBeNull();
    const row = await prisma.campaign.findUnique({ where: { id } });
    expect(row?.revision).toBe(3);
  });

  it("rejects an empty batch from zod and changes nothing", async () => {
    const id = await makeCampaign();
    const { setCampaignTargets } = await import("@/app/(app)/campaigns/actions");

    await setCampaignTargets(id, { screenIds: [s1Id], locationIds: [] });
    const before = await prisma.campaign.findUnique({ where: { id } });

    const res = await setCampaignTargets(id, { screenIds: [], locationIds: [] });

    expect("error" in res && res.error).toBeTruthy();
    expect(await counts(id)).toEqual({ screens: 1, locations: 0 });
    const after = await prisma.campaign.findUnique({ where: { id } });
    expect(after?.revision).toBe(before?.revision);
  });

  it("rejects an unknown id and changes nothing", async () => {
    const id = await makeCampaign();
    const { setCampaignTargets } = await import("@/app/(app)/campaigns/actions");

    await setCampaignTargets(id, { screenIds: [s1Id], locationIds: [] });
    const before = await prisma.campaign.findUnique({ where: { id } });

    const res = await setCampaignTargets(id, { screenIds: ["not-in-org"], locationIds: [] });

    expect(res).toEqual({ error: "One of those targets is not in your organization." });
    expect(await counts(id)).toEqual({ screens: 1, locations: 0 });
    const after = await prisma.campaign.findUnique({ where: { id } });
    expect(after?.revision).toBe(before?.revision);
  });

  it("rejects a screen id belonging to another organization and writes no join rows", async () => {
    const id = await makeCampaign();
    const { setCampaignTargets } = await import("@/app/(app)/campaigns/actions");

    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const orgB = await prisma.organization.create({
      data: { name: "Other Org", slug: `other-${suffix}` },
    });
    const locB = await prisma.location.create({
      data: { organizationId: orgB.id, name: "Elsewhere" },
    });
    const screenB = await prisma.screen.create({
      data: { organizationId: orgB.id, locationId: locB.id, name: "Foreign" },
    });

    const res = await setCampaignTargets(id, { screenIds: [screenB.id], locationIds: [] });

    expect(res).toEqual({ error: "One of those targets is not in your organization." });
    expect(await counts(id)).toEqual({ screens: 0, locations: 0 });
  });

  it("throws NotFoundError for a campaign id that does not resolve", async () => {
    const { setCampaignTargets } = await import("@/app/(app)/campaigns/actions");

    await expect(
      setCampaignTargets("no-such-campaign", { screenIds: [s1Id], locationIds: [] }),
    ).rejects.toThrow(NotFoundError);
  });
});
