import { prisma } from "@/lib/db/root";
import { sendMail } from "@/lib/email";
import { logger } from "@/lib/logging";

const BATCH_SIZE = 20;
const MAX_ATTEMPTS = 5;

/**
 * Drains the `OutboundEmail` queue: sends every PENDING row and retries any
 * FAILED row that still has attempts left. A row is retried until `attempts`
 * reaches five, after which it stays FAILED and is skipped. Runs unscoped; the
 * queue is a global table with no tenant.
 */
export async function sendInvitationEmails(): Promise<{ sent: number; failed: number }> {
  const pending = await prisma.outboundEmail.findMany({
    where: { status: { in: ["PENDING", "FAILED"] }, attempts: { lt: MAX_ATTEMPTS } },
    orderBy: { createdAt: "asc" },
    take: BATCH_SIZE,
  });

  let sent = 0;
  let failed = 0;

  for (const mail of pending) {
    try {
      await sendMail({ to: mail.to, subject: mail.subject, html: mail.html });
      await prisma.outboundEmail.update({
        where: { id: mail.id },
        data: { status: "SENT", sentAt: new Date(), lastError: null },
      });
      sent += 1;
    } catch (e) {
      await prisma.outboundEmail.update({
        where: { id: mail.id },
        data: { status: "FAILED", attempts: { increment: 1 }, lastError: String(e) },
      });
      failed += 1;
    }
  }

  if (sent > 0 || failed > 0) {
    logger.info({ sent, failed }, "processed outbound email queue");
  }
  return { sent, failed };
}
