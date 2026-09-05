import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withAuth } from "@/lib/apiHandler";
import { addRecipientsSchema } from "@/lib/validation/campaign.schema";

export const GET = withAuth<{ id: string }>(async (req: NextRequest, { userId, params }) => {
  const campaign = await prisma.campaign.findFirst({ where: { id: params.id, userId } });
  if (!campaign) {
    return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
  }

  const page = Math.max(1, Number(req.nextUrl.searchParams.get("page") ?? "1"));
  const pageSize = Math.min(100, Math.max(1, Number(req.nextUrl.searchParams.get("pageSize") ?? "25")));

  const [recipients, total] = await Promise.all([
    prisma.campaignRecipient.findMany({
      where: { campaignId: params.id },
      include: { contact: true },
      orderBy: { createdAt: "asc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.campaignRecipient.count({ where: { campaignId: params.id } }),
  ]);

  return NextResponse.json({ recipients, total, page, pageSize });
});

export const POST = withAuth<{ id: string }>(async (req, { userId, params }) => {
  const { contactIds } = addRecipientsSchema.parse(await req.json());

  const campaign = await prisma.campaign.findFirst({ where: { id: params.id, userId } });
  if (!campaign) {
    return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
  }
  if (campaign.status === "SENDING") {
    return NextResponse.json({ error: "Cannot modify recipients while the campaign is sending" }, { status: 409 });
  }

  const ownedContacts = await prisma.contact.findMany({
    where: { userId, id: { in: contactIds } },
    select: { id: true },
  });
  const ownedIds = new Set(ownedContacts.map((c) => c.id));

  const result = await prisma.campaignRecipient.createMany({
    data: contactIds
      .filter((id) => ownedIds.has(id))
      .map((contactId) => ({ campaignId: params.id, contactId, scheduledAt: new Date() })),
    skipDuplicates: true,
  });

  return NextResponse.json({ added: result.count });
});
