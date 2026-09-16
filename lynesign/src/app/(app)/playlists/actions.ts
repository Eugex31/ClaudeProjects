"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireRole } from "@/lib/auth/context";
import { withOrgTransaction } from "@/lib/db/tenant";
import { writeAudit } from "@/lib/audit";
import { NotFoundError } from "@/lib/errors";
import {
  idSchema,
  createPlaylistSchema,
  updatePlaylistSchema,
  addItemsSchema,
  reorderItemsSchema,
  setItemDurationSchema,
} from "@/lib/validation/playlists";
import { bumpRevision } from "@/lib/playlists/revision";

/**
 * Thrown inside an item-mutation transaction to abort it with a caller-facing
 * error. Because `bumpRevision` is the first statement in each of those
 * transactions (it takes the `Playlist` row lock that serializes concurrent
 * mutations), a plain early return would still commit that bump; throwing rolls
 * the whole transaction back so a rejected edit leaves `revision` untouched.
 */
class MutationReject extends Error {
  constructor(readonly payload: { error: string }) {
    super(payload.error);
    this.name = "MutationReject";
  }
}

/**
 * Playlist CRUD server actions. Every action gates on `requireRole` first, then
 * safe-parses its input, then resolves any id through the tenant `ctx.db` facade
 * (a miss is a `NotFoundError`), then writes, audits and revalidates.
 *
 * `revision` is strictly the manifest-structure version. Any `updatePlaylist`
 * call (rename, description, or default-duration change) bumps `revision`
 * unconditionally, since the default durations it can change are emitted into
 * the manifest.
 * `archivePlaylist` and `restorePlaylist` do not: assembly still reads an
 * archived playlist and a screen keeps playing it until it is reassigned, so
 * archiving changes no manifest content. `createPlaylist` starts a row at 1 and
 * `deletePlaylist` removes it, so neither bumps.
 */

export async function createPlaylist(
  input: { name: string; description?: string },
): Promise<{ id: string } | { error: string }> {
  const ctx = await requireRole("playlist.create");

  const parsed = createPlaylistSchema.safeParse(input);
  if (!parsed.success) return { error: "Enter a playlist name." };

  const pl = await ctx.db.playlist.create({
    data: {
      organizationId: ctx.organizationId,
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      createdByUserId: ctx.user.id,
    },
  });

  await writeAudit({
    organizationId: ctx.organizationId,
    actorType: "USER",
    actorId: ctx.user.id,
    action: "playlist.create",
    targetType: "Playlist",
    targetId: pl.id,
  });

  revalidatePath("/playlists");
  return { id: pl.id };
}

export async function updatePlaylist(
  id: string,
  patch: {
    name?: string;
    description?: string | null;
    defaultImageDurationSeconds?: number;
    defaultWebDurationSeconds?: number;
  },
): Promise<{ error?: string }> {
  const ctx = await requireRole("playlist.update");

  if (!idSchema.safeParse(id).success) return { error: "That change is not valid." };
  const parsed = updatePlaylistSchema.safeParse(patch);
  if (!parsed.success) return { error: "That change is not valid." };

  const playlist = await ctx.db.playlist.findUnique({ where: { id } });
  if (!playlist) throw new NotFoundError("That playlist no longer exists.");

  const data: {
    name?: string;
    description?: string | null;
    defaultImageDurationSeconds?: number;
    defaultWebDurationSeconds?: number;
  } = {};
  if (parsed.data.name !== undefined) data.name = parsed.data.name;
  if (parsed.data.description !== undefined) data.description = parsed.data.description;
  if (parsed.data.defaultImageDurationSeconds !== undefined) {
    data.defaultImageDurationSeconds = parsed.data.defaultImageDurationSeconds;
  }
  if (parsed.data.defaultWebDurationSeconds !== undefined) {
    data.defaultWebDurationSeconds = parsed.data.defaultWebDurationSeconds;
  }

  await withOrgTransaction(ctx.organizationId, async (tx) => {
    await tx.playlist.update({ where: { id }, data });
    await bumpRevision(tx, id);
  });

  await writeAudit({
    organizationId: ctx.organizationId,
    actorType: "USER",
    actorId: ctx.user.id,
    action: "playlist.update",
    targetType: "Playlist",
    targetId: id,
  });

  revalidatePath("/playlists");
  revalidatePath(`/playlists/${id}`);
  return {};
}

