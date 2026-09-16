import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withAuth } from "@/lib/apiHandler";
import { checkRateLimit } from "@/lib/rateLimit";

// Bulk-marks every contact dirty for the worker's next poll ticks to pick up
// (bounded per-tick, see MAX_MONDAY_SYNCS_PER_TICK in src/worker/poller.ts) —
// this route itself just flips the flags and returns immediately.
export const POST = withAuth(async (_req, { userId }) => {
  const allowed = await checkRateLimit(`monday-sync-now:${userId}`, 5, 3600);
  if (!allowed) {
    return NextResponse.json({ error: "Too many manual syncs recently. Try again later." }, { status: 429 });
  }

  const integration = await prisma.mondayIntegration.findUnique({ where: { userId } });
  if (!integration?.boardId) {
    return NextResponse.json({ error: "Connect Monday.com and pick a board first" }, { status: 404 });
  }

  const { count } = await prisma.contact.updateMany({ where: { userId }, data: { mondayDirty: true } });
  return NextResponse.json({ ok: true, queued: count });
});
