import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { google } from "googleapis";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { encryptToken } from "@/lib/crypto/tokenCipher";
import { resolveEffectiveUserId } from "@/lib/activeProfile";

const STATE_COOKIE = "profile_gmail_oauth_state";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.redirect(new URL("/login", req.nextUrl.origin));
  }
  // Re-resolved here (not carried from the connect route) so the write below
  // always targets whichever profile is active right now.
  const { activeProfile } = await resolveEffectiveUserId(session.user.id);
  if (!activeProfile) {
    return NextResponse.redirect(new URL("/settings", req.nextUrl.origin));
  }
  const profileUserId = (
    await prisma.clientProfile.findUniqueOrThrow({ where: { id: activeProfile.id }, select: { profileUserId: true } })
  ).profileUserId;

  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const expectedState = req.cookies.get(STATE_COOKIE)?.value;

  if (!code || !state || !expectedState || state !== expectedState) {
    return NextResponse.redirect(new URL("/settings?error=invalid_state", req.nextUrl.origin));
  }

  try {
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      `${process.env.NEXTAUTH_URL}/api/profile-gmail/callback`
    );
    const { tokens } = await oauth2Client.getToken(code);
    if (!tokens.access_token || !tokens.refresh_token) {
      throw new Error("Google did not return a refresh token — reconnect and approve offline access");
    }
    oauth2Client.setCredentials(tokens);

    const { data: googleProfile } = await google.oauth2("v2").userinfo.get({ auth: oauth2Client });
    if (!googleProfile.id || !googleProfile.email) {
      throw new Error("Google did not return account details");
    }

    // The Gmail address a profile connects becomes its identity (Settings'
    // "Sending email" is derived from User.email — see the comment on
    // getConnectedGmailAddress). Reject rather than silently reassign if
    // that email already belongs to a different real account or profile.
    const existingOwner = await prisma.user.findUnique({ where: { email: googleProfile.email }, select: { id: true } });
    if (existingOwner && existingOwner.id !== profileUserId) {
      return NextResponse.redirect(new URL("/settings?error=email_in_use", req.nextUrl.origin));
    }

    await prisma.$transaction([
      prisma.user.update({ where: { id: profileUserId }, data: { email: googleProfile.email } }),
      prisma.account.upsert({
        where: { provider_providerAccountId: { provider: "google", providerAccountId: googleProfile.id } },
        create: {
          userId: profileUserId,
          type: "oauth",
          provider: "google",
          providerAccountId: googleProfile.id,
          access_token: encryptToken(tokens.access_token),
          refresh_token: encryptToken(tokens.refresh_token),
          expires_at: tokens.expiry_date ? Math.floor(tokens.expiry_date / 1000) : null,
          token_type: tokens.token_type ?? null,
          scope: tokens.scope ?? null,
        },
        update: {
          userId: profileUserId,
          access_token: encryptToken(tokens.access_token),
          refresh_token: encryptToken(tokens.refresh_token),
          expires_at: tokens.expiry_date ? Math.floor(tokens.expiry_date / 1000) : null,
          token_type: tokens.token_type ?? null,
          scope: tokens.scope ?? null,
        },
      }),
    ]);
  } catch (err) {
    console.error("[profile-gmail oauth] token exchange failed:", err);
    return NextResponse.redirect(new URL("/settings?error=connect_failed", req.nextUrl.origin));
  }

  const res = NextResponse.redirect(new URL("/settings?connected=1", req.nextUrl.origin));
  res.cookies.delete(STATE_COOKIE);
  return res;
}
