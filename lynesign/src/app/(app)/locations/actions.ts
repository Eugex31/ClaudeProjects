"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/context";
import { assertCanAddLocation } from "@/lib/plan-limits";
import { PlanLimitError } from "@/lib/errors";
import { writeAudit } from "@/lib/audit";
import { locationSchema } from "@/lib/validation/locations";

/**
 * Creates a location in the caller's active organization.
 *
 * Gated twice before the write: `requireRole("location.create")` for permission
 * and `assertCanAddLocation` for the plan's location ceiling (its
 * `PlanLimitError` is returned as `{ error }`, not thrown). When `parentId` is
 * supplied it must resolve to a location in the same organization; the tenant
 * facade scopes that lookup, so a `parentId` pointing at another org's row
 * fails this check even though Postgres foreign keys are exempt from RLS.
 */
export async function createLocation(
  formData: FormData,
): Promise<{ error?: string }> {
  const ctx = await requireRole("location.create");

  const raw: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value === "string" && value.trim() !== "") raw[key] = value;
  }

  const parsed = locationSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      error: parsed.error.issues[0]?.message ?? "Check the location details.",
    };
  }
  const { name, parentId, timeZone, locale, ...address } = parsed.data;

  if (parentId) {
    const parent = await ctx.db.location.findUnique({ where: { id: parentId } });
    if (!parent) {
      return { error: "Choose a parent location from your organization." };
    }
  }

  try {
    await assertCanAddLocation(ctx.organizationId);
  } catch (err) {
    if (err instanceof PlanLimitError) return { error: err.userMessage };
    throw err;
  }

  const created = await ctx.db.location.create({
    data: {
      organizationId: ctx.organizationId,
      name,
      parentId,
      timeZone,
      locale,
      ...address,
    },
  });

  await writeAudit({
    organizationId: ctx.organizationId,
    actorType: "USER",
    actorId: ctx.user.id,
    action: "location.create",
    targetType: "Location",
    targetId: created.id,
  });

  revalidatePath("/locations");
  return {};
}
