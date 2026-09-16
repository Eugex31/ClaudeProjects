"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireRole } from "@/lib/auth/context";
import {
  withOrgTransaction,
  type TenantClient,
  type TenantTransactionClient,
} from "@/lib/db/tenant";
import { writeAudit } from "@/lib/audit";
import { NotFoundError } from "@/lib/errors";
import {
  idSchema,
  createCanvasSchema,
  updateCanvasSchema,
  createPanelSchema,
  updatePanelsSchema,
  createFrameSchema,
  reorderFramesSchema,
  setFrameDurationSchema,
  imageContentSchema,
  videoContentSchema,
  textContentSchema,
  clockContentSchema,
  webContentSchema,
} from "@/lib/validation/canvas";
import { bumpCanvasRevision } from "@/lib/canvas/revision";
import { DEFAULT_GRID, nextZIndex } from "@/lib/canvas/geometry";

/**
 * Visual canvas editor server actions. Every action gates on `requireRole`
 * first, then safe-parses its input, then resolves any id through the tenant
 * `ctx.db` facade (a miss is a `NotFoundError`), then writes, audits and
 * revalidates. Panel, frame and content actions are appended in the labelled
 * sections below by later tasks.
 *
 * `revision` is the manifest-structure version a screen compares against its
 * cached copy to know the copy is stale. `updateCanvas` bumps it, since name,
 * size and background all feed a screen's rendered layout. `createCanvas` starts
 * a row at 1 and `duplicateCanvas` writes a fresh row already at 1, so neither
 * bumps.
 *
 * `archiveCanvas`, `restoreCanvas` and `deleteCanvas` do not bump either. An
 * archived or deleted canvas stops being a candidate at once: the canvas list
 * filters `archivedAt: null` and a delete removes the row outright, so a screen
 * pointed at it sees the change through its `source` resolving back to "playlist"
 * or "none" on the next poll, and `source` is itself part of the change key. A
 * bump on a row that is about to be hidden or gone would be work no screen reads.
 */

/**
 * True when `id` names a media asset in the caller's organization that is a
 * ready, non-archived image, the only kind a canvas background accepts.
 */
async function isReadyBackgroundImage(db: TenantClient, id: string): Promise<boolean> {
  const asset = await db.mediaAsset.findFirst({
    where: { id, kind: "IMAGE", status: "READY", archivedAt: null },
    select: { id: true },
  });
  return asset !== null;
}

// ---- Canvas ----

export async function createCanvas(input: {
  name: string;
  width: number;
  height: number;
  backgroundColor?: string;
  backgroundImageId?: string;
}): Promise<{ id: string } | { error: string }> {
  const ctx = await requireRole("canvas.create");

  const parsed = createCanvasSchema.safeParse(input);
  if (!parsed.success) return { error: "Check the canvas details." };

  if (parsed.data.backgroundImageId !== undefined) {
    const ok = await isReadyBackgroundImage(ctx.db, parsed.data.backgroundImageId);
    if (!ok) return { error: "Choose an image from your library." };
  }

  const canvas = await ctx.db.canvas.create({
    data: {
      organizationId: ctx.organizationId,
      name: parsed.data.name,
      width: parsed.data.width,
      height: parsed.data.height,
      backgroundColor: parsed.data.backgroundColor ?? null,
      backgroundImageId: parsed.data.backgroundImageId ?? null,
    },
  });

  await writeAudit({
    organizationId: ctx.organizationId,
    actorType: "USER",
    actorId: ctx.user.id,
    action: "canvas.create",
    targetType: "Canvas",
    targetId: canvas.id,
  });

  revalidatePath("/canvas");
  redirect(`/canvas/${canvas.id}`);
  // `redirect` throws in a real request; returning keeps the type checker and
  // the unit tests, which stub `redirect`, satisfied.
  return { id: canvas.id };
}

