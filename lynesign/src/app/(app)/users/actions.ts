"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import type { Role } from "@prisma/client";
import { prisma } from "@/lib/db/root";
import { requireRole } from "@/lib/auth/context";
import { assertCanAddUser } from "@/lib/plan-limits";
import { queueMail, invitationEmail } from "@/lib/email";
import { writeAudit } from "@/lib/audit";
import { inviteSchema } from "@/lib/validation/members";

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Invites an email address into the caller's active organization.
 *
 * Gated twice: `requireRole("member.invite")` for permission and
 * `assertCanAddUser` for the plan's seat ceiling. An email that already belongs
 * to a member is reported as a returned error, never thrown. A still-open
 * invitation for the same (org, email) is refreshed in place rather than
 * duplicated; otherwise a new one is created. The token is a random UUID, so the
 * accept URL cannot be guessed or enumerated.
 *
 * Every `Invitation` and `Membership` read and write goes through `ctx.db`, the
 * tenant facade, so both guard layers apply. Only `User` and `Organization`,
 * which are global tables with no `organizationId`, use the root client.
 */
export async function inviteMember(
  formData: FormData,
): Promise<{ error?: string; ok?: true }> {
  const ctx = await requireRole("member.invite");

  const parsed = inviteSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return {
      error: parsed.error.issues[0]?.message ?? "Check the invitation details.",
    };
  }
  const email = parsed.data.email.toLowerCase();
  const { role } = parsed.data;

  const existingUser = await prisma.user.findUnique({ where: { email } });
  if (existingUser) {
    const membership = await ctx.db.membership.findFirst({
      where: { userId: existingUser.id },
    });
    if (membership) {
      return { error: "That person is already a member of this organization." };
    }
  }

  const token = randomUUID();
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS);

  const open = await ctx.db.invitation.findFirst({
    where: { email, acceptedAt: null },
  });

  // A live invitation is already holding the seat it would take, so re-issuing
  // it consumes nothing new and must not be blocked by the org's own reservation.
  // An expired one has released its seat, so that path re-asserts the ceiling.
  if (!open || open.expiresAt <= new Date()) {
    await assertCanAddUser(ctx.organizationId);
  }

  if (open) {
    await ctx.db.invitation.update({
      where: { id: open.id },
      data: { token, expiresAt, role, invitedByUserId: ctx.user.id },
    });
  } else {
    await ctx.db.invitation.create({
      data: {
        organizationId: ctx.organizationId,
        email,
        role,
        token,
        expiresAt,
        invitedByUserId: ctx.user.id,
      },
    });
  }

  const org = await prisma.organization.findUnique({
    where: { id: ctx.organizationId },
  });
  const url = `${process.env.AUTH_URL}/invite/${token}`;
  await queueMail({
    to: email,
    subject: "You have been invited to LyneSign",
    html: invitationEmail(org?.name ?? "Your team", url),
  });

  await writeAudit({
    organizationId: ctx.organizationId,
    actorType: "USER",
    actorId: ctx.user.id,
    action: "member.invite",
    targetType: "Invitation",
    metadata: { email, role },
  });

  return { ok: true };
}

/**
 * Changes one member's role within the caller's active organization.
 *
 * The target is loaded through the tenant facade, so a `membershipId` from
 * another organization resolves to `null` and is reported as "not found" rather
 * than touched. Two invariants are enforced before the write: only an owner (or
 * a super admin) may hand out the `OWNER` role, and the organization's last
 * remaining owner cannot be demoted. Gated by `requireRole("member.updateRole")`
 * and audited afterwards.
 */
export async function updateMemberRole(
  membershipId: string,
  role: Role,
): Promise<{ error?: string }> {
  const ctx = await requireRole("member.updateRole");

  const target = await ctx.db.membership.findUnique({ where: { id: membershipId } });
  if (!target) {
    return { error: "That member was not found." };
  }

  const actorIsOwner = ctx.role === "OWNER" || ctx.user.isSuperAdmin;
  if (role === "OWNER" && !actorIsOwner) {
    return { error: "Only an owner can grant the owner role." };
  }

  if (target.role === "OWNER" && role !== "OWNER") {
    const ownerCount = await ctx.db.membership.count({ where: { role: "OWNER" } });
    if (ownerCount === 1) {
      return { error: "An organization must keep at least one owner." };
    }
  }

  if (target.role === role) {
    return {};
  }

  await ctx.db.membership.update({ where: { id: membershipId }, data: { role } });

  await writeAudit({
    organizationId: ctx.organizationId,
    actorType: "USER",
    actorId: ctx.user.id,
    action: "member.updateRole",
    targetType: "Membership",
    targetId: membershipId,
    metadata: { from: target.role, to: role },
  });

  revalidatePath("/users");
  return {};
}

/**
 * Removes a member from the caller's active organization.
 *
 * Loaded through the tenant facade, so a cross-organization `membershipId` is
 * "not found" and nothing is deleted. You cannot remove your own membership, and
 * the organization's last remaining owner cannot be removed. Gated by
 * `requireRole("member.remove")` and audited afterwards.
 */
export async function removeMember(
  membershipId: string,
): Promise<{ error?: string }> {
  const ctx = await requireRole("member.remove");

  const target = await ctx.db.membership.findUnique({ where: { id: membershipId } });
  if (!target) {
    return { error: "That member was not found." };
  }

  if (target.userId === ctx.user.id) {
    return { error: "You cannot remove yourself." };
  }

  if (target.role === "OWNER") {
    const ownerCount = await ctx.db.membership.count({ where: { role: "OWNER" } });
    if (ownerCount === 1) {
      return { error: "An organization must keep at least one owner." };
    }
  }

  await ctx.db.membership.delete({ where: { id: membershipId } });

  await writeAudit({
    organizationId: ctx.organizationId,
    actorType: "USER",
    actorId: ctx.user.id,
    action: "member.remove",
    targetType: "Membership",
    targetId: membershipId,
    metadata: { role: target.role, userId: target.userId },
  });

  revalidatePath("/users");
  return {};
}