export async function archivePlaylist(id: string): Promise<{ error?: string }> {
  const ctx = await requireRole("playlist.delete");

  if (!idSchema.safeParse(id).success) return { error: "That playlist no longer exists." };

  const playlist = await ctx.db.playlist.findUnique({ where: { id } });
  if (!playlist) throw new NotFoundError("That playlist no longer exists.");

  await ctx.db.playlist.update({ where: { id }, data: { archivedAt: new Date() } });

  await writeAudit({
    organizationId: ctx.organizationId,
    actorType: "USER",
    actorId: ctx.user.id,
    action: "playlist.archive",
    targetType: "Playlist",
    targetId: id,
  });

  revalidatePath("/playlists");
  revalidatePath(`/playlists/${id}`);
  return {};
}

export async function restorePlaylist(id: string): Promise<{ error?: string }> {
  const ctx = await requireRole("playlist.update");

  if (!idSchema.safeParse(id).success) return { error: "That playlist no longer exists." };

  const playlist = await ctx.db.playlist.findUnique({ where: { id } });
  if (!playlist) throw new NotFoundError("That playlist no longer exists.");

  await ctx.db.playlist.update({ where: { id }, data: { archivedAt: null } });

  await writeAudit({
    organizationId: ctx.organizationId,
    actorType: "USER",
    actorId: ctx.user.id,
    action: "playlist.restore",
    targetType: "Playlist",
    targetId: id,
  });

  revalidatePath("/playlists");
  revalidatePath(`/playlists/${id}`);
  return {};
}

export async function deletePlaylist(id: string): Promise<{ error?: string }> {
  const ctx = await requireRole("playlist.delete");

  if (!idSchema.safeParse(id).success) return { error: "That playlist no longer exists." };

  const playlist = await ctx.db.playlist.findUnique({ where: { id } });
  if (!playlist) throw new NotFoundError("That playlist no longer exists.");

  const usedBySchedule = await ctx.db.scheduleRule.count({ where: { playlistId: id } });
  if (usedBySchedule > 0) {
    return { error: "That playlist is used by a schedule rule. Remove it from the schedule first." };
  }

  const usedByCampaign = await ctx.db.campaign.count({ where: { playlistId: id } });
  if (usedByCampaign > 0) {
    return { error: "That playlist is used by a campaign. Remove it from the campaign first." };
  }

  await ctx.db.playlist.delete({ where: { id } });

  await writeAudit({
    organizationId: ctx.organizationId,
    actorType: "USER",
    actorId: ctx.user.id,
    action: "playlist.delete",
    targetType: "Playlist",
    targetId: id,
  });

  revalidatePath("/playlists");
  revalidatePath("/screens");
  return {};
}

/**
 * Playlist item actions. These own the ordered `position` column: every item in
 * a playlist holds a distinct position in a dense `0..n-1` range, and each of
 * these actions preserves that invariant. There is no database unique constraint
 * on `(playlistId, position)`, so `reorderItems` can write the final positions
 * in one straight pass without an offset dance. All five gate on
 * `requireRole("playlist.update")`, do their writes in one `withOrgTransaction`
 * that also bumps the playlist revision, then audit and revalidate.
 */

export async function addItems(
  playlistId: string,
  input: { mediaAssetIds: string[] },
): Promise<{ added: number } | { error: string }> {
  const ctx = await requireRole("playlist.update");

  if (!idSchema.safeParse(playlistId).success) {
    return { error: "That playlist no longer exists." };
  }
  const parsed = addItemsSchema.safeParse(input);
  if (!parsed.success) return { error: "Choose between one and one hundred assets." };

  const playlist = await ctx.db.playlist.findUnique({ where: { id: playlistId } });
  if (!playlist) throw new NotFoundError("That playlist no longer exists.");

  const { mediaAssetIds } = parsed.data;

  // Validate every distinct asset before writing anything: an available asset
  // resolves in this org, is not archived and has finished processing. The same
  // asset may appear more than once in one batch, so dedupe for the check only;
  // the batch is still inserted verbatim below.
  const unique = [...new Set(mediaAssetIds)];
  const available = await ctx.db.mediaAsset.findMany({
    where: { id: { in: unique }, archivedAt: null, status: "READY" },
    select: { id: true },
  });
  if (available.length !== unique.length) {
    return { error: "One of those assets is not available." };
  }

  await withOrgTransaction(ctx.organizationId, async (tx) => {
    await bumpRevision(tx, playlistId);
    const count = await tx.playlistItem.count({ where: { playlistId } });
    await tx.playlistItem.createMany({
      data: mediaAssetIds.map((mediaAssetId, i) => ({
        organizationId: ctx.organizationId,
        playlistId,
        mediaAssetId,
        position: count + i,
        enabled: true,
        durationSeconds: null,
      })),
    });
  });

  await writeAudit({
    organizationId: ctx.organizationId,
    actorType: "USER",
    actorId: ctx.user.id,
    action: "playlist.items.add",
    targetType: "Playlist",
    targetId: playlistId,
    metadata: { count: mediaAssetIds.length },
  });

  revalidatePath(`/playlists/${playlistId}`);
  return { added: mediaAssetIds.length };
}

