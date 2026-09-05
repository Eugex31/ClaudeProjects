import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withAuth } from "@/lib/apiHandler";
import { computeNextRunAt } from "@/lib/newsletterSchedule";

export const POST = withAuth<{ id: string }>(async (_req, { userId, params }) => {
  const newsletter = await prisma.newsletter.findFirst({ where: { id: params.id, userId } });
  if (!newsletter) {
    return NextResponse.json({ error: "Newsletter not found" }, { status: 404 });
  }

  // Always recompute from now, regardless of any previous nextRunAt — a
  // newsletter paused for a while and reactivated should start the countdown
  // over, not fire immediately on a stale schedule.
  const nextRunAt = computeNextRunAt(newsletter, new Date());
  await prisma.newsletter.update({
    where: { id: newsletter.id },
    data: { status: "ACTIVE", nextRunAt },
  });
  return NextResponse.json({ ok: true, nextRunAt });
});
