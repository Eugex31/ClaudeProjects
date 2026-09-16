import { prisma } from "@/lib/prisma";
import { getGmailClient, getConnectedGmailAddress, GmailNotConnectedError } from "@/lib/gmail/getGmailClient";
import { sendGmailMessage } from "@/lib/gmail/sendMessage";
import { composeEmail } from "@/lib/personalization/composeEmail";
import { getEffectiveSettings } from "@/lib/settings";
import { incrementTodaySentCount } from "@/lib/dailyLimit";
import { computeBackoff, isMaxAttemptsReached } from "@/lib/scheduling";
import { injectTracking } from "@/lib/tracking/injectTracking";
import { inlineAppLogo } from "@/lib/personalization/inlineAppLogo";

export async function sendRecipient(claimed: { id: string; campaignId: string; contactId: string }): Promise<void> {
  const [recipient, campaign, contact] = await Promise.all([
    prisma.campaignRecipient.findUniqueOrThrow({ where: { id: claimed.id } }),
    prisma.campaign.findUniqueOrThrow({ where: { id: claimed.campaignId } }),
    prisma.contact.findUniqueOrThrow({ where: { id: claimed.contactId } }),
  ]);

  const settings = await getEffectiveSettings(campaign.userId);
  const hasLogo = !!settings.signatureLogo && !!settings.signatureLogoContentType;
  const { subject, html, text } = composeEmail({
    subjectTemplate: campaign.subject,
    bodyTemplate: campaign.body,
    bodyFormat: campaign.bodyFormat,
    contact,
    signatureHtml: settings.signatureHtml,
    signatureLogoSrc: hasLogo ? "cid:signature-logo" : null,
    unsubscribeFooterText: settings.unsubscribeFooterText,
    includeUnsubscribeFooter: campaign.unsubscribeFooterEnabled,
  });

  let gmail;
  let fromAddress: string | null;
  try {
    [gmail, fromAddress] = await Promise.all([
      getGmailClient(campaign.userId),
      getConnectedGmailAddress(campaign.userId),
    ]);
  } catch (err) {
    if (err instanceof GmailNotConnectedError) {
      // Not this recipient's fault — revert to PENDING without burning an
      // attempt so it retries automatically once the user reconnects Gmail.
      await prisma.campaignRecipient.update({
        where: { id: recipient.id },
        data: { status: "PENDING", lastError: "Gmail account not connected" },
      });
      return;
    }
    throw err;
  }
  if (!fromAddress) {
    await prisma.campaignRecipient.update({
      where: { id: recipient.id },
      data: { status: "PENDING", lastError: "Gmail account not connected" },
    });
    return;
  }

  const senderName = campaign.senderNameOverride ?? settings.senderName;
  const replyTo = campaign.replyToOverride ?? settings.replyTo ?? undefined;
  const trackedHtml = injectTracking(html, recipient.trackingToken, process.env.NEXTAUTH_URL!);
  const { html: finalHtml, attachments: appAssetAttachments } = inlineAppLogo(trackedHtml);

  const result = await sendGmailMessage(gmail, {
    from: senderName ? `${senderName} <${fromAddress}>` : fromAddress,
    to: contact.email,
    subject,
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

  if (result.ok) {
    await prisma.campaignRecipient.update({
      where: { id: recipient.id },
      data: {
        status: "SENT",
        sentAt: new Date(),
        gmailMessageId: result.messageId,
        renderedSubject: subject,
        renderedBody: text,
        lastError: null,
      },
    });
    await incrementTodaySentCount(campaign.userId);
    return;
  }

  const nextAttemptCount = recipient.attemptCount + 1;
  if (result.retryable && !isMaxAttemptsReached(nextAttemptCount)) {
    await prisma.campaignRecipient.update({
      where: { id: recipient.id },
      data: {
        status: "RETRYING",
        attemptCount: nextAttemptCount,
        lastError: result.error,
        scheduledAt: new Date(Date.now() + computeBackoff(nextAttemptCount) * 1000),
      },
    });
  } else {
    await prisma.campaignRecipient.update({
      where: { id: recipient.id },
      data: { status: "FAILED", attemptCount: nextAttemptCount, lastError: result.error },
    });
  }
}
