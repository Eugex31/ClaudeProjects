"use client";

import * as React from "react";
import { LogOut, Menu } from "lucide-react";

import { signOutAction } from "@/app/(auth)/actions";
import type { NavItem } from "@/lib/nav";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { NavSidebar } from "@/components/app/nav-sidebar";
import { OrgSwitcher, type OrgSwitcherOrg } from "@/components/app/org-switcher";

export interface AppShellUser {
  email: string;
}

export interface AppShellProps {
  nav: NavItem[];
  orgs: OrgSwitcherOrg[];
  activeOrgId: string;
  user: AppShellUser;
  children: React.ReactNode;
}

function Wordmark({ as = "h2" }: { as?: "h2" | "div" }) {
  const Tag = as;
  return (
    <Tag className="font-display text-xl font-bold tracking-tight text-ink">
      Lyne<span className="text-tan">Sign</span>
    </Tag>
  );
}

function UserMenu({ email }: { email: string }) {
  const initial = email.charAt(0).toUpperCase() || "U";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Account menu">
          <span className="flex size-7 items-center justify-center rounded-full bg-navy text-xs font-semibold text-white">
            {initial}
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="truncate font-normal text-body">
          {email}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <form action={signOutAction}>
          <DropdownMenuItem asChild variant="destructive">
            <button type="submit" className="w-full">
              <LogOut className="size-4 shrink-0" aria-hidden />
              Sign out
            </button>
          </DropdownMenuItem>
        </form>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * The authenticated app frame: a fixed navy-hairline sidebar on `lg+`, a top bar
 * with a `Sheet` drawer below `lg`, and a header carrying the org switcher and
 * the account menu. All chrome is client-side; `children` is server-rendered
 * page content passed straight through.
 */
export function AppShell({ nav, orgs, activeOrgId, user, children }: AppShellProps) {
  const [drawerOpen, setDrawerOpen] = React.useState(false);

  return (
    <div className="min-h-screen bg-canvas">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-hairline bg-surface px-4 py-5 lg:flex">
        <div className="px-2">
          <Wordmark as="div" />
        </div>
        <div className="mt-6 flex-1 overflow-y-auto">
          <NavSidebar items={nav} />
        </div>
      </aside>

      <div className="lg:pl-60">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-hairline bg-surface/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-surface/80">
          <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
            <SheetTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="lg:hidden"
                aria-label="Open navigation"
              >
                <Menu className="size-5" aria-hidden />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-72 p-0">
              <SheetHeader className="p-0">
                <SheetTitle className="px-4 pt-4 font-display text-xl font-bold tracking-tight text-ink">
                  Lyne<span className="text-tan">Sign</span>
                </SheetTitle>
              </SheetHeader>
              <div className="px-3 pb-4">
                <NavSidebar items={nav} onNavigate={() => setDrawerOpen(false)} />
              </div>
            </SheetContent>
          </Sheet>

          <div className="flex flex-1 items-center gap-3">
            <OrgSwitcher orgs={orgs} activeOrgId={activeOrgId} />
          </div>

          <UserMenu email={user.email} />
        </header>

        <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
          {children}
        </main>
      </div>
    </div>
  );
}
