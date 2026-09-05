"use client";

import type { Role } from "@prisma/client";

import { DataTable } from "@/components/app/data-table";
import { Heading } from "@/components/app/heading";
import { Badge } from "@/components/ui/badge";
import { MemberRowActions } from "@/components/app/member-row-actions";

const ROLE_LABELS: Record<Role, string> = {
  OWNER: "Owner",
  ADMIN: "Admin",
  MANAGER: "Manager",
  CONTENT_MANAGER: "Content manager",
  VIEWER: "Viewer",
};

export interface MemberTableRow {
  id: string;
  name: string;
  email: string;
  role: Role;
  joined: string;
  isSelf: boolean;
}

export interface InvitationTableRow {
  id: string;
  email: string;
  role: Role;
  status: string;
}

export interface MembersTableProps {
  members: MemberTableRow[];
  invitations: InvitationTableRow[];
  canUpdateRole: boolean;
  canRemove: boolean;
  /** Only an owner (or super admin) may hand out the OWNER role. */
  actorIsOwner: boolean;
}

/**
 * Client wrapper for the users list. The role/status `Badge` columns and the
 * per-row `<MemberRowActions>` menu are all `render` functions, and a Server
 * Component cannot hand a function across the boundary to the `"use client"`
 * {@link DataTable} -- in a production build that throws "Functions cannot be
 * passed directly to Client Components" while the page's RSC payload is
 * serialized. Declaring the columns in this client module keeps every closure on
 * the client side; the server page passes only serializable rows and flags.
 */
export function MembersTable({
  members,
  invitations,
  canUpdateRole,
  canRemove,
  actorIsOwner,
}: MembersTableProps) {
  const showActions = canUpdateRole || canRemove;

  return (
    <>
      <DataTable<MemberTableRow>
        columns={[
          { key: "name", header: "Name", sortable: true },
          { key: "email", header: "Email", sortable: true },
          {
            key: "role",
            header: "Role",
            sortable: true,
            render: (row) => (
              <Badge variant="outline">{ROLE_LABELS[row.role]}</Badge>
            ),
          },
          { key: "joined", header: "Joined" },
          ...(showActions
            ? [
                {
                  key: "actions",
                  header: "",
                  render: (row: MemberTableRow) => (
                    <div className="flex justify-end">
                      <MemberRowActions
                        membershipId={row.id}
                        memberName={row.name}
                        currentRole={row.role}
                        isSelf={row.isSelf}
                        canUpdateRole={canUpdateRole}
                        canRemove={canRemove}
                        actorIsOwner={actorIsOwner}
                      />
                    </div>
                  ),
                },
              ]
            : []),
        ]}
        rows={members}
      />

      <section className="space-y-3">
        <Heading as="h2" lead="Pending invitations" />
        {invitations.length === 0 ? (
          <p className="text-sm text-body">
            No invitations are waiting to be accepted.
          </p>
        ) : (
          <DataTable<InvitationTableRow>
            columns={[
              { key: "email", header: "Email", sortable: true },
              {
                key: "role",
                header: "Role",
                sortable: true,
                render: (row) => (
                  <Badge variant="outline">{ROLE_LABELS[row.role]}</Badge>
                ),
              },
              {
                key: "status",
                header: "Status",
                render: (row) => <Badge variant="secondary">{row.status}</Badge>,
              },
            ]}
            rows={invitations}
          />
        )}
      </section>
    </>
  );
}
