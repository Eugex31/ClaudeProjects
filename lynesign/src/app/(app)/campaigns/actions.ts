"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireRole } from "@/lib/auth/context";
import { withOrgTransaction } from "@/lib/db/tenant";
import { writeAudit } from "@/lib/audit";
import { NotFoundError } from "@/lib/errors";
import {
  idSchema,
  createCampaignSchema,
  updateCampaignSchema,
  setTargetsSchema,
} from "@/lib/validation/campaigns";
import { bumpCampaignRevision } from "@/lib/campaigns/revision";

/**
 * Campaign CRUD server actions. Every action gates on `requireRole` first, then
 * safe-parses its input, then resolves any id through the tenant `ctx.db` facade
 * (a miss is a `NotFoundError`), then writes, audits and revalidates.
 *
 * `revision` is the version a screen compares against its cached copy. Any
 * `updateCampaign` (content, window, priority) and any `setCampaignEnabled`
 * bumps it, since all of that feeds a screen's effective content. `createCampaign`
 * starts a row at 1 and `deleteCampaign` removes it, so neither bumps.
 * `archiveCampaign`, `restoreCampaign` and `deleteCampaign` do not bump either:
 * an archived or deleted campaign stops being a candidate immediately (sync
 * filters `archivedAt: null` and the resolver rejects archived rows), so the
 * device sees the change through `source` flipping back to "playlist" (or
 * "none") on its next poll, and `source` is itself part of the change key.
 */

export async function createCampaign(input: {
  name: string;
  description?: string;
  playlistId: string;
  startsAt: string;
  endsAt: string;
  priority?: number;
}): Promise<{ id: string } | { error: string }> {
  const ctx = await requireRole("campaign.create");

  const parsed = createCampaignSchema.safeParse(input);
  if (!parsed.success) return { error: "Check the campaign details." };

  const playlist = await ctx.db.playlist.findUnique({
    where: { id: parsed.data.playlistId },
  });
  if (!playlist || playlist.archivedAt !== null) {
    return { error: "Choose a playlist from your organization." };
  }

  const campaign = await ctx.db.campaign.create({
    data: {
      organizationId: ctx.organizationId,
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      playlistId: parsed.data.playlistId,
      startsAt: new Date(parsed.data.startsAt),
      endsAt: new Date(parsed.data.endsAt),
      priority: parsed.data.priority ?? 0,
      createdByUserId: ctx.user.id,
    },
  });

  await writeAudit({
    organizationId: ctx.organizationId,
    actorType: "USER",
    actorId: ctx.user.id,
    action: "campaign.create",
    targetType: "Campaign",
    targetId: campaign.id,
  });

  revalidatePath("/campaigns");
  return { id: campaign.id };
}

export async function updateCampaign(
  id: string,
  patch: {
    name?: string;
    description?: string | null;
    playlistId?: string;
    startsAt?: string;
    endsAt?: string;
    priority?: number;
  },
): Promise<{ error?: string }> {
  const ctx = await requireRole("campaign.update");

  if (!idSchema.safeParse(id).success) return { error: "That change is not valid." };
  const parsed = updateCampaignSchema.safeParse(patch);
  if (!parsed.success) return { error: "That change is not valid." };

  const campaign = await ctx.db.campaign.findUnique({ where: { id } });
  if (!campaign) throw new NotFoundError("That campaign no longer exists.");

  if (parsed.data.playlistId !== undefined) {
    const playlist = await ctx.db.playlist.findUnique({
      where: { id: parsed.data.playlistId },
    });
    if (!playlist || playlist.archivedAt !== null) {
      return { error: "Choose a playlist from your organization." };
    }
  }

  const effectiveStartsAt = parsed.data.startsAt
    ? new Date(parsed.data.startsAt)
    : campaign.startsAt;
  const effectiveEndsAt = parsed.data.endsAt
    ? new Date(parsed.data.endsAt)
    : campaign.endsAt;
  if (!(effectiveEndsAt.getTime() > effectiveStartsAt.getTime())) {
    return { error: "The end must be after the start." };
  }

  const data: {
    name?: string;
    description?: string | null;
    playlistId?: string;
    startsAt?: Date;
    endsAt?: Date;
    priority?: number;
  } = {};
  if (parsed.data.name !== undefined) data.name = parsed.data.name;
  if (parsed.data.description !== undefined) data.description = parsed.data.description;
  if (parsed.data.playlistId !== undefined) data.playlistId = parsed.data.playlistId;
  if (parsed.data.startsAt !== undefined) data.startsAt = new Date(parsed.data.startsAt);
  if (parsed.data.endsAt !== undefined) data.endsAt = new Date(parsed.data.endsAt);
  if (parsed.data.priority !== undefined) data.priority = parsed.data.priority;

  await withOrgTransaction(ctx.organizationId, async (tx) => {
    await tx.campaign.update({ where: { id }, data });
    await bumpCampaignRevision(tx, id);
  });

  await writeAudit({
    organizationId: ctx.organizationId,
    actorType: "USER",
    actorId: ctx.user.id,
    action: "campaign.update",
    targetType: "Campaign",
    targetId: id,
  });

  revalidatePath("/campaigns");
  revalidatePath(`/campaigns/${id}`);
  return {};
}