export async function updateCanvas(
  id: string,
  patch: {
    name?: string;
    width?: number;
    height?: number;
    backgroundColor?: string;
    backgroundImageId?: string | null;
  },
): Promise<{ id: string } | { error: string }> {
  const ctx = await requireRole("canvas.update");

  if (!idSchema.safeParse({ id }).success) return { error: "That change is not valid." };

  // The schema carries no null for `backgroundImageId`; an explicit null is the
  // "clear it" signal and is handled outside the parse. An absent one is left
  // untouched. Shrinking width or height only rewrites the two columns; it never
  // deletes a panel.
  const { backgroundImageId, ...rest } = patch;
  const parsed = updateCanvasSchema.safeParse(
    backgroundImageId == null ? rest : { ...rest, backgroundImageId },
  );
  if (!parsed.success) return { error: "That change is not valid." };

  const canvas = await ctx.db.canvas.findUnique({ where: { id } });
  if (!canvas) throw new NotFoundError("That canvas no longer exists.");

  const data: {
    name?: string;
    width?: number;
    height?: number;
    backgroundColor?: string;
    backgroundImageId?: string | null;
  } = {};
  if (parsed.data.name !== undefined) data.name = parsed.data.name;
  if (parsed.data.width !== undefined) data.width = parsed.data.width;
  if (parsed.data.height !== undefined) data.height = parsed.data.height;
  if (parsed.data.backgroundColor !== undefined) {
    data.backgroundColor = parsed.data.backgroundColor;
  }
  if (backgroundImageId === null) {
    data.backgroundImageId = null;
  } else if (parsed.data.backgroundImageId !== undefined) {
    const ok = await isReadyBackgroundImage(ctx.db, parsed.data.backgroundImageId);
    if (!ok) return { error: "Choose an image from your library." };
    data.backgroundImageId = parsed.data.backgroundImageId;
  }

  await withOrgTransaction(ctx.organizationId, async (tx) => {
    await bumpCanvasRevision(tx, id);
    await tx.canvas.update({ where: { id }, data });
  });

  await writeAudit({
    organizationId: ctx.organizationId,
    actorType: "USER",
    actorId: ctx.user.id,
    action: "canvas.update",
    targetType: "Canvas",
    targetId: id,
  });

  revalidatePath("/canvas");
  revalidatePath(`/canvas/${id}`);
  return { id };
}

export async function duplicateCanvas(
  id: string,
): Promise<{ id: string } | { error: string }> {
  const ctx = await requireRole("canvas.create");

  if (!idSchema.safeParse({ id }).success) return { error: "That canvas no longer exists." };

  const original = await ctx.db.canvas.findUnique({ where: { id } });
  if (!original) throw new NotFoundError("That canvas no longer exists.");

  // One transaction: read the whole tree, then write a fresh copy of every row
  // with new ids. The copy is a brand new Canvas starting at revision 1, so
  // there is nothing to bump. `timeout` is raised because the copy walks the
  // tree row by row.
  const newId = await withOrgTransaction(
    ctx.organizationId,
    async (tx) => {
      const panels = await tx.panel.findMany({
        where: { canvasId: id },
        include: {
          frames: {
            include: {
              content: {
                include: {
                  clock: true,
                  picture: true,
                  video: true,
                  memo: true,
                  web: true,
                },
              },
            },
          },
        },
      });

      const copy = await tx.canvas.create({
        data: {
          organizationId: ctx.organizationId,
          name: `${original.name} copy`,
          width: original.width,
          height: original.height,
          backgroundColor: original.backgroundColor,
          backgroundImageId: original.backgroundImageId,
          revision: 1,
          legacyId: null,
        },
      });

      for (const panel of panels) {
        const panelCopy = await tx.panel.create({
          data: {
            organizationId: ctx.organizationId,
            canvasId: copy.id,
            name: panel.name,
            x: panel.x,
            y: panel.y,
            width: panel.width,
            height: panel.height,
            zIndex: panel.zIndex,
            noScroll: panel.noScroll,
          },
        });

        for (const frame of panel.frames) {
          const frameCopy = await tx.frame.create({
            data: {
              organizationId: ctx.organizationId,
              panelId: panelCopy.id,
              sortOrder: frame.sortOrder,
              durationSeconds: frame.durationSeconds,
              type: frame.type,
            },
          });

          const content = frame.content;
          if (!content) continue;

          const contentCopy = await tx.content.create({
            data: {
              organizationId: ctx.organizationId,
              frameId: frameCopy.id,
              name: content.name,
            },
          });

          if (content.clock) {
            await tx.clock.create({
              data: {
                organizationId: ctx.organizationId,
                contentId: contentCopy.id,
                type: content.clock.type,
                showDate: content.clock.showDate,
                showTime: content.clock.showTime,
                showSeconds: content.clock.showSeconds,
                label: content.clock.label,
                timeZone: content.clock.timeZone,
              },
            });
          }
          if (content.picture) {
            await tx.picture.create({
              data: {
                organizationId: ctx.organizationId,
                contentId: contentCopy.id,
                mediaRef: content.picture.mediaRef,
                mode: content.picture.mode,
                mediaAssetId: content.picture.mediaAssetId,
              },
            });
          }
          if (content.video) {
            await tx.video.create({
              data: {
                organizationId: ctx.organizationId,
                contentId: contentCopy.id,
                mediaRef: content.video.mediaRef,
                mediaAssetId: content.video.mediaAssetId,
              },
            });
          }
          if (content.memo) {
            await tx.memo.create({
              data: {
                organizationId: ctx.organizationId,
                contentId: contentCopy.id,
                body: content.memo.body,
              },
            });
          }
          if (content.web) {
            await tx.web.create({
              data: {
                organizationId: ctx.organizationId,
                contentId: contentCopy.id,
                url: content.web.url,
              },
            });
          }
        }
      }

      return copy.id;
    },
    { timeout: 15000 },
  );

  await writeAudit({
    organizationId: ctx.organizationId,
    actorType: "USER",
    actorId: ctx.user.id,
    action: "canvas.duplicate",
    targetType: "Canvas",
    targetId: newId,
  });

  revalidatePath("/canvas");
  return { id: newId };
}

