import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withAuth } from "@/lib/apiHandler";
import { testSendSchema } from "@/lib/validation/campaign.schema";
import { getGmailClient, getConnectedGmailAddress, GmailNotConnectedError } from "@/lib/gmail/getGmailClient";
import { sendGmailMessage } from "@/lib/gmail/sendMessage";
import { composeEmail } from "@/lib/personalization/composeEmail";
import { inlineAppLogo } from "@/lib/personalization/inlineAppLogo";
import { getEffectiveSettings } from "@/lib/settings";
import { checkRateLimit } from "@/lib/rateLimit";

export const POST = withAuth<{ id: string }>(async (req, { userId, params }) => {
  const { to, sampleContactId } = testSendSchema.parse(await req.json());

  const allowed = await checkRateLimit(`test-send:${userId}`, 10, 3600);
  if (!allowed) {
    return NextResponse.json({ error: "Too many test emails sent recently. Try again later." }, { status: 429 });
  }

  const campaign = await prisma.campaign.findFirst({ where: { id: params.id, userId } });
  if (!campaign) {
    return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
  }
  if (!campaign.subject.trim() || !campaign.body.trim()) {
    return NextResponse.json({ error: "Campaign needs a subject and body before sending" }, { status: 400 });
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
    signatureLogoSrc: hasLogo ? "cid:signature-logo" : null,
    unsubscribeFooterText: settings.unsubscribeFooterText,
    includeUnsubscribeFooter: campaign.unsubscribeFooterEnabled,
  });

  const fromAddress = await getConnectedGmailAddress(userId);
  if (!fromAddress) {
    return NextResponse.json({ error: "No connected Gmail account" }, { status: 400 });
  }
  const senderName = campaign.senderNameOverride ?? settings.senderName;
  const replyTo = campaign.replyToOverride ?? settings.replyTo ?? undefined;

  try {
    const gmail = await getGmailClient(userId);
    const { html: finalHtml, attachments: appAssetAttachments } = inlineAppLogo(html);
    const result = await sendGmailMessage(gmail, {
      from: senderName ? `${senderName} <${fromAddress}>` : fromAddress,
      to,
      subject: `[TEST] ${subject}`,
      html: finalHtml,
      text,
      replyTo,
      attachments: [
        ...(hasLogo
          ? [
              {
                cid: "signature-logo",
                filename: settings.signatureLogoFilename ?? "logo.png",
                contentType: settings.signatureLogoContentType!,
                content: Buffer.from(settings.signatureLogo!),
              },
            ]
          : []),
        ...appAssetAttachments,
      ],
    });

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 502 });
    }
    return NextResponse.json({ ok: true, messageId: result.messageId });
  } catch (err) {
    if (err instanceof GmailNotConnectedError) {
      return NextResponse.json({ error: "No connected Gmail account" }, { status: 400 });
    }
    throw err;
  }
});
