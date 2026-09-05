import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { decryptToken } from "@/lib/crypto/tokenCipher";

export async function POST() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [account, user] = await Promise.all([
    prisma.account.findFirst({ where: { userId: session.user.id, provider: "google" } }),
    prisma.user.findUnique({ where: { id: session.user.id }, select: { passwordHash: true } }),
  ]);

  if (account) {
    const tokenToRevoke = account.refresh_token ?? account.access_token;
    if (tokenToRevoke) {
      try {
        const plaintext = decryptToken(tokenToRevoke);
        await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(plaintext)}`, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
        });
      } catch {
        // Revocation is best-effort; still proceed to remove local records.
      }
    }
    await prisma.account.delete({ where: { id: account.id } });
  }

  // Google was this account's only way to authenticate — losing it means
  // losing the ability to prove identity, so the session has to go too.
  // A password-account customer keeps their session; they just lose sending
  // capability until they reconnect Gmail.
  const signedOut = !user?.passwordHash;
  if (signedOut) {
    await prisma.session.deleteMany({ where: { userId: session.user.id } });
  }

  return NextResponse.json({ ok: true, signedOut });
}
