import { google, gmail_v1 } from "googleapis";
import { prisma } from "@/lib/prisma";
import { encryptToken, decryptToken } from "@/lib/crypto/tokenCipher";

const REFRESH_MARGIN_SECONDS = 60;

export class GmailNotConnectedError extends Error {
  constructor() {
    super("No connected Gmail account for this user");
    this.name = "GmailNotConnectedError";
  }
}

export async function getGmailClient(userId: string): Promise<gmail_v1.Gmail> {
  const account = await prisma.account.findFirst({ where: { userId, provider: "google" } });
  if (!account?.access_token || !account.refresh_token) {
    throw new GmailNotConnectedError();
  }

  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );

  const nowSeconds = Math.floor(Date.now() / 1000);
  const isExpired = !account.expires_at || account.expires_at - REFRESH_MARGIN_SECONDS <= nowSeconds;

  if (isExpired) {
    oauth2Client.setCredentials({ refresh_token: decryptToken(account.refresh_token) });
    const { credentials } = await oauth2Client.refreshAccessToken();

    await prisma.account.update({
      where: { id: account.id },
      data: {
        access_token: credentials.access_token ? encryptToken(credentials.access_token) : account.access_token,
        refresh_token: credentials.refresh_token ? encryptToken(credentials.refresh_token) : account.refresh_token,
        expires_at: credentials.expiry_date ? Math.floor(credentials.expiry_date / 1000) : account.expires_at,
      },
    });

    oauth2Client.setCredentials(credentials);
  } else {
    oauth2Client.setCredentials({ access_token: decryptToken(account.access_token) });
  }

  return google.gmail({ version: "v1", auth: oauth2Client });
}

// Gmail always sends as the OAuth-authenticated account's own address, and
// allowDangerousEmailAccountLinking (see src/lib/auth.ts) guarantees that
// address equals User.email whenever a google Account is actually linked —
// so this only needs to confirm a google Account exists, not query Google.
// Must return null (not User.email) when no Account is linked: password-only
// accounts have a User row with no connected Gmail at all.
export async function getConnectedGmailAddress(userId: string): Promise<string | null> {
  const [user, account] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { email: true } }),
    prisma.account.findFirst({ where: { userId, provider: "google" }, select: { id: true } }),
  ]);
  return account ? (user?.email ?? null) : null;
}
