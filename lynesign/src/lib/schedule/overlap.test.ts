import { describe, it, expect, beforeEach } from "vitest";

import { prisma } from "@/lib/db/root";
import { withOrgTransaction } from "@/lib/db/tenant";
import { resetDb, seedPlans } from "@/test/helpers/db";
import {
  daysOverlap,
  minutesOverlap,
  datesOverlap,
  assertNoScheduleOverlap,
  ScheduleOverlapError,
} from "@/lib/schedule/overlap";

/**
 * Task 5 covers two things that must not be confused: the pure predicates,
 * where minute ranges are half-open (adjacent does not overlap) and date
 * ranges are inclusive (touching does overlap), and `assertNoScheduleOverlap`,
 * which resolves screen sets against the real database and throws
 * `ScheduleOverlapError` for the first sibling rule that collides on screens,
 * weekdays, minutes and effective dates all at once.
 */

describe("minutesOverlap", () => {
  it("treats adjacent half-open ranges as non-overlapping", () => {
    expect(
      minutesOverlap({ startMinute: 540, endMinute: 720 }, { startMinute: 720, endMinute: 900 }),
    ).toBe(false);
  });

  it("reports an overlap when the second range starts one minute early", () => {
    expect(
      minutesOverlap({ startMinute: 540, endMinute: 720 }, { startMinute: 719, endMinute: 900 }),
    ).toBe(true);
  });
});

describe("daysOverlap", () => {
  it("is true when the two weekday lists share a day", () => {
    expect(daysOverlap([1, 2, 3], [3, 4])).toBe(true);
  });

  it("is false when the two weekday lists are disjoint", () => {
    expect(daysOverlap([1, 2, 3], [4, 5])).toBe(false);
  });
});

describe("datesOverlap", () => {
  it("is true when both ranges are fully open", () => {
    expect(
      datesOverlap(
        { effectiveFrom: null, effectiveUntil: null },
        { effectiveFrom: null, effectiveUntil: null },
      ),
    ).toBe(true);
  });

  it("is false for one-sided ranges that do not reach each other", () => {
    expect(
      datesOverlap(
        { effectiveFrom: null, effectiveUntil: "2026-06-30" },
        { effectiveFrom: "2026-07-01", effectiveUntil: null },
      ),
    ).toBe(false);
  });

  it("is false for adjacent day ranges", () => {
    expect(
      datesOverlap(
        { effectiveFrom: null, effectiveUntil: "2026-06-30" },
        { effectiveFrom: "2026-07-01", effectiveUntil: null },
      ),
    ).toBe(false);
  });

  it("is true for ranges that touch on a single day", () => {
    expect(
      datesOverlap(
        { effectiveFrom: null, effectiveUntil: "2026-06-30" },
        { effectiveFrom: "2026-06-30", effectiveUntil: null },
      ),
    ).toBe(true);
  });
});

describe("assertNoScheduleOverlap", () => {
  let orgId = "";
  let playlistId = "";
  let loc1Id = "";
  let s1Id = "";

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
    const loc1 = await prisma.location.create({
      data: { organizationId: org.id, name: "North" },
    });
    const s1 = await prisma.screen.create({
      data: { organizationId: org.id, locationId: loc1.id, name: "Screen 1" },
    });

    orgId = org.id;
    playlistId = playlist.id;
    loc1Id = loc1.id;
    s1Id = s1.id;
  });

  interface SiblingOver {
    name?: string;
    daysOfWeek?: number[];
    startMinute?: number;
    endMinute?: number;
    effectiveFrom?: Date | null;
    effectiveUntil?: Date | null;
    enabled?: boolean;
    screenIds?: string[];
    locationIds?: string[];
  }

  async function makeSibling(over: SiblingOver = {}): Promise<string> {
    return withOrgTransaction(orgId, async (tx) => {
      const rule = await tx.scheduleRule.create({
        data: {
          organizationId: orgId,
          name: over.name ?? "Morning loop",
          playlistId,
          daysOfWeek: over.daysOfWeek ?? [1, 2, 3],
          startMinute: over.startMinute ?? 540,
          endMinute: over.endMinute ?? 720,
          effectiveFrom: over.effectiveFrom ?? null,
          effectiveUntil: over.effectiveUntil ?? null,
          enabled: over.enabled ?? true,
          screens: {
            create: (over.screenIds ?? []).map((screenId) => ({ organizationId: orgId, screenId })),
          },
          locations: {
            create: (over.locationIds ?? []).map((locationId) => ({
              organizationId: orgId,
              locationId,
            })),
          },
        },
      });
      return rule.id;
    });
  }

  interface CandidateOver {
    id?: string;
    screenIds?: string[];
    locationIds?: string[];
    daysOfWeek?: number[];
    startMinute?: number;
    endMinute?: number;
    effectiveFrom?: string | null;
    effectiveUntil?: string | null;
  }

  function candidateOf(over: CandidateOver = {}) {
    return {
      ...(over.id ? { id: over.id } : {}),
      screenIds: over.screenIds ?? [],
      locationIds: over.locationIds ?? [],
      daysOfWeek: over.daysOfWeek ?? [1, 2, 3],
      startMinute: over.startMinute ?? 600,
      endMinute: over.endMinute ?? 780,
      effectiveFrom: over.effectiveFrom ?? null,
      effectiveUntil: over.effectiveUntil ?? null,
    };
  }

  function check(over: CandidateOver = {}): Promise<void> {
    return withOrgTransaction(orgId, (tx) => assertNoScheduleOverlap(tx, orgId, candidateOf(over)));
  }

  it("throws when the candidate and a sibling target the same screen directly", async () => {
    await makeSibling({ screenIds: [s1Id] });
    await expect(check({ screenIds: [s1Id] })).rejects.toBeInstanceOf(ScheduleOverlapError);
  });

  it("does not throw when the minute ranges are only adjacent", async () => {
    await makeSibling({ screenIds: [s1Id], startMinute: 540, endMinute: 720 });
    await expect(
      check({ screenIds: [s1Id], startMinute: 720, endMinute: 900 }),
    ).resolves.toBeUndefined();
  });

  it("does not throw when the weekday sets are disjoint", async () => {
    await makeSibling({ screenIds: [s1Id], daysOfWeek: [1, 2, 3] });
    await expect(
      check({ screenIds: [s1Id], daysOfWeek: [4, 5] }),
    ).resolves.toBeUndefined();
  });

  it("ignores a disabled sibling that would otherwise collide", async () => {
    await makeSibling({ screenIds: [s1Id], enabled: false });
    await expect(check({ screenIds: [s1Id] })).resolves.toBeUndefined();
  });

  it("does not throw when the effective date ranges do not meet", async () => {
    await makeSibling({ screenIds: [s1Id], effectiveUntil: new Date("2026-06-30") });
    await expect(
      check({ screenIds: [s1Id], effectiveFrom: "2026-07-01" }),
    ).resolves.toBeUndefined();
  });

  it("throws when both sides target the same location", async () => {
    await makeSibling({ locationIds: [loc1Id] });
    await expect(check({ locationIds: [loc1Id] })).rejects.toBeInstanceOf(ScheduleOverlapError);
  });

  it("throws when the candidate targets a screen whose location a sibling targets", async () => {
    await makeSibling({ locationIds: [loc1Id] });
    await expect(check({ screenIds: [s1Id] })).rejects.toBeInstanceOf(ScheduleOverlapError);
  });
});