export async function removeItem(itemId: string): Promise<{ error?: string }> {
  const ctx = await requireRole("playlist.update");

  if (!idSchema.safeParse(itemId).success) return { error: "That item no longer exists." };

  // Cheap ownership/existence gate: a cross-org or missing id fails here without
  // opening a transaction.
  const item = await ctx.db.playlistItem.findUnique({ where: { id: itemId } });
  if (!item) throw new NotFoundError("That item no longer exists.");

  const { playlistId } = item;

  try {
    await withOrgTransaction(ctx.organizationId, async (tx) => {
      // Bump first: this locks the Playlist row and serializes every mutation on
      // it, so the position read below runs on a post-lock snapshot.
      await bumpRevision(tx, playlistId);
      const fresh = await tx.playlistItem.findUnique({
        where: { id: itemId },
        select: { position: true, playlistId: true },
      });
      if (!fresh) throw new MutationReject({ error: "That item no longer exists." });
      await tx.playlistItem.delete({ where: { id: itemId } });
      await tx.playlistItem.updateMany({
        where: { playlistId: fresh.playlistId, position: { gt: fresh.position } },
        data: { position: { decrement: 1 } },
      });
    });
  } catch (err) {
    if (err instanceof MutationReject) return err.payload;
    throw err;
  }

  await writeAudit({
    organizationId: ctx.organizationId,
    actorType: "USER",
    actorId: ctx.user.id,
    action: "playlist.items.remove",
    targetType: "Playlist",
    targetId: playlistId,
  });

  revalidatePath(`/playlists/${playlistId}`);
  return {};
}

export async function reorderItems(
  playlistId: string,
  input: { itemIds: string[] },
): Promise<{ error?: string }> {
  const ctx = await requireRole("playlist.update");

  if (!idSchema.safeParse(playlistId).success) {
    return { error: "That reorder does not match the playlist." };
  }
  const parsed = reorderItemsSchema.safeParse(input);
  if (!parsed.success) return { error: "That reorder does not match the playlist." };

  // Cheap ownership gate: a cross-org or missing playlist fails here without
  // opening a transaction.
  const playlist = await ctx.db.playlist.findUnique({ where: { id: playlistId } });
  if (!playlist) throw new NotFoundError("That playlist no longer exists.");

  const { itemIds } = parsed.data;

  try {
    await withOrgTransaction(ctx.organizationId, async (tx) => {
      // Bump first: this locks the Playlist row and serializes every mutation on
      // it, so the id-set read below runs on a post-lock snapshot.
      await bumpRevision(tx, playlistId);
      const rows = await tx.playlistItem.findMany({
        where: { playlistId },
        select: { id: true },
      });
      const current = new Set(rows.map((r) => r.id));
      const next = new Set(itemIds);
      const sameSet =
        itemIds.length === next.size &&
        current.size === next.size &&
        [...next].every((id) => current.has(id));
      if (!sameSet) {
        throw new MutationReject({ error: "That reorder does not match the playlist." });
      }

      for (let i = 0; i < itemIds.length; i++) {
        await tx.playlistItem.update({ where: { id: itemIds[i] }, data: { position: i } });
      }
    });
  } catch (err) {
    if (err instanceof MutationReject) return err.payload;
    throw err;
  }

  await writeAudit({
    organizationId: ctx.organizationId,
    actorType: "USER",
    actorId: ctx.user.id,
    action: "playlist.items.reorder",
    targetType: "Playlist",
    targetId: playlistId,
  });

  revalidatePath(`/playlists/${playlistId}`);
  return {};
}

