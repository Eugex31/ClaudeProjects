import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { encryptToken } from "@/lib/crypto/tokenCipher";
import { exchangeCodeForToken, exchangeForLongLivedToken, MetaApiError } from "@/lib/meta/client";

const STATE_COOKIE = "meta_oauth_state";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.redirect(new URL("/login", req.nextUrl.origin));
  }

  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const expectedState = req.cookies.get(STATE_COOKIE)?.value;

  if (!code || !state || !expectedState || state !== expectedState) {
    return NextResponse.redirect(new URL("/social?error=invalid_state", req.nextUrl.origin));
  }

  try {
    const redirectUri = `${process.env.NEXTAUTH_URL}/api/social/meta/callback`;
    const shortLivedToken = await exchangeCodeForToken(code, redirectUri);
    const { accessToken, expiresInSeconds } = await exchangeForLongLivedToken(shortLivedToken);

    await prisma.metaIdentity.upsert({
      where: { userId: session.user.id },
      create: {
        userId: session.user.id,
        accessToken: encryptToken(accessToken),
        expiresAt: new Date(Date.now() + expiresInSeconds * 1000),
      },
      update: {
        accessToken: encryptToken(accessToken),
        expiresAt: new Date(Date.now() + expiresInSeconds * 1000),
      },
    });
  } catch (err) {
    console.error("[meta oauth] token exchange failed:", err instanceof MetaApiError ? err.message : err);
    return NextResponse.redirect(new URL("/social?error=connect_failed", req.nextUrl.origin));
  }

  const res = NextResponse.redirect(new URL("/social?connected=1", req.nextUrl.origin));
  res.cookies.delete(STATE_COOKIE);
  return res;
}
