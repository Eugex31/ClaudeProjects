"use client";

import * as React from "react";
import { MoreHorizontal } from "lucide-react";
import { toast } from "sonner";
import type { Role } from "@prisma/client";

import { updateMemberRole, removeMember } from "@/app/(app)/users/actions";
import { ASSIGNABLE_ROLES } from "@/lib/rbac/roles";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const ROLE_LABELS: Record<Role, string> = {
  OWNER: "Owner",
  ADMIN: "Admin",
  MANAGER: "Manager",
  CONTENT_MANAGER: "Content manager",
  VIEWER: "Viewer",
};

export interface MemberRowActionsProps {
  membershipId: string;
  memberName: string;
  currentRole: Role;
  isSelf: boolean;
  canUpdateRole: boolean;
  canRemove: boolean;
  /** Only an owner (or super admin) may hand out the OWNER role. */
  actorIsOwner: boolean;
}

/**
 * Per-row menu on the members table: a "Change role" submenu and a "Remove"
 * action behind a confirm dialog. Both call their server action and surface a
 * returned `{ error }` as a toast. The parent decides which items appear by
 * passing `canUpdateRole` / `canRemove` from `can(actor, ...)`; the OWNER choice
 * is only offered when `actorIsOwner`.
 */
export function MemberRowActions({
  membershipId,
  memberName,
  currentRole,
  isSelf,
  canUpdateRole,
  canRemove,
  actorIsOwner,
}: MemberRowActionsProps) {
  const [pending, startTransition] = React.useTransition();
  const [confirmOpen, setConfirmOpen] = React.useState(false);

  if (!canUpdateRole && !canRemove) return null;

  const roleChoices: Role[] = actorIsOwner
    ? [...ASSIGNABLE_ROLES, "OWNER"]
    : [...ASSIGNABLE_ROLES];

  function changeRole(role: Role) {
    startTransition(async () => {
      const result = await updateMemberRole(membershipId, role);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(`${memberName} is now ${ROLE_LABELS[role].toLowerCase()}.`);
    });
  }

  function confirmRemove() {
    startTransition(async () => {
      const result = await removeMember(membershipId);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(`${memberName} was removed from this organization.`);
      setConfirmOpen(false);
    });
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            aria-label={`Actions for ${memberName}`}
          >
            <MoreHorizontal aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          {canUpdateRole ? (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>Change role</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuLabel>Set role</DropdownMenuLabel>
                {roleChoices.map((role) => (
                  <DropdownMenuItem
                    key={role}
                    disabled={pending || role === currentRole}
                    onSelect={() => changeRole(role)}
                  >
                    {ROLE_LABELS[role]}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          ) : null}

          {canRemove ? (
            <>
              {canUpdateRole ? <DropdownMenuSeparator /> : null}
              <DropdownMenuItem
                variant="destructive"
                disabled={pending || isSelf}
                onSelect={(event) => {
                  event.preventDefault();
                  setConfirmOpen(true);
                }}
              >
                Remove from organization
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove {memberName}</DialogTitle>
            <DialogDescription>
              They lose access to this organization right away. You can invite
              them again later.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter showCloseButton>
            <Button
              variant="destructive"
              onClick={confirmRemove}
              disabled={pending}
            >
              {pending ? "Removing" : "Remove member"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
