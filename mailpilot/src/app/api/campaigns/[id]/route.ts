import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withAuth } from "@/lib/apiHandler";
import { campaignUpdateSchema } from "@/lib/validation/campaign.schema";

export const GET = withAuth<{ id: string }>(async (_req, { userId, params }) => {
  const campaign = await prisma.campaign.findFirst({
    where: { id: params.id, userId },
    include: { _count: { select: { recipients: true } } },
  });
  if (!campaign) {
    return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
  }
  return NextResponse.json({ campaign });
});

export const PATCH = withAuth<{ id: string }>(async (req, { userId, params }) => {
  const body = campaignUpdateSchema.parse(await req.json());

  const existing = await prisma.campaign.findFirst({ where: { id: params.id, userId } });
  if (!existing) {
    return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
  }
  if (existing.status === "SENDING") {
    // Renaming is allowed even mid-send; every other field stays locked.
    // Enforced here too, not just by the disabled form fields client-side —
    // a direct API call must not be able to sneak other changes through
    // under the guise of a rename.
    const onlyRenaming = Object.keys(body).every((key) => key === "name");
    if (!onlyRenaming) {
      return NextResponse.json({ error: "Cannot edit a campaign while it is sending" }, { status: 409 });
    }
    const campaign = await prisma.campaign.update({ where: { id: params.id }, data: { name: body.name } });
    return NextResponse.json({ campaign });
  }

  const nextMin = body.delayMinSeconds ?? existing.delayMinSeconds;
  const nextMax = body.delayMaxSeconds ?? existing.delayMaxSeconds;
  if (nextMax < nextMin) {
    return NextResponse.json({ error: "Max delay must be greater than or equal to min delay" }, { status: 400 });
  }

  const campaign = await prisma.campaign.update({ where: { id: params.id }, data: body });
  return NextResponse.json({ campaign });
});

export const DELETE = withAuth<{ id: string }>(async (_req, { userId, params }) => {
  const { count } = await prisma.campaign.deleteMany({ where: { id: params.id, userId } });
  if (count === 0) {
    return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
});
