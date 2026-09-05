"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { requireUser, ACTIVE_ORG_COOKIE } from "@/lib/auth/context";
import { prisma } from "@/lib/db/root";
import { writeAudit } from "@/lib/audit";

export async function switchOrg(organizationId: string): Promise<{ error?: string }> {
  const user = await requireUser();

  const membership = await prisma.membership.findFirst({
    where: {
      userId: user.id,
      organizationId,
      status: "ACTIVE",
    },
  });

  if (!membership) {
    return { error: "You are not a member of that organization." };
  }

  (await cookies()).set(ACTIVE_ORG_COOKIE, organizationId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });

  await writeAudit({
    organizationId,
    actorType: "USER",
    actorId: user.id,
    action: "org.switch",
    targetType: "Organization",
    targetId: organizationId,
  });

  redirect("/dashboard");
}
