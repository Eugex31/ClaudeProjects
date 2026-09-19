import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withAuth } from "@/lib/apiHandler";

// Removes one connected account (e.g. just the Instagram side, keeping the
// Facebook Page connected) — full disconnect is DELETE /api/social/meta.
export const DELETE = withAuth<{ id: string }>(async (_req, { userId, params }) => {
  const account = await prisma.socialAccount.findFirst({ where: { id: params.id, userId } });
  if (!account) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  await prisma.socialAccount.delete({ where: { id: account.id } });
  return NextResponse.json({ success: true });
});
