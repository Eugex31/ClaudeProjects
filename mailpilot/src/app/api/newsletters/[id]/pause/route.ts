import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withAuth } from "@/lib/apiHandler";

export const POST = withAuth<{ id: string }>(async (_req, { userId, params }) => {
  const newsletter = await prisma.newsletter.findFirst({ where: { id: params.id, userId } });
  if (!newsletter) {
    return NextResponse.json({ error: "Newsletter not found" }, { status: 404 });
  }

  await prisma.newsletter.update({ where: { id: newsletter.id }, data: { status: "PAUSED" } });
  return NextResponse.json({ ok: true });
});
