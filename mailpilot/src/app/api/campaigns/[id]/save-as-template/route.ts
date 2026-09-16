import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withAuth } from "@/lib/apiHandler";
import { saveAsTemplateSchema } from "@/lib/validation/template.schema";

export const POST = withAuth<{ id: string }>(async (req, { userId, params }) => {
  const campaign = await prisma.campaign.findFirst({ where: { id: params.id, userId } });
  if (!campaign) {
    return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
  }

  const { name } = saveAsTemplateSchema.parse(await req.json());
  const template = await prisma.template.create({
    data: { userId, name, subject: campaign.subject, body: campaign.body, bodyFormat: campaign.bodyFormat },
  });

  return NextResponse.json({ template }, { status: 201 });
});