export async function archiveCanvas(
  id: string,
): Promise<{ ok: true } | { error: string }> {
  const ctx = await requireRole("canvas.update");

  if (!idSchema.safeParse({ id }).success) return { error: "That canvas no longer exists." };

  const canvas = await ctx.db.canvas.findUnique({ where: { id } });
  if (!canvas) throw new NotFoundError("That canvas no longer exists.");

  await ctx.db.canvas.update({ where: { id }, data: { archivedAt: new Date() } });

  await writeAudit({
    organizationId: ctx.organizationId,
    actorType: "USER",
    actorId: ctx.user.id,
    action: "canvas.archive",
    targetType: "Canvas",
    targetId: id,
  });

  revalidatePath("/canvas");
  return { ok: true };
}

export async function restoreCanvas(
  id: string,
): Promise<{ ok: true } | { error: string }> {
  const ctx = await requireRole("canvas.update");

  if (!idSchema.safeParse({ id }).success) return { error: "That canvas no longer exists." };

  const canvas = await ctx.db.canvas.findUnique({ where: { id } });
  if (!canvas) throw new NotFoundError("That canvas no longer exists.");

  await ctx.db.canvas.update({ where: { id }, data: { archivedAt: null } });

  await writeAudit({
    organizationId: ctx.organizationId,
    actorType: "USER",
    actorId: ctx.user.id,
    action: "canvas.restore",
    targetType: "Canvas",
    targetId: id,
  });

  revalidatePath("/canvas");
  return { ok: true };
}

export async function deleteCanvas(
  id: string,
): Promise<{ ok: true } | { error: string }> {
  const ctx = await requireRole("canvas.delete");

  if (!idSchema.safeParse({ id }).success) return { error: "That canvas no longer exists." };

  const canvas = await ctx.db.canvas.findUnique({ where: { id } });
  if (!canvas) throw new NotFoundError("That canvas no longer exists.");

  // Count and delete in one transaction so a screen cannot be pointed at this
  // canvas between the check and the delete. The foreign key is `SetNull`, so
  // the race would only silently unassign a screen rather than corrupt
  // anything, but the guard is cheap.
  const inUse = await withOrgTransaction(ctx.organizationId, async (tx) => {
    const count = await tx.screen.count({ where: { canvasId: id } });
    if (count > 0) return count;
    await tx.canvas.delete({ where: { id } });
    return 0;
  });
  if (inUse > 0) {
    return {
      error: `That canvas is assigned to ${inUse} ${
        inUse === 1 ? "screen" : "screens"
      }. Change their content source first.`,
    };
  }

  await writeAudit({
    organizationId: ctx.organizationId,
    actorType: "USER",
    actorId: ctx.user.id,
    action: "canvas.delete",
    targetType: "Canvas",
    targetId: id,
  });

  revalidatePath("/canvas");
  return { ok: true };
}

// ---- Panels ----

/**
 * A batch action rejected part way through its transaction. It is thrown so the
 * surrounding `withOrgTransaction` rolls back, which also undoes the opening
 * `bumpCanvasRevision`, then caught at the action boundary and turned into an
 * `{ error }` result. Nothing is written when a batch is rejected.
 */
class BatchRejected extends Error {
  constructor(public readonly reason: string) {
    super(reason);
    this.name = "BatchRejected";
  }
}

/**
 * The id of the canvas that owns `panelId`, or null when the caller's
 * organization has no such panel.
 */
async function canvasIdForPanel(
  db: TenantClient,
  panelId: string,
): Promise<string | null> {
  const panel = await db.panel.findUnique({
    where: { id: panelId },
    select: { canvasId: true },
  });
  return panel?.canvasId ?? null;
}

/**
 * The id of the canvas that owns `frameId`, resolved through its panel, or null
 * when the caller's organization has no such frame.
 */
async function canvasIdForFrame(
  db: TenantClient,
  frameId: string,
): Promise<string | null> {
  const frame = await db.frame.findUnique({
    where: { id: frameId },
    select: { panel: { select: { canvasId: true } } },
  });
  return frame?.panel.canvasId ?? null;
}

