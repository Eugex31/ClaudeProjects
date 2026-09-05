import type { gmail_v1 } from "googleapis";
import { buildMime, type MimeMessageInput } from "@/lib/gmail/buildMime";

export type SendResult =
  | { ok: true; messageId: string }
  | { ok: false; retryable: boolean; error: string };

function classifyError(err: unknown): { retryable: boolean; error: string } {
  const status = (err as { code?: number; response?: { status?: number } })?.code
    ?? (err as { response?: { status?: number } })?.response?.status;
  const message = err instanceof Error ? err.message : String(err);

  if (status === 401) return { retryable: true, error: `Auth expired: ${message}` };
  if (status === 429) return { retryable: true, error: `Rate limited: ${message}` };
  if (status === 403) return { retryable: true, error: `Quota/permission error: ${message}` };
  if (status && status >= 500) return { retryable: true, error: `Gmail server error: ${message}` };
  if (status === 400) return { retryable: false, error: `Invalid message: ${message}` };
  return { retryable: false, error: message };
}

export async function sendGmailMessage(
  gmail: gmail_v1.Gmail,
  input: MimeMessageInput
): Promise<SendResult> {
  try {
    const raw = await buildMime(input);
    const res = await gmail.users.messages.send({ userId: "me", requestBody: { raw } });
    const messageId = res.data.id;
    if (!messageId) {
      return { ok: false, retryable: true, error: "Gmail did not return a message id" };
    }
    return { ok: true, messageId };
  } catch (err) {
    return { ok: false, ...classifyError(err) };
  }
}
