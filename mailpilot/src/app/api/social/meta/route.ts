import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withAuth } from "@/lib/apiHandler";

export const GET = withAuth(async (_req, { userId }) => {
  const identity = await prisma.metaIdentity.findUnique({ where: { userId } });
  const accounts = await prisma.socialAccount.findMany({
    where: { userId },
    select: { id: true, platform: true, displayName: true, connectedAt: true },
    orderBy: { connectedAt: "asc" },
  });
  return NextResponse.json({ connected: Boolean(identity), accounts });
});

// Full disconnect — deletes MetaIdentity, which cascades every SocialAccount
// row created from it in one shot (onDelete: Cascade on the FK), same
// one-call-cascades-everything precedent already proven for User deletion.
export const DELETE = withAuth(async (_req, { userId }) => {
  const identity = await prisma.metaIdentity.findUnique({ where: { userId } });
  if (!identity) {
    return NextResponse.json({ error: "Not connected" }, { status: 400 });
  }
  await prisma.metaIdentity.delete({ where: { id: identity.id } });
  return NextResponse.json({ success: true });
});