export async function createPanel(input: {
  canvasId: string;
  name?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
  noScroll: boolean;
}): Promise<{ id: string } | { error: string }> {
  const ctx = await requireRole("canvas.update");

  const parsed = createPanelSchema.safeParse(input);
  if (!parsed.success) return { error: "Check the panel details." };

  const canvas = await ctx.db.canvas.findUnique({
    where: { id: parsed.data.canvasId },
    select: { id: true },
  });
  if (!canvas) return { error: "That canvas no longer exists." };

  const canvasId = canvas.id;

  const panelId = await withOrgTransaction(ctx.organizationId, async (tx) => {
    await bumpCanvasRevision(tx, canvasId);
    const panel = await tx.panel.create({
      data: {
        organizationId: ctx.organizationId,
        canvasId,
        name: parsed.data.name ?? null,
        x: parsed.data.x,
        y: parsed.data.y,
        width: parsed.data.width,
        height: parsed.data.height,
        zIndex: parsed.data.zIndex,
        noScroll: parsed.data.noScroll,
      },
    });
    return panel.id;
  });

  await writeAudit({
    organizationId: ctx.organizationId,
    actorType: "USER",
    actorId: ctx.user.id,
    action: "panel.create",
    targetType: "Panel",
    targetId: panelId,
  });

  revalidatePath(`/canvas/${canvasId}`);
  return { id: panelId };
}

export async function updatePanels(
  canvasId: string,
  input: {
    panels: Array<{
      id: string;
      name?: string;
      x?: number;
      y?: number;
      width?: number;
      height?: number;
      zIndex?: number;
      noScroll?: boolean;
    }>;
  },
): Promise<{ ok: true } | { error: string }> {
  const ctx = await requireRole("canvas.update");

  if (!idSchema.safeParse({ id: canvasId }).success) {
    return { error: "That change is not valid." };
  }
  const parsed = updatePanelsSchema.safeParse(input);
  if (!parsed.success) return { error: "That change is not valid." };

  const canvas = await ctx.db.canvas.findUnique({
    where: { id: canvasId },
    select: { id: true },
  });
  if (!canvas) return { error: "That canvas no longer exists." };

  const patches = parsed.data.panels;

  try {
    await withOrgTransaction(ctx.organizationId, async (tx) => {
      await bumpCanvasRevision(tx, canvasId);

      const owned = await tx.panel.findMany({
        where: { canvasId },
        select: { id: true },
      });
      const ownedIds = new Set(owned.map((p) => p.id));

      for (const patch of patches) {
        if (!ownedIds.has(patch.id)) {
          throw new BatchRejected("That panel is not on this canvas.");
        }
      }

      for (const patch of patches) {
        const { id, ...data } = patch;
        await tx.panel.update({ where: { id }, data });
      }
    });
  } catch (err) {
    if (err instanceof BatchRejected) return { error: err.reason };
    throw err;
  }

  await writeAudit({
    organizationId: ctx.organizationId,
    actorType: "USER",
    actorId: ctx.user.id,
    action: "panel.updateBatch",
    targetType: "Panel",
    targetId: canvasId,
    metadata: { count: patches.length },
  });

  revalidatePath(`/canvas/${canvasId}`);
  return { ok: true };
}

export async function deletePanel(
  id: string,
): Promise<{ ok: true } | { error: string }> {
  const ctx = await requireRole("canvas.update");

  if (!idSchema.safeParse({ id }).success) {
    return { error: "That panel no longer exists." };
  }

  const canvasId = await canvasIdForPanel(ctx.db, id);
  if (!canvasId) return { error: "That panel no longer exists." };

  await withOrgTransaction(ctx.organizationId, async (tx) => {
    await bumpCanvasRevision(tx, canvasId);
    await tx.panel.delete({ where: { id } });
  });

  await writeAudit({
    organizationId: ctx.organizationId,
    actorType: "USER",
    actorId: ctx.user.id,
    action: "panel.delete",
    targetType: "Panel",
    targetId: id,
  });

  revalidatePath(`/canvas/${canvasId}`);
  return { ok: true };
}

