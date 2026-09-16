import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { SidebarNav } from "@/components/shared/sidebar-nav";
import { DarkModeToggle } from "@/components/shared/dark-mode-toggle";
import { UserMenu } from "@/components/shared/user-menu";
import { GmailConnectionBanner } from "@/components/shared/gmail-connection-banner";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { passwordHash: true },
  });

  return (
    <div className="flex min-h-screen flex-1">
      <aside className="hidden w-56 shrink-0 border-r bg-sidebar md:flex md:flex-col">
        <div className="flex items-center gap-2 px-4 py-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="" className="h-6 w-auto" />
          <span className="text-lg font-semibold">Email Marketing</span>
        </div>
        <SidebarNav />
      </aside>
      <div className="flex flex-1 flex-col">
        <header className="flex h-14 items-center justify-between border-b px-4">
          <div className="flex items-center gap-2 text-sm font-medium md:hidden">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.png" alt="" className="h-5 w-auto" />
            Email Marketing
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
        <GmailConnectionBanner />
        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    </div>
  );
}