export async function setItemDuration(
  itemId: string,
  input: { durationSeconds: number | null },
): Promise<{ error?: string }> {
  const ctx = await requireRole("playlist.update");

  if (!idSchema.safeParse(itemId).success) return { error: "That change is not valid." };
  const parsed = setItemDurationSchema.safeParse(input);
  if (!parsed.success) return { error: "That change is not valid." };

  const item = await ctx.db.playlistItem.findUnique({ where: { id: itemId } });
  if (!item) throw new NotFoundError("That item no longer exists.");

  const { playlistId } = item;

  await withOrgTransaction(ctx.organizationId, async (tx) => {
    // Bump first: locks the Playlist row so this mutation serializes against any
    // concurrent item edit on the same playlist.
    await bumpRevision(tx, playlistId);
    await tx.playlistItem.update({
      where: { id: itemId },
      data: { durationSeconds: parsed.data.durationSeconds },
    });
  });

  await writeAudit({
    organizationId: ctx.organizationId,
    actorType: "USER",
    actorId: ctx.user.id,
    action: "playlist.items.duration",
    targetType: "Playlist",
    targetId: playlistId,
  });

  revalidatePath(`/playlists/${playlistId}`);
  return {};
}

export async function setItemEnabled(
  itemId: string,
  enabled: boolean,
): Promise<{ error?: string }> {
  const ctx = await requireRole("playlist.update");

  if (!idSchema.safeParse(itemId).success) return { error: "That change is not valid." };
  if (!z.boolean().safeParse(enabled).success) return { error: "That change is not valid." };

  const item = await ctx.db.playlistItem.findUnique({ where: { id: itemId } });
  if (!item) throw new NotFoundError("That item no longer exists.");

  const { playlistId } = item;

  await withOrgTransaction(ctx.organizationId, async (tx) => {
    // Bump first: locks the Playlist row so this mutation serializes against any
    // concurrent item edit on the same playlist.
    await bumpRevision(tx, playlistId);
    await tx.playlistItem.update({ where: { id: itemId }, data: { enabled } });
  });

  await writeAudit({
    organizationId: ctx.organizationId,
    actorType: "USER",
    actorId: ctx.user.id,
    action: "playlist.items.enabled",
    targetType: "Playlist",
    targetId: playlistId,
  });

  revalidatePath(`/playlists/${playlistId}`);
  return {};
}

/**
 * Assigns a screen to a playlist, or clears its assignment when `playlistId` is
 * null. Gated by `requireRole("playlist.assign")`. Screen membership is not part
 * of the manifest, so this never bumps a playlist revision. The playlist editor
 * also calls this action to move a screen onto the playlist it is editing.
 */
export async function assignPlaylistToScreen(
  screenId: string,
  playlistId: string | null,
): Promise<{ error?: string }> {
  const ctx = await requireRole("playlist.assign");

  if (!idSchema.safeParse(screenId).success) {
    return { error: "That assignment is not valid." };
  }
  if (!idSchema.nullable().safeParse(playlistId).success) {
    return { error: "That assignment is not valid." };
  }

  const screen = await ctx.db.screen.findUnique({ where: { id: screenId } });
  if (!screen) return { error: "That screen no longer exists." };

  if (playlistId !== null) {
    const playlist = await ctx.db.playlist.findUnique({ where: { id: playlistId } });
    if (!playlist || playlist.archivedAt !== null) {
      return { error: "That playlist is not available." };
    }
  }

  // `Screen.playlistId` and `Screen.canvasId` are mutually exclusive, so
  // assigning a playlist also drops any canvas the screen was pointed at.
  // Clearing the playlist leaves `canvasId` alone: that is a plain unassign, not
  // a source switch.
  await ctx.db.screen.update({
    where: { id: screenId },
    data: { playlistId, ...(playlistId !== null ? { canvasId: null } : {}) },
  });

  await writeAudit({
    organizationId: ctx.organizationId,
    actorType: "USER",
    actorId: ctx.user.id,
    action: "screen.playlist.assign",
    targetType: "Screen",
    targetId: screenId,
    metadata: { screenId, playlistId },
  });

  revalidatePath("/screens");
  revalidatePath("/playlists");
  if (playlistId !== null) revalidatePath(`/playlists/${playlistId}`);
  return {};
}
