/**
 * Server auth context for authenticated server actions and route handlers.
 *
 * `requireUser` resolves the signed-in user or refuses. `resolveActiveOrg` picks
 * which organization the request acts in: it reads the `lynesign_active_org`
 * cookie but never trusts it, validating the value against the user's own
 * `ACTIVE` `Membership` rows and falling back to their most recently joined
 * membership when the cookie names an org they do not belong to (or names
 * nothing). `requireOrg` bundles the user, the resolved org, its role, a
 * tenant-scoped `db` facade, and the RBAC `actor`. `requireRole` is `requireOrg`
 * plus a permission gate.
 */

import { cookies } from "next/headers";
import type { Role } from "@prisma/client";
import { prisma } from "@/lib/db/root";
import { forOrg } from "@/lib/db/tenant";
import { getServerAuth } from "@/lib/auth/session";
import { UnauthorizedError, NotFoundError } from "@/lib/errors";
import { assertCan, type Actor } from "@/lib/rbac/can";
import type { Action } from "@/lib/rbac/policy";

export const ACTIVE_ORG_COOKIE = "lynesign_active_org";

export async function requireUser() {
  const session = await getServerAuth();
  if (!session) throw new UnauthorizedError("Please sign in to continue.");
  return session.user;
}

export async function resolveActiveOrg(
  userId: string,
): Promise<{ organizationId: string; role: Role }> {
  const memberships = await prisma.membership.findMany({
    where: { userId, status: "ACTIVE" },
    orderBy: { createdAt: "desc" },
  });
  if (memberships.length === 0) {
    throw new NotFoundError("You are not a member of any organization yet.");
  }

  // The cookie is a hint, never an authorization. It only counts when it names
  // one of this user's own active memberships; otherwise fall back to the most
  // recently joined one.
  const cookieOrg = (await cookies()).get(ACTIVE_ORG_COOKIE)?.value;
  const chosen = memberships.find((m) => m.organizationId === cookieOrg) ?? memberships[0];
  return { organizationId: chosen.organizationId, role: chosen.role };
}

export async function requireOrg() {
  const user = await requireUser();
  const { organizationId, role } = await resolveActiveOrg(user.id);
  const actor: Actor = {
    kind: "user",
    userId: user.id,
    isSuperAdmin: user.isSuperAdmin,
    role,
  };
  return { user, organizationId, role, db: forOrg(organizationId), actor };
}

export async function requireRole(action: Action) {
  const ctx = await requireOrg();
  assertCan(ctx.actor, action);
  return ctx;
}