export async function duplicatePanel(
  id: string,
): Promise<{ id: string } | { error: string }> {
  const ctx = await requireRole("canvas.update");

  if (!idSchema.safeParse({ id }).success) {
    return { error: "That panel no longer exists." };
  }

  const canvasId = await canvasIdForPanel(ctx.db, id);
  if (!canvasId) return { error: "That panel no longer exists." };

  // One transaction, bump first: read the panel subtree, then write a fresh copy
  // of every row with new ids, shifted one grid step down and right so the copy
  // does not sit exactly on the original. The copy also takes a fresh top
  // `zIndex` rather than the source's: two panels sharing a zIndex can never be
  // separated again, because `swapZ` looks for a strictly higher or strictly
  // lower neighbour. `timeout` is raised because the copy walks frames and their
  // content row by row.
  const newPanelId = await withOrgTransaction(
    ctx.organizationId,
    async (tx) => {
      await bumpCanvasRevision(tx, canvasId);

      const panel = await tx.panel.findUniqueOrThrow({
        where: { id },
        include: {
          frames: {
            include: {
              content: {
                include: {
                  clock: true,
                  picture: true,
                  video: true,
                  memo: true,
                  web: true,
                },
              },
            },
          },
        },
      });

      const siblings = await tx.panel.findMany({
        where: { canvasId },
        select: { zIndex: true },
      });

      const panelCopy = await tx.panel.create({
        data: {
          organizationId: ctx.organizationId,
          canvasId,
          name: panel.name,
          x: panel.x + DEFAULT_GRID,
          y: panel.y + DEFAULT_GRID,
          width: panel.width,
          height: panel.height,
          zIndex: nextZIndex(siblings),
          noScroll: panel.noScroll,
        },
      });

      for (const frame of panel.frames) {
        const frameCopy = await tx.frame.create({
          data: {
            organizationId: ctx.organizationId,
            panelId: panelCopy.id,
            sortOrder: frame.sortOrder,
            durationSeconds: frame.durationSeconds,
            type: frame.type,
          },
        });

        const content = frame.content;
        if (!content) continue;

        const contentCopy = await tx.content.create({
          data: {
            organizationId: ctx.organizationId,
            frameId: frameCopy.id,
            name: content.name,
          },
        });

        if (content.clock) {
          await tx.clock.create({
            data: {
              organizationId: ctx.organizationId,
              contentId: contentCopy.id,
              type: content.clock.type,
              showDate: content.clock.showDate,
              showTime: content.clock.showTime,
              showSeconds: content.clock.showSeconds,
              label: content.clock.label,
              timeZone: content.clock.timeZone,
            },
          });
        }
        if (content.picture) {
          await tx.picture.create({
            data: {
              organizationId: ctx.organizationId,
              contentId: contentCopy.id,
              mediaRef: content.picture.mediaRef,
              mode: content.picture.mode,
              mediaAssetId: content.picture.mediaAssetId,
            },
          });
        }
        if (content.video) {
          await tx.video.create({
            data: {
              organizationId: ctx.organizationId,
              contentId: contentCopy.id,
              mediaRef: content.video.mediaRef,
              mediaAssetId: content.video.mediaAssetId,
            },
          });
        }
        if (content.memo) {
          await tx.memo.create({
            data: {
              organizationId: ctx.organizationId,
              contentId: contentCopy.id,
              body: content.memo.body,
            },
          });
        }
        if (content.web) {
          await tx.web.create({
            data: {
              organizationId: ctx.organizationId,
              contentId: contentCopy.id,
              url: content.web.url,
            },
          });
        }
      }

      return panelCopy.id;
    },
    { timeout: 15000 },
  );

  await writeAudit({
    organizationId: ctx.organizationId,
    actorType: "USER",
    actorId: ctx.user.id,
    action: "panel.duplicate",
    targetType: "Panel",
    targetId: newPanelId,
  });

  revalidatePath(`/canvas/${canvasId}`);
  return { id: newPanelId };
}

// ---- Frames ----

export async function createFrame(input: {
  panelId: string;
  type: "CLOCK" | "PICTURE" | "VIDEO" | "MEMO" | "WEB";
  durationSeconds: number;
}): Promise<{ id: string } | { error: string }> {
  const ctx = await requireRole("canvas.update");

  const parsed = createFrameSchema.safeParse(input);
  if (!parsed.success) return { error: "Check the frame details." };

  const canvasId = await canvasIdForPanel(ctx.db, parsed.data.panelId);
  if (!canvasId) return { error: "That panel no longer exists." };

  const panelId = parsed.data.panelId;

  const frameId = await withOrgTransaction(ctx.organizationId, async (tx) => {
    await bumpCanvasRevision(tx, canvasId);

    const top = await tx.frame.aggregate({
      where: { panelId },
      _max: { sortOrder: true },
    });
    const sortOrder = top._max.sortOrder === null ? 0 : top._max.sortOrder + 1;

    const frame = await tx.frame.create({
      data: {
        organizationId: ctx.organizationId,
        panelId,
        sortOrder,
        durationSeconds: parsed.data.durationSeconds,
        type: parsed.data.type,
      },
    });

    await tx.content.create({
      data: {
        organizationId: ctx.organizationId,
        frameId: frame.id,
        name: null,
      },
    });

    return frame.id;
  });

  await writeAudit({
    organizationId: ctx.organizationId,
    actorType: "USER",
    actorId: ctx.user.id,
    action: "frame.create",
    targetType: "Frame",
    targetId: frameId,
  });

  revalidatePath(`/canvas/${canvasId}`);
  return { id: frameId };
}

