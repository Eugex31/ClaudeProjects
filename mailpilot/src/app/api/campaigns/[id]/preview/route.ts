import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { withAuth } from "@/lib/apiHandler";
import { composeEmail } from "@/lib/personalization/composeEmail";
import { getEffectiveSettings } from "@/lib/settings";

const previewSchema = z.object({ sampleContactId: z.string().optional() });

export const POST = withAuth<{ id: string }>(async (req, { userId, params }) => {
  const { sampleContactId } = previewSchema.parse(await req.json().catch(() => ({})));

  const campaign = await prisma.campaign.findFirst({ where: { id: params.id, userId } });
  if (!campaign) {
    return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
  }

  const sampleContact = sampleContactId
    ? await prisma.contact.findFirst({ where: { id: sampleContactId, userId } })
    : null;

  const settings = await getEffectiveSettings(userId);
  const hasLogo = !!settings.signatureLogo && !!settings.signatureLogoContentType;
  const { subject, html, text } = composeEmail({
    subjectTemplate: campaign.subject,
    bodyTemplate: campaign.body,
    bodyFormat: campaign.bodyFormat,
    contact: sampleContact ?? {},
    signatureHtml: settings.signatureHtml,
    signatureLogoSrc: hasLogo ? "/api/settings/signature-logo" : null,
    unsubscribeFooterText: settings.unsubscribeFooterText,
    includeUnsubscribeFooter: campaign.unsubscribeFooterEnabled,
  });

  return NextResponse.json({ subject, html, text, bodyFormat: campaign.bodyFormat });
});
