"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { requireRole } from "@/lib/auth/context";
import { withOrgTransaction } from "@/lib/db/tenant";
import { writeAudit } from "@/lib/audit";
import { NotFoundError } from "@/lib/errors";
import {
  idSchema,
  createScheduleRuleSchema,
  updateScheduleRuleSchema,
  setScheduleTargetsSchema,
  minutesToHHMM,
} from "@/lib/validation/schedule";
import { bumpScheduleRevision } from "@/lib/schedule/revision";
import {
  assertNoScheduleOverlap,
  ScheduleOverlapError,
  type ScheduleOverlapCandidate,
} from "@/lib/schedule/overlap";

/**
 * Schedule rule CRUD server actions. Every action gates on `requireRole` first,
 * then safe-parses its input, then resolves any id through the tenant `ctx.db`
 * facade (a miss is a `NotFoundError` or an `{ error }`), then writes inside one
 * `withOrgTransaction`, audits and revalidates.
 *
 * A screen's effective content is picked in three tiers: an active campaign wins
 * over an active schedule rule, which wins over the screen's base playlist. A
 * rule's `revision` is the version a screen compares against its cached copy;
 * `createScheduleRule` starts a row at 1, and every write that changes content
 * or targeting (`updateScheduleRule`, `setScheduleRuleEnabled`,
 * `setScheduleRuleTargets`) bumps it as its first transaction statement so the
 * bump and the change commit together and the bump locks the row against a
 * concurrent edit.
 *
 * `archiveScheduleRule`, `restoreScheduleRule` and `deleteScheduleRule` do not
 * bump `revision`. Sync filters `archivedAt: null` and the resolver never sees
 * an archived or deleted row, so the rule simply stops being a candidate: on the
 * next poll `source` flips back to "campaign" or "playlist", and `source` is
 * itself part of the device change key, so the screen still refetches.
 *
 * Every write path except `deleteScheduleRule` and `archiveScheduleRule` runs
 * `assertNoScheduleOverlap` inside the transaction before it commits; a
 * `ScheduleOverlapError` is caught and returned as `{ error }`, which rolls the
 * transaction back. No user-facing string here uses an em dash, an emoji or an
 * exclamation point.
 */

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

function dayList(days: number[]): string {
  return [...days]
    .sort((a, b) => a - b)
    .map((d) => DAY_NAMES[d] ?? String(d))
    .join(", ");
}

function friendlyOverlapMessage(e: ScheduleOverlapError): string {
  const who = e.conflictName ? `"${e.conflictName}"` : "another rule";
  return `This overlaps ${who} on ${dayList(e.conflictDays)}, ${minutesToHHMM(
    e.conflictStartMinute,
  )} to ${minutesToHHMM(e.conflictEndMinute)}. Adjust the time, days, or targets.`;
}