export async function reorderFrames(input: {
  panelId: string;
  frameIds: string[];
}): Promise<{ ok: true } | { error: string }> {
  const ctx = await requireRole("canvas.update");

  const parsed = reorderFramesSchema.safeParse(input);
  if (!parsed.success) return { error: "That change is not valid." };

  const { panelId, frameIds } = parsed.data;

  const canvasId = await canvasIdForPanel(ctx.db, panelId);
  if (!canvasId) return { error: "That panel no longer exists." };

  try {
    await withOrgTransaction(ctx.organizationId, async (tx) => {
      await bumpCanvasRevision(tx, canvasId);

      const current = await tx.frame.findMany({
        where: { panelId },
        select: { id: true },
      });
      const currentIds = new Set(current.map((f) => f.id));
      const wanted = new Set(frameIds);

      const sameSet =
        frameIds.length === currentIds.size &&
        wanted.size === frameIds.length &&
        frameIds.every((frameId) => currentIds.has(frameId));
      if (!sameSet) {
        throw new BatchRejected("The frame list does not match this panel.");
      }

      for (let index = 0; index < frameIds.length; index += 1) {
        await tx.frame.update({
          where: { id: frameIds[index] },
          data: { sortOrder: index },
        });
      }
    });
  } catch (err) {
    if (err instanceof BatchRejected) return { error: err.reason };
    throw err;
  }

  await writeAudit({
    organizationId: ctx.organizationId,
    actorType: "USER",
    actorId: ctx.user.id,
    action: "frame.reorder",
    targetType: "Frame",
    targetId: panelId,
  });

  revalidatePath(`/canvas/${canvasId}`);
  return { ok: true };
}

export async function setFrameDuration(input: {
  id: string;
  durationSeconds: number;
}): Promise<{ ok: true } | { error: string }> {
  const ctx = await requireRole("canvas.update");

  const parsed = setFrameDurationSchema.safeParse(input);
  if (!parsed.success) return { error: "That change is not valid." };

  const frameId = parsed.data.id;

  const canvasId = await canvasIdForFrame(ctx.db, frameId);
  if (!canvasId) return { error: "That frame no longer exists." };

  await withOrgTransaction(ctx.organizationId, async (tx) => {
    await bumpCanvasRevision(tx, canvasId);
    await tx.frame.update({
      where: { id: frameId },
      data: { durationSeconds: parsed.data.durationSeconds },
    });
  });

  await writeAudit({
    organizationId: ctx.organizationId,
    actorType: "USER",
    actorId: ctx.user.id,
    action: "frame.setDuration",
    targetType: "Frame",
    targetId: frameId,
  });

  revalidatePath(`/canvas/${canvasId}`);
  return { ok: true };
}

export async function deleteFrame(
  id: string,
): Promise<{ ok: true } | { error: string }> {
  const ctx = await requireRole("canvas.update");

  if (!idSchema.safeParse({ id }).success) {
    return { error: "That frame no longer exists." };
  }

  const canvasId = await canvasIdForFrame(ctx.db, id);
  if (!canvasId) return { error: "That frame no longer exists." };

  await withOrgTransaction(ctx.organizationId, async (tx) => {
    await bumpCanvasRevision(tx, canvasId);
    await tx.frame.delete({ where: { id } });
  });

  await writeAudit({
    organizationId: ctx.organizationId,
    actorType: "USER",
    actorId: ctx.user.id,
    action: "frame.delete",
    targetType: "Frame",
    targetId: id,
  });

  revalidatePath(`/canvas/${canvasId}`);
  return { ok: true };
}

// ---- Content ----

/**
 * The canvas that owns `frameId` and the id of the `Content` row `createFrame`
 * already attached to it, resolved through `frame -> panel -> canvasId`. Null
 * when the caller's organization has no such frame, or the frame somehow carries
 * no content row.
 */
async function frameContentTarget(
  db: TenantClient,
  frameId: string,
): Promise<{ canvasId: string; contentId: string } | null> {
  const frame = await db.frame.findUnique({
    where: { id: frameId },
    select: {
      panel: { select: { canvasId: true } },
      content: { select: { id: true } },
    },
  });
  if (!frame || !frame.content) return null;
  return { canvasId: frame.panel.canvasId, contentId: frame.content.id };
}