export async function setCampaignEnabled(
  id: string,
  enabled: boolean,
): Promise<{ error?: string }> {
  const ctx = await requireRole("campaign.update");

  if (!idSchema.safeParse(id).success) return { error: "That change is not valid." };
  if (!z.boolean().safeParse(enabled).success) return { error: "That change is not valid." };

  const campaign = await ctx.db.campaign.findUnique({ where: { id } });
  if (!campaign) throw new NotFoundError("That campaign no longer exists.");

  await withOrgTransaction(ctx.organizationId, async (tx) => {
    await tx.campaign.update({ where: { id }, data: { enabled } });
    await bumpCampaignRevision(tx, id);
  });

  await writeAudit({
    organizationId: ctx.organizationId,
    actorType: "USER",
    actorId: ctx.user.id,
    action: "campaign.enabled",
    targetType: "Campaign",
    targetId: id,
  });

  revalidatePath("/campaigns");
  revalidatePath(`/campaigns/${id}`);
  return {};
}

export async function archiveCampaign(id: string): Promise<{ error?: string }> {
  const ctx = await requireRole("campaign.delete");

  if (!idSchema.safeParse(id).success) return { error: "That campaign no longer exists." };

  const campaign = await ctx.db.campaign.findUnique({ where: { id } });
  if (!campaign) throw new NotFoundError("That campaign no longer exists.");

  await ctx.db.campaign.update({ where: { id }, data: { archivedAt: new Date() } });

  await writeAudit({
    organizationId: ctx.organizationId,
    actorType: "USER",
    actorId: ctx.user.id,
    action: "campaign.archive",
    targetType: "Campaign",
    targetId: id,
  });

  revalidatePath("/campaigns");
  revalidatePath(`/campaigns/${id}`);
  return {};
}

export async function restoreCampaign(id: string): Promise<{ error?: string }> {
  const ctx = await requireRole("campaign.update");

  if (!idSchema.safeParse(id).success) return { error: "That campaign no longer exists." };

  const campaign = await ctx.db.campaign.findUnique({ where: { id } });
  if (!campaign) throw new NotFoundError("That campaign no longer exists.");

  await ctx.db.campaign.update({ where: { id }, data: { archivedAt: null } });

  await writeAudit({
    organizationId: ctx.organizationId,
    actorType: "USER",
    actorId: ctx.user.id,
    action: "campaign.restore",
    targetType: "Campaign",
    targetId: id,
  });

  revalidatePath("/campaigns");
  revalidatePath(`/campaigns/${id}`);
  return {};
}

