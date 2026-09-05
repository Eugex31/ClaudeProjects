import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withAuth } from "@/lib/apiHandler";

export const POST = withAuth(async (_req, { userId }) => {
  const { count } = await prisma.mondayIntegration.updateMany({
    where: { userId },
    data: { syncEnabled: true },
  });
  if (count === 0) {
    return NextResponse.json({ error: "Connect Monday.com first" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
});
