import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withAuth } from "@/lib/apiHandler";
import { checkTemplateLimit } from "@/lib/billing";

// The backend half of "Edit" on a starter template — copies it into the
// customer's own Template table so it can be edited there; the shared
// StarterTemplate row is never touched.
export const POST = withAuth<{ id: string }>(async (_req, { userId, params }) => {
  const starterTemplate = await prisma.starterTemplate.findUnique({ where: { id: params.id } });
  if (!starterTemplate) {
    return NextResponse.json({ error: "Template not found" }, { status: 404 });
  }

  const limitCheck = await checkTemplateLimit(userId);
  if (!limitCheck.allowed) {
    return NextResponse.json({ error: limitCheck.message, upgradeRequired: true }, { status: 402 });
  }

  const template = await prisma.template.create({
    data: {
      userId,
      name: starterTemplate.name,
      subject: starterTemplate.subject,
      body: starterTemplate.body,
      bodyFormat: starterTemplate.bodyFormat,
      categoryId: starterTemplate.categoryId,
    },
  });

  return NextResponse.json({ template }, { status: 201 });
});