export async function deleteCampaign(id: string): Promise<{ error?: string }> {
  const ctx = await requireRole("campaign.delete");

  if (!idSchema.safeParse(id).success) return { error: "That campaign no longer exists." };

  const campaign = await ctx.db.campaign.findUnique({ where: { id } });
  if (!campaign) throw new NotFoundError("That campaign no longer exists.");

  const usedBySchedule = await ctx.db.scheduleRule.count({ where: { campaignId: id } });
  if (usedBySchedule > 0) {
    return { error: "That campaign is used by a schedule rule. Remove it from the schedule first." };
  }

  await ctx.db.campaign.delete({ where: { id } });

  await writeAudit({
    organizationId: ctx.organizationId,
    actorType: "USER",
    actorId: ctx.user.id,
    action: "campaign.delete",
    targetType: "Campaign",
    targetId: id,
  });

  revalidatePath("/campaigns");
  return {};
}

/**
 * Replace a campaign's screen and location targets with the given sets.
 *
 * The two id lists are deduped, then every id is checked for membership in the
 * caller's organization with one `findMany` per kind: an id the org-scoped
 * facade does not return simply is not there, so a length mismatch means a
 * stranger id was passed and nothing is written. The swap itself is one
 * transaction: the revision is bumped first (locking the Campaign row so
 * concurrent edits serialize), stale join rows are deleted (when the keep-set is
 * empty a sentinel that matches no real id stands in, so every existing row is
 * removed; this does not depend on how a given Prisma version compiles an empty
 * `notIn`), and the wanted rows are created with `skipDuplicates`, so every
 * targeted screen sees its cached copy is stale.
 */
export async function setCampaignTargets(
  id: string,
  input: { screenIds: string[]; locationIds: string[] },
): Promise<{ error?: string }> {
  const ctx = await requireRole("campaign.update");

  if (!idSchema.safeParse(id).success) return { error: "That change is not valid." };
  const parsed = setTargetsSchema.safeParse(input);
  if (!parsed.success) return { error: "That change is not valid." };

  const campaign = await ctx.db.campaign.findUnique({ where: { id } });
  if (!campaign) throw new NotFoundError("That campaign no longer exists.");

  const uScreens = [...new Set(input.screenIds)];
  const uLocations = [...new Set(input.locationIds)];

  const screens = await ctx.db.screen.findMany({
    where: { id: { in: uScreens } },
    select: { id: true },
  });
  if (screens.length !== uScreens.length) {
    return { error: "One of those targets is not in your organization." };
  }

  const locations = await ctx.db.location.findMany({
    where: { id: { in: uLocations } },
    select: { id: true },
  });
  if (locations.length !== uLocations.length) {
    return { error: "One of those targets is not in your organization." };
  }

  await withOrgTransaction(ctx.organizationId, async (tx) => {
    // Bump first: this locks the Campaign row and serializes every mutation on
    // it, so two concurrent target edits cannot merge into a union under READ
    // COMMITTED. The delete/create pairs below run only once the lock is held.
    await bumpCampaignRevision(tx, id);

    await tx.campaignScreen.deleteMany({
      where: {
        campaignId: id,
        screenId: { notIn: uScreens.length ? uScreens : ["__none__"] },
      },
    });
    if (uScreens.length) {
      await tx.campaignScreen.createMany({
        data: uScreens.map((screenId) => ({
          organizationId: ctx.organizationId,
          campaignId: id,
          screenId,
        })),
        skipDuplicates: true,
      });
    }

    await tx.campaignLocation.deleteMany({
      where: {
        campaignId: id,
        locationId: { notIn: uLocations.length ? uLocations : ["__none__"] },
      },
    });
    if (uLocations.length) {
      await tx.campaignLocation.createMany({
        data: uLocations.map((locationId) => ({
          organizationId: ctx.organizationId,
          campaignId: id,
          locationId,
        })),
        skipDuplicates: true,
      });
    }

  });

  await writeAudit({
    organizationId: ctx.organizationId,
    actorType: "USER",
    actorId: ctx.user.id,
    action: "campaign.targets",
    targetType: "Campaign",
    targetId: id,
    metadata: { screens: input.screenIds.length, locations: input.locationIds.length },
  });

  revalidatePath("/campaigns");
  revalidatePath(`/campaigns/${id}`);
  return {};
}
