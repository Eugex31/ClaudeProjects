"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";

import { requireRole } from "@/lib/auth/context";
import { withOrgTransaction } from "@/lib/db/tenant";
import { assertCanAddScreen } from "@/lib/plan-limits";
import { PlanLimitError } from "@/lib/errors";
import { writeAudit } from "@/lib/audit";
import { generatePairingCode } from "@/lib/pairing";
import { screenSchema } from "@/lib/validation/screens";
import { setScreenContentSourceSchema } from "@/lib/validation/canvas";

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

/**
 * Creates a screen in the caller's active organization, provisioned `UNPAIRED`
 * with a fresh pairing code.
 *
 * Gated by `requireRole("screen.create")` before anything else. The submitted
 * `locationId` must resolve to a location in the same organization: the tenant
 * facade scopes that lookup, so a `locationId` naming another org's row fails
 * here even though Postgres foreign keys are exempt from RLS. Then the plan's
 * screen ceiling (`assertCanAddScreen`, its `PlanLimitError` returned as
 * `{ error }`, not thrown). The pairing code is unique while pending, so a rare
 * generation collision is retried once. Returns the code for the pair dialog.
 */
export async function createScreen(
  formData: FormData,
): Promise<{ error?: string; pairingCode?: string; screenId?: string }> {
  const ctx = await requireRole("screen.create");

  const raw: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value === "string" && value.trim() !== "") raw[key] = value;
  }

  const parsed = screenSchema.safeParse(raw);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the screen details." };
  }
  const { name, locationId } = parsed.data;

  const location = await ctx.db.location.findUnique({ where: { id: locationId } });
  if (!location) {
    return { error: "Choose a location from your organization." };
  }

  try {
    await assertCanAddScreen(ctx.organizationId);
  } catch (err) {
    if (err instanceof PlanLimitError) return { error: err.userMessage };
    throw err;
  }

  let created;
  try {
    created = await ctx.db.screen.create({
      data: {
        organizationId: ctx.organizationId,
        name,
        locationId,
        status: "UNPAIRED",
        pairingCode: generatePairingCode(),
      },
    });
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    created = await ctx.db.screen.create({
      data: {
        organizationId: ctx.organizationId,
        name,
        locationId,
        status: "UNPAIRED",
        pairingCode: generatePairingCode(),
      },
    });
  }

  await writeAudit({
    organizationId: ctx.organizationId,
    actorType: "USER",
    actorId: ctx.user.id,
    action: "screen.create",
    targetType: "Screen",
    targetId: created.id,
  });

  revalidatePath("/screens");
  return { pairingCode: created.pairingCode ?? undefined, screenId: created.id };
}

/**
 * Issues a fresh pairing code for an existing screen, unpairing it: the current
 * device token hash is cleared and the status returns to `UNPAIRED`, so the old
 * player can no longer authenticate. Gated by `requireRole("screen.pair")`.
 */
export async function regeneratePairingCode(
  screenId: string,
): Promise<{ error?: string; pairingCode?: string }> {
  const ctx = await requireRole("screen.pair");

  let updated;
  try {
    updated = await ctx.db.screen.update({
      where: { id: screenId },
      data: { pairingCode: generatePairingCode(), status: "UNPAIRED", deviceTokenHash: null },
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      updated = await ctx.db.screen.update({
        where: { id: screenId },
        data: { pairingCode: generatePairingCode(), status: "UNPAIRED", deviceTokenHash: null },
      });
    } else if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
      return { error: "That screen is no longer available." };
    } else {
      throw err;
    }
  }

  await writeAudit({
    organizationId: ctx.organizationId,
    actorType: "USER",
    actorId: ctx.user.id,
    action: "screen.pair",
    targetType: "Screen",
    targetId: updated.id,
  });

  revalidatePath("/screens");
  return { pairingCode: updated.pairingCode ?? undefined };
}

/**
 * Points a screen at a playlist, a canvas, or nothing, through one call. Gated
 * by `requireRole("screen.update")`. The input is safe-parsed through
 * {@link setScreenContentSourceSchema}, whose refine already rejects a source
 * whose companion id is missing or forbidden. The `screenId`, and the
 * `playlistId` or `canvasId` it names, resolve through the tenant `ctx.db`
 * facade, so a foreign-org id simply misses and the call returns `{ error }`
 * without a write. The transaction sets both foreign keys every call, so
 * switching the source clears the pointer it no longer uses. A screen pointer is
 * not a structural canvas edit, so this never bumps a canvas revision.
 */
export async function setScreenContentSource(input: {
  screenId: string;
  source: "playlist" | "canvas" | "none";
  playlistId?: string;
  canvasId?: string;
}): Promise<{ ok: true } | { error: string }> {
  const ctx = await requireRole("screen.update");

  const parsed = setScreenContentSourceSchema.safeParse(input);
  if (!parsed.success) return { error: "That content source is not valid." };
  const { screenId, source, playlistId, canvasId } = parsed.data;

  const screen = await ctx.db.screen.findUnique({ where: { id: screenId } });
  if (!screen) return { error: "That screen no longer exists." };

  if (source === "playlist") {
    const playlist = await ctx.db.playlist.findFirst({
      where: { id: playlistId, archivedAt: null },
      select: { id: true },
    });
    if (!playlist) return { error: "That playlist is not available." };
  }

  if (source === "canvas") {
    const canvas = await ctx.db.canvas.findFirst({
      where: { id: canvasId, archivedAt: null },
      select: { id: true },
    });
    if (!canvas) return { error: "That canvas is not available." };
  }

  await withOrgTransaction(ctx.organizationId, async (tx) => {
    await tx.screen.update({
      where: { id: screenId },
      data: {
        playlistId: source === "playlist" ? (playlistId ?? null) : null,
        canvasId: source === "canvas" ? (canvasId ?? null) : null,
      },
    });
  });

  await writeAudit({
    organizationId: ctx.organizationId,
    actorType: "USER",
    actorId: ctx.user.id,
    action: "screen.setContentSource",
    targetType: "Screen",
    targetId: screenId,
  });

  revalidatePath("/screens");
  return { ok: true };
}