/** UTC-midnight `Date` for a plain "YYYY-MM-DD" calendar date, for `@db.Date` columns. */
function dateOnly(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

/** Plain "YYYY-MM-DD" for a `@db.Date` value Prisma returns as a UTC-midnight `Date`. */
function ymd(d: Date | null): string | null {
  return d ? d.toISOString().slice(0, 10) : null;
}

type RuleWithTargets = {
  id: string;
  daysOfWeek: number[];
  startMinute: number;
  endMinute: number;
  effectiveFrom: Date | null;
  effectiveUntil: Date | null;
  screens: { screenId: string }[];
  locations: { locationId: string }[];
};

function candidateFromRule(rule: RuleWithTargets): ScheduleOverlapCandidate {
  return {
    id: rule.id,
    screenIds: rule.screens.map((s) => s.screenId),
    locationIds: rule.locations.map((l) => l.locationId),
    daysOfWeek: rule.daysOfWeek,
    startMinute: rule.startMinute,
    endMinute: rule.endMinute,
    effectiveFrom: ymd(rule.effectiveFrom),
    effectiveUntil: ymd(rule.effectiveUntil),
  };
}

const targetsInclude = {
  screens: { select: { screenId: true } },
  locations: { select: { locationId: true } },
} as const;

const INVALID_INPUT = "Check the schedule rule details.";
const RULE_GONE = "That schedule rule no longer exists.";
const TARGET_NOT_IN_ORG = "One of those targets is not in your organization.";

type Ctx = Awaited<ReturnType<typeof requireRole>>;

async function assertPayloadResolves(
  ctx: Ctx,
  playlistId: string | null | undefined,
  campaignId: string | null | undefined,
): Promise<string | null> {
  if (playlistId) {
    const playlist = await ctx.db.playlist.findUnique({ where: { id: playlistId } });
    if (!playlist || playlist.archivedAt !== null) {
      return "Choose a playlist from your organization.";
    }
  }
  if (campaignId) {
    const campaign = await ctx.db.campaign.findUnique({ where: { id: campaignId } });
    if (!campaign || campaign.archivedAt !== null) {
      return "Choose a campaign from your organization.";
    }
  }
  return null;
}

async function assertTargetsResolve(
  ctx: Ctx,
  screenIds: string[],
  locationIds: string[],
): Promise<string | null> {
  if (screenIds.length) {
    const found = await ctx.db.screen.findMany({
      where: { id: { in: screenIds } },
      select: { id: true },
    });
    if (found.length !== screenIds.length) return TARGET_NOT_IN_ORG;
  }
  if (locationIds.length) {
    const found = await ctx.db.location.findMany({
      where: { id: { in: locationIds } },
      select: { id: true },
    });
    if (found.length !== locationIds.length) return TARGET_NOT_IN_ORG;
  }
  return null;
}

export async function createScheduleRule(input: {
  name?: string;
  playlistId?: string;
  campaignId?: string;
  daysOfWeek: number[];
  startMinute: number;
  endMinute: number;
  effectiveFrom?: string;
  effectiveUntil?: string;
  screenIds: string[];
  locationIds: string[];
  enabled?: boolean;
}): Promise<{ id: string } | { error: string }> {
  const ctx = await requireRole("schedule.create");

  const parsed = createScheduleRuleSchema.safeParse(input);
  if (!parsed.success) return { error: INVALID_INPUT };
  const data = parsed.data;

  const payloadError = await assertPayloadResolves(ctx, data.playlistId, data.campaignId);
  if (payloadError) return { error: payloadError };

  const screenIds = [...new Set(data.screenIds)];
  const locationIds = [...new Set(data.locationIds)];
  const targetError = await assertTargetsResolve(ctx, screenIds, locationIds);
  if (targetError) return { error: targetError };

  const effectiveFrom = data.effectiveFrom ?? null;
  const effectiveUntil = data.effectiveUntil ?? null;

  let newId = "";
  try {
    await withOrgTransaction(ctx.organizationId, async (tx) => {
      const rule = await tx.scheduleRule.create({
        data: {
          organizationId: ctx.organizationId,
          name: data.name ?? null,
          playlistId: data.playlistId ?? null,
          campaignId: data.campaignId ?? null,
          daysOfWeek: data.daysOfWeek,
          startMinute: data.startMinute,
          endMinute: data.endMinute,
          effectiveFrom: effectiveFrom ? dateOnly(effectiveFrom) : null,
          effectiveUntil: effectiveUntil ? dateOnly(effectiveUntil) : null,
          enabled: data.enabled,
          createdByUserId: ctx.user.id,
        },
      });
      newId = rule.id;

      if (screenIds.length) {
        await tx.scheduleRuleScreen.createMany({
          data: screenIds.map((screenId) => ({
            organizationId: ctx.organizationId,
            scheduleRuleId: rule.id,
            screenId,
          })),
          skipDuplicates: true,
        });
      }
      if (locationIds.length) {
        await tx.scheduleRuleLocation.createMany({
          data: locationIds.map((locationId) => ({
            organizationId: ctx.organizationId,
            scheduleRuleId: rule.id,
            locationId,
          })),
          skipDuplicates: true,
        });
      }

      await assertNoScheduleOverlap(tx, ctx.organizationId, {
        id: rule.id,
        screenIds,
        locationIds,
        daysOfWeek: data.daysOfWeek,
        startMinute: data.startMinute,
        endMinute: data.endMinute,
        effectiveFrom,
        effectiveUntil,
      });
    });
  } catch (e) {
    if (e instanceof ScheduleOverlapError) return { error: friendlyOverlapMessage(e) };
    throw e;
  }

  await writeAudit({
    organizationId: ctx.organizationId,
    actorType: "USER",
    actorId: ctx.user.id,
    action: "schedule.create",
    targetType: "ScheduleRule",
    targetId: newId,
  });

  revalidatePath("/schedule");

  let firstTargetScreenId: string | undefined = screenIds[0];
  if (!firstTargetScreenId && locationIds[0]) {
    const screen = await ctx.db.screen.findFirst({
      where: { locationId: locationIds[0] },
      select: { id: true },
      orderBy: { createdAt: "asc" },
    });
    firstTargetScreenId = screen?.id;
  }

  redirect(`/schedule?screen=${firstTargetScreenId ?? ""}`);
  // `redirect` throws in a real request; returning keeps the type checker and
  // the unit tests, which stub `redirect`, satisfied.
  return { id: newId };
}

export async function updateScheduleRule(
  id: string,
  patch: {
    name?: string;
    playlistId?: string | null;
    campaignId?: string | null;
    daysOfWeek?: number[];
    startMinute?: number;
    endMinute?: number;
    effectiveFrom?: string | null;
    effectiveUntil?: string | null;
    enabled?: boolean;
  },
): Promise<{ id: string } | { error: string }> {
  const ctx = await requireRole("schedule.update");

  if (!idSchema.safeParse({ id }).success) return { error: INVALID_INPUT };
  const parsed = updateScheduleRuleSchema.safeParse(patch);
  if (!parsed.success) return { error: INVALID_INPUT };
  const data = parsed.data;

  const rule = await ctx.db.scheduleRule.findUnique({
    where: { id },
    include: targetsInclude,
  });
  if (!rule) throw new NotFoundError(RULE_GONE);

  const payloadInPatch = data.playlistId !== undefined || data.campaignId !== undefined;
  if (payloadInPatch) {
    const payloadError = await assertPayloadResolves(ctx, data.playlistId, data.campaignId);
    if (payloadError) return { error: payloadError };
  }

  const updateData: {
    name?: string | null;
    playlistId?: string | null;
    campaignId?: string | null;
    daysOfWeek?: number[];
    startMinute?: number;
    endMinute?: number;
    effectiveFrom?: Date | null;
    effectiveUntil?: Date | null;
    enabled?: boolean;
  } = {};
  if (data.name !== undefined) updateData.name = data.name;
  if (payloadInPatch) {
    updateData.playlistId = data.playlistId ?? null;
    updateData.campaignId = data.campaignId ?? null;
  }
  if (data.daysOfWeek !== undefined) updateData.daysOfWeek = data.daysOfWeek;
  if (data.startMinute !== undefined) updateData.startMinute = data.startMinute;
  if (data.endMinute !== undefined) updateData.endMinute = data.endMinute;
  if (data.effectiveFrom !== undefined) {
    updateData.effectiveFrom = data.effectiveFrom ? dateOnly(data.effectiveFrom) : null;
  }
  if (data.effectiveUntil !== undefined) {
    updateData.effectiveUntil = data.effectiveUntil ? dateOnly(data.effectiveUntil) : null;
  }
  if (data.enabled !== undefined) updateData.enabled = data.enabled;

  // A one-sided patch skips the zod pair refines (they only fire when both
  // halves of a pair are in the patch), so cross-check the merged row the same
  // way `updateCampaign` checks its merged date window. Without this an
  // inverted minute window trips the DB CHECK as a 500, and an inverted date
  // window has no DB CHECK at all and would commit a permanently dead rule.
  const mergedStartMinute = data.startMinute ?? rule.startMinute;
  const mergedEndMinute = data.endMinute ?? rule.endMinute;
  if (mergedEndMinute <= mergedStartMinute) {
    return { error: "End time must be after start time." };
  }
  const mergedFrom =
    data.effectiveFrom !== undefined ? (data.effectiveFrom ?? null) : ymd(rule.effectiveFrom);
  const mergedUntil =
    data.effectiveUntil !== undefined
      ? (data.effectiveUntil ?? null)
      : ymd(rule.effectiveUntil);
  if (mergedFrom != null && mergedUntil != null && mergedUntil < mergedFrom) {
    return { error: "The effective end date must be on or after the start date." };
  }

  const candidate: ScheduleOverlapCandidate = {
    id,
    screenIds: rule.screens.map((s) => s.screenId),
    locationIds: rule.locations.map((l) => l.locationId),
    daysOfWeek: data.daysOfWeek ?? rule.daysOfWeek,
    startMinute: mergedStartMinute,
    endMinute: mergedEndMinute,
    effectiveFrom: mergedFrom,
    effectiveUntil: mergedUntil,
  };
  const enabledAfter = data.enabled ?? rule.enabled;

  try {
    await withOrgTransaction(ctx.organizationId, async (tx) => {
      await bumpScheduleRevision(tx, id);
      await tx.scheduleRule.update({ where: { id }, data: updateData });
      if (enabledAfter) {
        await assertNoScheduleOverlap(tx, ctx.organizationId, candidate);
      }
    });
  } catch (e) {
    if (e instanceof ScheduleOverlapError) return { error: friendlyOverlapMessage(e) };
    throw e;
  }

  await writeAudit({
    organizationId: ctx.organizationId,
    actorType: "USER",
    actorId: ctx.user.id,
    action: "schedule.update",
    targetType: "ScheduleRule",
    targetId: id,
  });

  revalidatePath("/schedule");
  return { id };
}

export async function setScheduleRuleEnabled(
  id: string,
  enabled: boolean,
): Promise<{ id: string } | { error: string }> {
  const ctx = await requireRole("schedule.update");

  if (!idSchema.safeParse({ id }).success) return { error: INVALID_INPUT };
  if (!z.boolean().safeParse(enabled).success) return { error: INVALID_INPUT };

  const rule = await ctx.db.scheduleRule.findUnique({
    where: { id },
    include: targetsInclude,
  });
  if (!rule) throw new NotFoundError(RULE_GONE);

  try {
    await withOrgTransaction(ctx.organizationId, async (tx) => {
      await bumpScheduleRevision(tx, id);
      await tx.scheduleRule.update({ where: { id }, data: { enabled } });
      if (enabled) {
        await assertNoScheduleOverlap(tx, ctx.organizationId, candidateFromRule(rule));
      }
    });
  } catch (e) {
    if (e instanceof ScheduleOverlapError) return { error: friendlyOverlapMessage(e) };
    throw e;
  }

  await writeAudit({
    organizationId: ctx.organizationId,
    actorType: "USER",
    actorId: ctx.user.id,
    action: "schedule.setEnabled",
    targetType: "ScheduleRule",
    targetId: id,
  });

  revalidatePath("/schedule");
  return { id };
}

export async function setScheduleRuleTargets(
  id: string,
  input: { screenIds: string[]; locationIds: string[] },
): Promise<{ id: string } | { error: string }> {
  const ctx = await requireRole("schedule.assign");

  if (!idSchema.safeParse({ id }).success) return { error: INVALID_INPUT };
  const parsed = setScheduleTargetsSchema.safeParse(input);
  if (!parsed.success) return { error: INVALID_INPUT };

  const rule = await ctx.db.scheduleRule.findUnique({ where: { id } });
  if (!rule) throw new NotFoundError(RULE_GONE);

  const screenIds = [...new Set(parsed.data.screenIds)];
  const locationIds = [...new Set(parsed.data.locationIds)];
  const targetError = await assertTargetsResolve(ctx, screenIds, locationIds);
  if (targetError) return { error: targetError };

  try {
    await withOrgTransaction(ctx.organizationId, async (tx) => {
      await bumpScheduleRevision(tx, id);

      await tx.scheduleRuleScreen.deleteMany({ where: { scheduleRuleId: id } });
      await tx.scheduleRuleLocation.deleteMany({ where: { scheduleRuleId: id } });

      if (screenIds.length) {
        await tx.scheduleRuleScreen.createMany({
          data: screenIds.map((screenId) => ({
            organizationId: ctx.organizationId,
            scheduleRuleId: id,
            screenId,
          })),
          skipDuplicates: true,
        });
      }
      if (locationIds.length) {
        await tx.scheduleRuleLocation.createMany({
          data: locationIds.map((locationId) => ({
            organizationId: ctx.organizationId,
            scheduleRuleId: id,
            locationId,
          })),
          skipDuplicates: true,
        });
      }

      await assertNoScheduleOverlap(tx, ctx.organizationId, {
        id,
        screenIds,
        locationIds,
        daysOfWeek: rule.daysOfWeek,
        startMinute: rule.startMinute,
        endMinute: rule.endMinute,
        effectiveFrom: ymd(rule.effectiveFrom),
        effectiveUntil: ymd(rule.effectiveUntil),
      });
    });
  } catch (e) {
    if (e instanceof ScheduleOverlapError) return { error: friendlyOverlapMessage(e) };
    throw e;
  }

  await writeAudit({
    organizationId: ctx.organizationId,
    actorType: "USER",
    actorId: ctx.user.id,
    action: "schedule.setTargets",
    targetType: "ScheduleRule",
    targetId: id,
    metadata: { screens: screenIds.length, locations: locationIds.length },
  });

  revalidatePath("/schedule");
  return { id };
}

export async function archiveScheduleRule(
  id: string,
): Promise<{ ok: true } | { error: string }> {
  const ctx = await requireRole("schedule.update");

  if (!idSchema.safeParse({ id }).success) return { error: RULE_GONE };

  const rule = await ctx.db.scheduleRule.findUnique({ where: { id } });
  if (!rule) throw new NotFoundError(RULE_GONE);

  await ctx.db.scheduleRule.update({ where: { id }, data: { archivedAt: new Date() } });

  await writeAudit({
    organizationId: ctx.organizationId,
    actorType: "USER",
    actorId: ctx.user.id,
    action: "schedule.archive",
    targetType: "ScheduleRule",
    targetId: id,
  });

  revalidatePath("/schedule");
  return { ok: true };
}

export async function restoreScheduleRule(
  id: string,
): Promise<{ ok: true } | { error: string }> {
  const ctx = await requireRole("schedule.update");

  if (!idSchema.safeParse({ id }).success) return { error: RULE_GONE };

  const rule = await ctx.db.scheduleRule.findUnique({
    where: { id },
    include: targetsInclude,
  });
  if (!rule) throw new NotFoundError(RULE_GONE);

  try {
    await withOrgTransaction(ctx.organizationId, async (tx) => {
      await tx.scheduleRule.update({ where: { id }, data: { archivedAt: null } });
      await assertNoScheduleOverlap(tx, ctx.organizationId, candidateFromRule(rule));
    });
  } catch (e) {
    if (e instanceof ScheduleOverlapError) return { error: friendlyOverlapMessage(e) };
    throw e;
  }

  await writeAudit({
    organizationId: ctx.organizationId,
    actorType: "USER",
    actorId: ctx.user.id,
    action: "schedule.restore",
    targetType: "ScheduleRule",
    targetId: id,
  });

  revalidatePath("/schedule");
  return { ok: true };
}

export async function deleteScheduleRule(
  id: string,
): Promise<{ ok: true } | { error: string }> {
  const ctx = await requireRole("schedule.delete");

  if (!idSchema.safeParse({ id }).success) return { error: RULE_GONE };

  const rule = await ctx.db.scheduleRule.findUnique({ where: { id } });
  if (!rule) throw new NotFoundError(RULE_GONE);

  await ctx.db.scheduleRule.delete({ where: { id } });

  await writeAudit({
    organizationId: ctx.organizationId,
    actorType: "USER",
    actorId: ctx.user.id,
    action: "schedule.delete",
    targetType: "ScheduleRule",
    targetId: id,
  });

  revalidatePath("/schedule");
  return { ok: true };
}
