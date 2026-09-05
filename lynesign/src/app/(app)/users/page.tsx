import { format } from "date-fns";

import { requireOrg } from "@/lib/auth/context";
import { can } from "@/lib/rbac/can";
import { PageHeader } from "@/components/app/page-header";
import { InviteMemberDialog } from "@/components/app/invite-member-dialog";
import {
  MembersTable,
  type InvitationTableRow,
  type MemberTableRow,
} from "@/app/(app)/users/members-table";

export const metadata = { title: "Users" };

/**
 * Members of the active organization plus any still-open invitations. Reads run
 * through the tenant facade, so every row is scoped to the caller's org. Row
 * actions (change role, remove) and the invite control are each gated by
 * `can(actor, ...)`; the server actions re-check permission and the last-owner
 * and self-removal invariants.
 *
 * The table's role/status badges and the per-row actions menu are `render`
 * closures, which a Server Component cannot pass across the boundary to the
 * `"use client"` DataTable. They live in {@link MembersTable}; this page hands it
 * only serializable rows and capability flags.
 */
export default async function UsersPage() {
  const ctx = await requireOrg();

  const [memberships, invitations] = await Promise.all([
    ctx.db.membership.findMany({
      include: { user: { select: { name: true, email: true } } },
      orderBy: { createdAt: "asc" },
    }),
    ctx.db.invitation.findMany({
      where: { acceptedAt: null },
      orderBy: { email: "asc" },
    }),
  ]);

  const canInvite = can(ctx.actor, "member.invite");
  const canUpdateRole = can(ctx.actor, "member.updateRole");
  const canRemove = can(ctx.actor, "member.remove");
  const actorIsOwner = ctx.role === "OWNER" || ctx.user.isSuperAdmin;

  const memberRows: MemberTableRow[] = memberships.map((membership) => ({
    id: membership.id,
    name: membership.user.name ?? membership.user.email,
    email: membership.user.email,
    role: membership.role,
    joined: format(membership.createdAt, "d MMM yyyy"),
    isSelf: membership.userId === ctx.user.id,
  }));

  const invitationRows: InvitationTableRow[] = invitations.map((invitation) => ({
    id: invitation.id,
    email: invitation.email,
    role: invitation.role,
    status: "Invited",
  }));

  return (
    <div className="space-y-8">
      <PageHeader
        title="Users"
        description="Everyone with access to this organization. Invite people by email and set what each person can do with their role."
        actions={canInvite ? <InviteMemberDialog /> : undefined}
      />

      <MembersTable
        members={memberRows}
        invitations={invitationRows}
        canUpdateRole={canUpdateRole}
        canRemove={canRemove}
        actorIsOwner={actorIsOwner}
      />
    </div>
  );
}
