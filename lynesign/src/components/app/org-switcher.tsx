"use client";

import * as React from "react";
import { Building2, Check, ChevronsUpDown } from "lucide-react";

import { switchOrg } from "@/app/(app)/settings/actions";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export interface OrgSwitcherOrg {
  id: string;
  name: string;
}

export interface OrgSwitcherProps {
  orgs: OrgSwitcherOrg[];
  activeOrgId: string;
}

/**
 * Dropdown listing the signed-in user's organizations. Selecting one calls the
 * {@link switchOrg} server action, which validates membership, resets the
 * active-org cookie, and redirects. The current org is the trigger label.
 */
export function OrgSwitcher({ orgs, activeOrgId }: OrgSwitcherProps) {
  const [pending, startTransition] = React.useTransition();
  const active = orgs.find((o) => o.id === activeOrgId);
  const label = active?.name ?? "Select organization";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="max-w-[16rem] gap-2"
          disabled={pending}
        >
          <Building2 className="size-4 shrink-0" aria-hidden />
          <span className="truncate">{label}</span>
          <ChevronsUpDown className="size-4 shrink-0 opacity-60" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-[16rem]">
        <DropdownMenuLabel>Organizations</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {orgs.map((org) => {
          const isActive = org.id === activeOrgId;
          return (
            <DropdownMenuItem
              key={org.id}
              disabled={isActive || pending}
              onSelect={(event) => {
                event.preventDefault();
                if (isActive) return;
                startTransition(() => {
                  void switchOrg(org.id);
                });
              }}
            >
              <Check
                className={cn(
                  "size-4 shrink-0",
                  isActive ? "opacity-100" : "opacity-0",
                )}
                aria-hidden
              />
              <span className="truncate">{org.name}</span>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