/**
 * Remove every typed row on `contentId` except the one named by `keep`, so a
 * `Content` never ends up with two typed rows once a `set*Content` action has
 * changed the frame's kind. This covers all twelve typed relations, not only the
 * five this plan authors: `youtube`, `html`, `outlook`, `report`, `powerbi`,
 * `weather` and `news` have no `set*Content` action here, but a legacy or
 * imported `Content` can already carry one, so they are always cleared. Each
 * `deleteMany` is a no-op when the row is absent.
 */
async function clearTypedContentExcept(
  tx: TenantTransactionClient,
  contentId: string,
  keep: "picture" | "video" | "memo" | "clock" | "web",
): Promise<void> {
  if (keep !== "clock") await tx.clock.deleteMany({ where: { contentId } });
  if (keep !== "picture") await tx.picture.deleteMany({ where: { contentId } });
  if (keep !== "video") await tx.video.deleteMany({ where: { contentId } });
  if (keep !== "memo") await tx.memo.deleteMany({ where: { contentId } });
  if (keep !== "web") await tx.web.deleteMany({ where: { contentId } });
  await tx.youtube.deleteMany({ where: { contentId } });
  await tx.html.deleteMany({ where: { contentId } });
  await tx.outlook.deleteMany({ where: { contentId } });
  await tx.report.deleteMany({ where: { contentId } });
  await tx.powerbi.deleteMany({ where: { contentId } });
  await tx.weather.deleteMany({ where: { contentId } });
  await tx.news.deleteMany({ where: { contentId } });
}

/**
 * True when `id` names a media asset in the caller's organization that is ready,
 * not archived and of the given kind.
 */
async function isReadyAsset(
  db: TenantClient,
  id: string,
  kind: "IMAGE" | "VIDEO",
): Promise<boolean> {
  const asset = await db.mediaAsset.findFirst({
    where: { id, kind, status: "READY", archivedAt: null },
    select: { id: true },
  });
  return asset !== null;
}

export async function setImageContent(input: {
  frameId: string;
  mediaAssetId: string;
  mode?: "cover" | "contain" | "fill" | "none";
}): Promise<{ ok: true } | { error: string }> {
  const ctx = await requireRole("canvas.update");

  const parsed = imageContentSchema.safeParse(input);
  if (!parsed.success) return { error: "Check the image details." };

  const target = await frameContentTarget(ctx.db, parsed.data.frameId);
  if (!target) return { error: "That frame no longer exists." };

  const ok = await isReadyAsset(ctx.db, parsed.data.mediaAssetId, "IMAGE");
  if (!ok) return { error: "Choose a ready image from your library." };

  const { canvasId, contentId } = target;
  const { mediaAssetId, mode } = parsed.data;

  await withOrgTransaction(ctx.organizationId, async (tx) => {
    await bumpCanvasRevision(tx, canvasId);
    await tx.frame.update({
      where: { id: parsed.data.frameId },
      data: { type: "PICTURE" },
    });
    await clearTypedContentExcept(tx, contentId, "picture");
    await tx.picture.upsert({
      where: { contentId },
      create: { contentId, organizationId: ctx.organizationId, mediaAssetId, mode },
      update: { mediaAssetId, mode },
    });
  });

  await writeAudit({
    organizationId: ctx.organizationId,
    actorType: "USER",
    actorId: ctx.user.id,
    action: "content.setImage",
    targetType: "Frame",
    targetId: parsed.data.frameId,
  });

  revalidatePath(`/canvas/${canvasId}`);
  return { ok: true };
}

export async function setVideoContent(input: {
  frameId: string;
  mediaAssetId: string;
}): Promise<{ ok: true } | { error: string }> {
  const ctx = await requireRole("canvas.update");

  const parsed = videoContentSchema.safeParse(input);
  if (!parsed.success) return { error: "Check the video details." };

  const target = await frameContentTarget(ctx.db, parsed.data.frameId);
  if (!target) return { error: "That frame no longer exists." };

  const ok = await isReadyAsset(ctx.db, parsed.data.mediaAssetId, "VIDEO");
  if (!ok) return { error: "Choose a ready video from your library." };

  const { canvasId, contentId } = target;
  const { mediaAssetId } = parsed.data;

  await withOrgTransaction(ctx.organizationId, async (tx) => {
    await bumpCanvasRevision(tx, canvasId);
    await tx.frame.update({
      where: { id: parsed.data.frameId },
      data: { type: "VIDEO" },
    });
    await clearTypedContentExcept(tx, contentId, "video");
    await tx.video.upsert({
      where: { contentId },
      create: { contentId, organizationId: ctx.organizationId, mediaAssetId },
      update: { mediaAssetId },
    });
  });

  await writeAudit({
    organizationId: ctx.organizationId,
    actorType: "USER",
    actorId: ctx.user.id,
    action: "content.setVideo",
    targetType: "Frame",
    targetId: parsed.data.frameId,
  });

  revalidatePath(`/canvas/${canvasId}`);
  return { ok: true };
}

