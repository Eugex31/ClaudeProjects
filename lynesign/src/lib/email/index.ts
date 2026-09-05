import nodemailer, { type Transporter } from "nodemailer";
import { prisma } from "@/lib/db/root";
import { logger } from "@/lib/logging";

// Re-exported so callers can pull the transport and the bodies from one place.
export { invitationEmail, magicLinkEmail, passwordResetEmail } from "./templates";

export type Mail = { to: string; subject: string; html: string };

let transport: Transporter | undefined;

/**
 * Builds the SMTP transport from EMAIL_SERVER on first use. Kept lazy so that
 * importing this module (and calling sendMail) never throws when EMAIL_SERVER
 * is unset, which is the normal state for local dev and the test runner.
 */
function getTransport(server: string): Transporter {
  transport ??= nodemailer.createTransport(server);
  return transport;
}

export async function sendMail(msg: Mail): Promise<void> {
  const server = process.env.EMAIL_SERVER;
  if (!server) {
    logger.warn(
      { to: msg.to, subject: msg.subject },
      "EMAIL_SERVER unset; logging mail instead of sending",
    );
    return;
  }
  await getTransport(server).sendMail({ from: process.env.EMAIL_FROM, ...msg });
}

/**
 * Enqueues a message for the worker to deliver instead of sending it inline.
 * Used for non latency-sensitive mail (invitations) so a slow or failing SMTP
 * server never blocks a request and delivery gets retried. Writes one PENDING
 * `OutboundEmail` row; `sendInvitationEmails` in the worker drains the queue.
 */
export async function queueMail(msg: Mail): Promise<void> {
  await prisma.outboundEmail.create({
    data: { to: msg.to, subject: msg.subject, html: msg.html, status: "PENDING" },
  });
}
