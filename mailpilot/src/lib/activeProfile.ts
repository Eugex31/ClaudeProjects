import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";

export const ACTIVE_PROFILE_COOKIE = "active_profile_id";

export type ActiveProfile = { id: string; label: string };

export type EffectiveIdentity = {
  userId: string;
  activeProfile: ActiveProfile | null;
};

// The one place "which tenant is this request actually for" gets resolved —
// used by withAuth() (src/lib/apiHandler.ts) for API routes and directly by
// the handful of Server Components that call auth() themselves
// ((dashboard)/dashboard/page.tsx, the hand-rolled OAuth connect/callback
// routes). realUserId must always be the real, logged-in session's own id —
// never itself the result of a previous resolveEffectiveUserId call, since
// nested acting-as is not supported (ownership below is checked against
// exactly one hop: ClientProfile.parentUserId).
export async function resolveEffectiveUserId(realUserId: string): Promise<EffectiveIdentity> {
  const activeProfileId = (await cookies()).get(ACTIVE_PROFILE_COOKIE)?.value;
  if (!activeProfileId) {
    return { userId: realUserId, activeProfile: null };
  }

  const profile = await prisma.clientProfile.findUnique({
    where: { id: activeProfileId },
    select: { id: true, label: true, parentUserId: true, profileUserId: true },
  });

  // Stale, deleted, or tampered cookie — fall back to the real account
  // silently rather than erroring every request. The "Acting as" banner
  // reads this same result and simply won't show.
  if (!profile || profile.parentUserId !== realUserId) {
    return { userId: realUserId, activeProfile: null };
  }

  return { userId: profile.profileUserId, activeProfile: { id: profile.id, label: profile.label } };
}
