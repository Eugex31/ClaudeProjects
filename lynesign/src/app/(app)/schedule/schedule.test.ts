import { describe, it, expect, vi, beforeEach } from "vitest";

import { prisma } from "@/lib/db/root";
import { forOrg } from "@/lib/db/tenant";
import { resetDb, seedPlans } from "@/test/helpers/db";

/**
 * Integration coverage for the schedule rule CRUD actions against the real dev
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

type CreateInput = Parameters<
  typeof import("@/app/(app)/schedule/actions").createScheduleRule
>[0];

let playlistId = "";
let campaignId = "";
let s1Id = "";
let s2Id = "";
let loc1Id = "";

beforeEach(async () => {
  await resetDb();
  await seedPlans();

  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const org = await prisma.organization.create({
    data: { name: "Schedule Org", slug: `schedule-${suffix}` },
  });
  const user = await prisma.user.create({
    data: { email: `schedule-${suffix}@test.local`, name: "Tester" },
  });
  const playlist = await prisma.playlist.create({
    data: { organizationId: org.id, name: "Lobby", createdByUserId: user.id },
  });
  const campaign = await prisma.campaign.create({
    data: {
      organizationId: org.id,
      name: "Fall Sale",
      playlistId: playlist.id,
      startsAt: new Date("2026-09-01T00:00:00.000Z"),
      endsAt: new Date("2026-10-01T00:00:00.000Z"),
      createdByUserId: user.id,
    },
  });
  const loc1 = await prisma.location.create({
    data: { organizationId: org.id, name: "North" },
  });
  const s1 = await prisma.screen.create({
    data: { organizationId: org.id, locationId: loc1.id, name: "Screen 1" },
  });
  const s2 = await prisma.screen.create({
    data: { organizationId: org.id, locationId: loc1.id, name: "Screen 2" },
  });

  ctx.organizationId = org.id;
  ctx.user = { id: user.id, email: user.email, isSuperAdmin: false };
  ctx.db = forOrg(org.id);
  playlistId = playlist.id;
  campaignId = campaign.id;
  loc1Id = loc1.id;
  s1Id = s1.id;
  s2Id = s2.id;
});

async function createRule(
  over: Partial<CreateInput> = {},
): Promise<{ id: string } | { error: string }> {
  const { createScheduleRule } = await import("@/app/(app)/schedule/actions");
  return createScheduleRule({
    playlistId,
    daysOfWeek: [1],
    startMinute: 540,
    endMinute: 600,
    screenIds: [s1Id],
    locationIds: [],
    ...over,
  });
}

function idOf(res: { id: string } | { error: string }): string {
  if ("error" in res) throw new Error(res.error);
  return res.id;
}

describe("createScheduleRule", () => {
  it("creates a rule at revision 1 with target rows and an audit entry", async () => {
    const res = await createRule({ screenIds: [s1Id], locationIds: [loc1Id] });
    const id = idOf(res);

    const row = await prisma.scheduleRule.findUnique({ where: { id } });
    expect(row?.revision).toBe(1);
    expect(row?.playlistId).toBe(playlistId);
    expect(row?.campaignId).toBeNull();
    expect(row?.organizationId).toBe(ctx.organizationId);
    expect(row?.createdByUserId).toBe(ctx.user.id);

    expect(await prisma.scheduleRuleScreen.count({ where: { scheduleRuleId: id } })).toBe(1);
    expect(await prisma.scheduleRuleLocation.count({ where: { scheduleRuleId: id } })).toBe(1);

    const audit = await prisma.auditLog.findFirst({
      where: { action: "schedule.create", targetId: id },
    });
    expect(audit).not.toBeNull();
  });

  it("creates a rule with a campaign payload", async () => {
    const res = await createRule({ playlistId: undefined, campaignId });
    const id = idOf(res);
    const row = await prisma.scheduleRule.findUnique({ where: { id } });
    expect(row?.campaignId).toBe(campaignId);
    expect(row?.playlistId).toBeNull();
  });

  it("rejects a rule with neither payload id", async () => {
    const res = await createRule({ playlistId: undefined });
    expect("error" in res).toBe(true);
    expect(await prisma.scheduleRule.count()).toBe(0);
  });

  it("rejects a rule with both payload ids", async () => {
    const res = await createRule({ campaignId });
    expect("error" in res).toBe(true);
    expect(await prisma.scheduleRule.count()).toBe(0);
  });

  it("rejects a rule that targets neither a screen nor a location and writes no row", async () => {
    const res = await createRule({ screenIds: [], locationIds: [] });
    expect("error" in res).toBe(true);
    expect(await prisma.scheduleRule.count()).toBe(0);
  });

  it("rejects a rule that overlaps an existing rule on the same screen and writes nothing", async () => {
    idOf(await createRule({ screenIds: [s1Id] }));
    const before = await prisma.scheduleRule.count();

    const res = await createRule({ screenIds: [s1Id], startMinute: 570, endMinute: 630 });

    expect("error" in res && res.error).toContain("overlaps");
    expect(await prisma.scheduleRule.count()).toBe(before);
    expect(await prisma.scheduleRuleScreen.count()).toBe(1);
  });
});

describe("updateScheduleRule", () => {
  it("changing endMinute bumps revision to 2", async () => {
    const id = idOf(await createRule());
    const { updateScheduleRule } = await import("@/app/(app)/schedule/actions");

    const res = await updateScheduleRule(id, { endMinute: 660 });

    expect(res).toEqual({ id });
    const row = await prisma.scheduleRule.findUnique({ where: { id } });
    expect(row?.endMinute).toBe(660);
    expect(row?.revision).toBe(2);
  });

  it("rejects a one-sided endMinute patch that inverts the window and does not write", async () => {
    const id = idOf(await createRule({ startMinute: 540, endMinute: 600 }));
    const { updateScheduleRule } = await import("@/app/(app)/schedule/actions");

    const res = await updateScheduleRule(id, { endMinute: 400 });

    expect("error" in res).toBe(true);
    const row = await prisma.scheduleRule.findUnique({ where: { id } });
    expect(row?.endMinute).toBe(600);
    expect(row?.revision).toBe(1);
  });

  it("rejects a one-sided effectiveUntil patch that inverts the date window and does not persist", async () => {
    const id = idOf(
      await createRule({ effectiveFrom: "2026-06-01", effectiveUntil: "2026-12-01" }),
    );
    const { updateScheduleRule } = await import("@/app/(app)/schedule/actions");

    const res = await updateScheduleRule(id, { effectiveUntil: "2020-01-01" });

    expect("error" in res).toBe(true);
    const row = await prisma.scheduleRule.findUnique({ where: { id } });
    expect(row?.effectiveUntil?.toISOString().slice(0, 10)).toBe("2026-12-01");
    expect(row?.revision).toBe(1);
  });

  it("serializes two concurrent edits and lands on revision 3 with one consistent row", async () => {
    const id = idOf(await createRule());
    const { updateScheduleRule } = await import("@/app/(app)/schedule/actions");

    await Promise.all([
      updateScheduleRule(id, { endMinute: 660 }),
      updateScheduleRule(id, { endMinute: 720 }),
    ]);

    const row = await prisma.scheduleRule.findUnique({ where: { id } });
    expect(row?.revision).toBe(3);
    expect([660, 720]).toContain(row?.endMinute);
  });
});

describe("setScheduleRuleEnabled", () => {
  it("returns an error when re-enabling would overlap and leaves the rule disabled", async () => {
    const idA = idOf(await createRule({ screenIds: [s1Id], startMinute: 540, endMinute: 600 }));
    const { setScheduleRuleEnabled } = await import("@/app/(app)/schedule/actions");

    expect(await setScheduleRuleEnabled(idA, false)).toEqual({ id: idA });

    idOf(await createRule({ screenIds: [s1Id], startMinute: 540, endMinute: 600 }));

    const res = await setScheduleRuleEnabled(idA, true);

    expect("error" in res && res.error).toContain("overlaps");
    const row = await prisma.scheduleRule.findUnique({ where: { id: idA } });
    expect(row?.enabled).toBe(false);
  });
});

describe("setScheduleRuleTargets", () => {
  it("replaces the target rows, bumps revision and audits", async () => {
    const id = idOf(await createRule({ screenIds: [s1Id], locationIds: [] }));
    const { setScheduleRuleTargets } = await import("@/app/(app)/schedule/actions");

    const res = await setScheduleRuleTargets(id, { screenIds: [s2Id], locationIds: [loc1Id] });

    expect(res).toEqual({ id });
    const screens = await prisma.scheduleRuleScreen.findMany({ where: { scheduleRuleId: id } });
    expect(screens.map((s) => s.screenId)).toEqual([s2Id]);
    expect(await prisma.scheduleRuleLocation.count({ where: { scheduleRuleId: id } })).toBe(1);
    const row = await prisma.scheduleRule.findUnique({ where: { id } });
    expect(row?.revision).toBe(2);
    const audit = await prisma.auditLog.findFirst({
      where: { action: "schedule.setTargets", targetId: id },
    });
    expect(audit).not.toBeNull();
  });
});

describe("archiveScheduleRule / restoreScheduleRule", () => {
  it("archives and restores without touching revision", async () => {
    const id = idOf(await createRule());
    const { archiveScheduleRule, restoreScheduleRule } = await import(
      "@/app/(app)/schedule/actions"
    );

    expect(await archiveScheduleRule(id)).toEqual({ ok: true });
    let row = await prisma.scheduleRule.findUnique({ where: { id } });
    expect(row?.archivedAt).not.toBeNull();
    expect(row?.revision).toBe(1);

    expect(await restoreScheduleRule(id)).toEqual({ ok: true });
    row = await prisma.scheduleRule.findUnique({ where: { id } });
    expect(row?.archivedAt).toBeNull();
    expect(row?.revision).toBe(1);
  });

  it("refuses to restore a rule into an overlap and keeps it archived", async () => {
    const idA = idOf(await createRule({ screenIds: [s1Id], startMinute: 540, endMinute: 600 }));
    const { archiveScheduleRule, restoreScheduleRule } = await import(
      "@/app/(app)/schedule/actions"
    );

    expect(await archiveScheduleRule(idA)).toEqual({ ok: true });
    idOf(await createRule({ screenIds: [s1Id], startMinute: 540, endMinute: 600 }));

    const res = await restoreScheduleRule(idA);

    expect("error" in res && res.error).toContain("overlaps");
    const row = await prisma.scheduleRule.findUnique({ where: { id: idA } });
    expect(row?.archivedAt).not.toBeNull();
    expect(row?.revision).toBe(1);
  });
});

describe("deleteScheduleRule", () => {
  it("hard deletes the rule and cascades its target rows", async () => {
    const id = idOf(await createRule({ screenIds: [s1Id], locationIds: [loc1Id] }));
    const { deleteScheduleRule } = await import("@/app/(app)/schedule/actions");

    expect(await deleteScheduleRule(id)).toEqual({ ok: true });
    expect(await prisma.scheduleRule.findUnique({ where: { id } })).toBeNull();
    expect(await prisma.scheduleRuleScreen.count({ where: { scheduleRuleId: id } })).toBe(0);
    expect(await prisma.scheduleRuleLocation.count({ where: { scheduleRuleId: id } })).toBe(0);
  });
});
