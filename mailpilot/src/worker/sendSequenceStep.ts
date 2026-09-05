import { prisma } from "@/lib/prisma";
import { getGmailClient, getConnectedGmailAddress, GmailNotConnectedError } from "@/lib/gmail/getGmailClient";
import { sendGmailMessage } from "@/lib/gmail/sendMessage";
import { composeEmail } from "@/lib/personalization/composeEmail";
import { getEffectiveSettings } from "@/lib/settings";
import { incrementTodaySentCount } from "@/lib/dailyLimit";
import { computeStepSendAt } from "@/lib/sequenceEnrollment";
import { inlineAppLogo } from "@/lib/personalization/inlineAppLogo";

const RETRY_DELAY_SECONDS = 5 * 60;

// Mirrors sendRecipient() in src/worker/sendJob.ts — same compose/send/count
// path, since a sequence send is still an email leaving the account and
// should be constrained by the same daily/tier limits as a campaign send.
// Differs in retry shape: SequenceEnrollment has no attemptCount/backoff
// column (unlike CampaignRecipient), so a failed send just pushes nextSendAt
// out by a flat delay and retries the same step — no max-attempts cutoff,
// since abandoning a nurture sequence on one transient failure is worse than
// occasionally retrying a already-delivered step's near-duplicate.
export async function sendEnrollmentStep(claimed: { id: string; sequenceId: string; contactId: string }): Promise<void> {
  const [enrollment, sequence, contact] = await Promise.all([
    prisma.sequenceEnrollment.findUniqueOrThrow({ where: { id: claimed.id } }),
    prisma.sequence.findUniqueOrThrow({ where: { id: claimed.sequenceId } }),
    prisma.contact.findUniqueOrThrow({ where: { id: claimed.contactId } }),
  ]);

  const step = await prisma.sequenceStep.findUnique({
    where: { sequenceId_order: { sequenceId: sequence.id, order: enrollment.currentStep } },
  });
  if (!step) {
    // No step at this index — sequence was edited out from under an in-flight enrollment.
    await prisma.sequenceEnrollment.update({
      where: { id: enrollment.id },
      data: { status: "COMPLETED", nextSendAt: null, lockedAt: null },
    });
    return;
  }

  const settings = await getEffectiveSettings(sequence.userId);
  const hasLogo = !!settings.signatureLogo && !!settings.signatureLogoContentType;
  const { subject, html, text } = composeEmail({
    subjectTemplate: step.subject,
    bodyTemplate: step.body,
    bodyFormat: step.bodyFormat,
    contact,
    signatureHtml: settings.signatureHtml,
    signatureLogoSrc: hasLogo ? "cid:signature-logo" : null,
    unsubscribeFooterText: settings.unsubscribeFooterText,
    includeUnsubscribeFooter: true,
  });

  let gmail;
  let fromAddress: string | null;
  try {
    [gmail, fromAddress] = await Promise.all([
      getGmailClient(sequence.userId),
      getConnectedGmailAddress(sequence.userId),
    ]);
  } catch (err) {
    if (err instanceof GmailNotConnectedError) {
      await prisma.sequenceEnrollment.update({
        where: { id: enrollment.id },
        data: { nextSendAt: new Date(Date.now() + RETRY_DELAY_SECONDS * 1000), lockedAt: null },
      });
      return;
    }
    throw err;
  }
  if (!fromAddress) {
    await prisma.sequenceEnrollment.update({
      where: { id: enrollment.id },
      data: { nextSendAt: new Date(Date.now() + RETRY_DELAY_SECONDS * 1000), lockedAt: null },
    });
    return;
  }

  const { html: finalHtml, attachments: appAssetAttachments } = inlineAppLogo(html);

  const result = await sendGmailMessage(gmail, {
    from: settings.senderName ? `${settings.senderName} <${fromAddress}>` : fromAddress,
    to: contact.email,
    subject,
    html: finalHtml,
    text,
    replyTo: settings.replyTo ?? undefined,
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
    console.error(`[sequences] send failed for enrollment ${enrollment.id}: ${result.error}`);
    await prisma.sequenceEnrollment.update({
      where: { id: enrollment.id },
      data: { nextSendAt: new Date(Date.now() + RETRY_DELAY_SECONDS * 1000), lockedAt: null },
    });
    return;
  }

  await incrementTodaySentCount(sequence.userId);

  const nextStep = await prisma.sequenceStep.findUnique({
    where: { sequenceId_order: { sequenceId: sequence.id, order: enrollment.currentStep + 1 } },
  });
  const nextSendAt = nextStep
    ? computeStepSendAt(sequence.triggerType, contact.appointmentAt, nextStep.delaySeconds)
    : null;

  await prisma.sequenceEnrollment.update({
    where: { id: enrollment.id },
    data: nextSendAt
      ? {
          currentStep: enrollment.currentStep + 1,
          nextSendAt,
          lockedAt: null,
        }
      : {
          currentStep: enrollment.currentStep + 1,
          status: "COMPLETED",
          nextSendAt: null,
          lockedAt: null,
        },
  });
}
