import { redirect } from "next/navigation";

import { requireOrg } from "@/lib/auth/context";
import { UnauthorizedError, NotFoundError } from "@/lib/errors";
import { prisma } from "@/lib/db/root";
import { visibleNav } from "@/lib/nav";
import { AppShell } from "@/components/app/app-shell";

/**
 * Frame for every authenticated `(app)` route. Resolves the request's user and
 * active organization; an unauthenticated request goes to `/login`, a user with
 * no membership goes to onboarding. Any other error propagates. On success it
 * loads the user's organizations for the switcher and renders the shell once.
 */
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  let ctx: Awaited<ReturnType<typeof requireOrg>>;
  try {
    ctx = await requireOrg();
  } catch (e) {
    if (e instanceof UnauthorizedError) redirect("/login");
    if (e instanceof NotFoundError) redirect("/register?onboard=1");
    throw e;
  }

  const memberships = await prisma.membership.findMany({
    where: { userId: ctx.user.id, status: "ACTIVE" },
    orderBy: { createdAt: "desc" },
    include: { organization: true },
  });
  const orgs = memberships.map((m) => ({
    id: m.organization.id,
    name: m.organization.name,
  }));

  return (
    <AppShell
      nav={visibleNav(ctx.actor)}
      orgs={orgs}
      activeOrgId={ctx.organizationId}
      user={{ email: ctx.user.email }}
    >
      {children}
    </AppShell>
  );
}
