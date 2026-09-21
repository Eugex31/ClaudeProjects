import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getEffectiveSubscription } from "@/lib/billing";
import { resolveEffectiveUserId } from "@/lib/activeProfile";
import { SidebarNav } from "@/components/shared/sidebar-nav";
import { DarkModeToggle } from "@/components/shared/dark-mode-toggle";
import { UserMenu } from "@/components/shared/user-menu";
import { GmailConnectionBanner } from "@/components/shared/gmail-connection-banner";
import { ActiveProfileBanner } from "@/components/shared/active-profile-banner";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }

  // Profile visibility/eligibility is always resolved against the REAL
  // account, never through resolveEffectiveUserId — managing profiles, and
  // whether the "Profiles" nav item even shows, is inherently a parent-level
  // concern (see src/lib/activeProfile.ts). activeProfile itself (for the
  // banner + hiding Billing/Profiles) comes from the same resolver everyone
  // else uses.
  const [user, subscription, { activeProfile }] = await Promise.all([
    prisma.user.findUnique({ where: { id: session.user.id }, select: { passwordHash: true } }),
    getEffectiveSubscription(session.user.id),
    resolveEffectiveUserId(session.user.id),
  ]);

  return (
    <div className="flex min-h-screen flex-1">
      <aside className="hidden w-56 shrink-0 border-r bg-sidebar md:flex md:flex-col">
        <div className="flex flex-col items-center gap-1 px-4 py-4 text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="" className="h-10 w-auto" />
          <span className="text-lg font-semibold">LyneSign Marketing</span>
        </div>
        <SidebarNav showProfiles={subscription.plan.profileLimit !== 0} isActingAsProfile={!!activeProfile} />
      </aside>
      <div className="flex flex-1 flex-col">
        <header className="flex h-14 items-center justify-between border-b px-4">
          <div className="flex items-center gap-2 text-sm font-medium md:hidden">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.png" alt="" className="h-5 w-auto" />
            LyneSign Marketing
          </div>
          <div className="ml-auto flex items-center gap-2">
            <DarkModeToggle />
            <UserMenu
              name={session.user.name}
              email={session.user.email}
              image={session.user.image}
              hasPassword={!!user?.passwordHash}
            />
          </div>
        </header>
        {activeProfile && <ActiveProfileBanner label={activeProfile.label} />}
        <GmailConnectionBanner />
        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    </div>
  );
}
