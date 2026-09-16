import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withAuth } from "@/lib/apiHandler";
import { checkRateLimit } from "@/lib/rateLimit";
import { spawnNewsletterCampaign } from "@/worker/newsletterCycle";

// Runs one cycle immediately, outside the schedule, for confidence/testing —
// does not touch nextRunAt, so it doesn't disturb the regular cadence.
export const POST = withAuth<{ id: string }>(async (_req, { userId, params }) => {
  const allowed = await checkRateLimit(`newsletter-send-now:${userId}`, 10, 3600);
  if (!allowed) {
    return NextResponse.json({ error: "Too many manual sends recently. Try again later." }, { status: 429 });
  }

  const newsletter = await prisma.newsletter.findFirst({ where: { id: params.id, userId } });
  if (!newsletter) {
    return NextResponse.json({ error: "Newsletter not found" }, { status: 404 });
  }

  const result = await spawnNewsletterCampaign(newsletter);
  if (!result) {
    return NextResponse.json(
      { error: "Nothing to send — no matching contacts, or you're at your plan's email limit" },
      { status: 400 }
    );
  }

  await prisma.newsletter.update({ where: { id: newsletter.id }, data: { lastRunAt: new Date() } });
  return NextResponse.json({ ok: true, campaignId: result.campaignId });
});