export async function setTextContent(input: {
  frameId: string;
  body: string;
}): Promise<{ ok: true } | { error: string }> {
  const ctx = await requireRole("canvas.update");

  const parsed = textContentSchema.safeParse(input);
  if (!parsed.success) return { error: "Check the text details." };

  const target = await frameContentTarget(ctx.db, parsed.data.frameId);
  if (!target) return { error: "That frame no longer exists." };

  const { canvasId, contentId } = target;
  const { body } = parsed.data;

  await withOrgTransaction(ctx.organizationId, async (tx) => {
    await bumpCanvasRevision(tx, canvasId);
    await tx.frame.update({
      where: { id: parsed.data.frameId },
      data: { type: "MEMO" },
    });
    await clearTypedContentExcept(tx, contentId, "memo");
    await tx.memo.upsert({
      where: { contentId },
      create: { contentId, organizationId: ctx.organizationId, body },
      update: { body },
    });
  });

  await writeAudit({
    organizationId: ctx.organizationId,
    actorType: "USER",
    actorId: ctx.user.id,
    action: "content.setText",
    targetType: "Frame",
    targetId: parsed.data.frameId,
  });

  revalidatePath(`/canvas/${canvasId}`);
  return { ok: true };
}

export async function setClockContent(input: {
  frameId: string;
  style: number;
  showDate: boolean;
  showTime: boolean;
  showSeconds: boolean;
  label?: string | null;
  timeZone?: string | null;
}): Promise<{ ok: true } | { error: string }> {
  const ctx = await requireRole("canvas.update");

  const parsed = clockContentSchema.safeParse(input);
  if (!parsed.success) return { error: "Check the clock details." };

  const target = await frameContentTarget(ctx.db, parsed.data.frameId);
  if (!target) return { error: "That frame no longer exists." };

  const { canvasId, contentId } = target;
  const { style, showDate, showTime, showSeconds, label, timeZone } = parsed.data;
  // The clock form always sends its whole state, so an absent `label` or
  // `timeZone` means the field is empty, not untouched. Both are written as an
  // explicit null so a saved caption or zone can be cleared again.
  const clockData = {
    type: style,
    showDate,
    showTime,
    showSeconds,
    label: label ?? null,
    timeZone: timeZone ?? null,
  };

  await withOrgTransaction(ctx.organizationId, async (tx) => {
    await bumpCanvasRevision(tx, canvasId);
    await tx.frame.update({
      where: { id: parsed.data.frameId },
      data: { type: "CLOCK" },
    });
    await clearTypedContentExcept(tx, contentId, "clock");
    await tx.clock.upsert({
      where: { contentId },
      create: { contentId, organizationId: ctx.organizationId, ...clockData },
      update: clockData,
    });
  });

  await writeAudit({
    organizationId: ctx.organizationId,
    actorType: "USER",
    actorId: ctx.user.id,
    action: "content.setClock",
    targetType: "Frame",
    targetId: parsed.data.frameId,
  });

  revalidatePath(`/canvas/${canvasId}`);
  return { ok: true };
}

export async function setWebContent(input: {
  frameId: string;
  url: string;
}): Promise<{ ok: true } | { error: string }> {
  const ctx = await requireRole("canvas.update");

  const parsed = webContentSchema.safeParse(input);
  if (!parsed.success) return { error: "Check the web address." };

  const target = await frameContentTarget(ctx.db, parsed.data.frameId);
  if (!target) return { error: "That frame no longer exists." };

  const { canvasId, contentId } = target;
  const { url } = parsed.data;

  await withOrgTransaction(ctx.organizationId, async (tx) => {
    await bumpCanvasRevision(tx, canvasId);
    await tx.frame.update({
      where: { id: parsed.data.frameId },
      data: { type: "WEB" },
    });
    await clearTypedContentExcept(tx, contentId, "web");
    await tx.web.upsert({
      where: { contentId },
      create: { contentId, organizationId: ctx.organizationId, url },
      update: { url },
    });
  });

  await writeAudit({
    organizationId: ctx.organizationId,
    actorType: "USER",
    actorId: ctx.user.id,
    action: "content.setWeb",
    targetType: "Frame",
    targetId: parsed.data.frameId,
  });

  revalidatePath(`/canvas/${canvasId}`);
  return { ok: true };
}
