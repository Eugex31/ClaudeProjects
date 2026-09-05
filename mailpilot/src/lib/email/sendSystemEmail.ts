// Transactional email for the app itself (password reset, welcome, etc.) —
// distinct from campaign sending, which always goes through a customer's own
// connected Gmail account (src/lib/gmail/*). Uses Resend's HTTP API directly
// (a single POST) rather than pulling in its SDK for one call.
//
// Without RESEND_API_KEY configured (e.g. local dev), this logs the email to
// the console instead of failing, so registration/password-reset flows are
// testable without a real Resend account.

const RESEND_API_URL = "https://api.resend.com/emails";

export type SystemEmailInput = {
  to: string;
  subject: string;
  html: string;
  text: string;
};

export async function sendSystemEmail(input: SystemEmailInput): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.SYSTEM_EMAIL_FROM ?? "Email Marketing <onboarding@resend.dev>";

  if (!apiKey) {
    console.warn(
      `[email] RESEND_API_KEY not set — logging instead of sending.\nTo: ${input.to}\nSubject: ${input.subject}\n${input.text}`
    );
    return;
  }

  const res = await fetch(RESEND_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: input.to,
      subject: input.subject,
      html: input.html,
      text: input.text,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Failed to send system email: ${res.status} ${body}`);
  }
}
