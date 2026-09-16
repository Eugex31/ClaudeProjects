import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { encryptToken } from "@/lib/crypto/tokenCipher";
import { exchangeCodeForToken, MondayApiError } from "@/lib/monday/client";

const STATE_COOKIE = "monday_oauth_state";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.redirect(new URL("/login", req.nextUrl.origin));
  }

  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const expectedState = req.cookies.get(STATE_COOKIE)?.value;

  if (!code || !state || !expectedState || state !== expectedState) {
    return NextResponse.redirect(new URL("/integrations?error=invalid_state", req.nextUrl.origin));
  }

  try {
    const redirectUri = `${process.env.NEXTAUTH_URL}/api/integrations/monday/callback`;
    const accessToken = await exchangeCodeForToken(code, redirectUri);

    await prisma.mondayIntegration.upsert({
      where: { userId: session.user.id },
      create: { userId: session.user.id, accessToken: encryptToken(accessToken) },
      // Reconnecting after a disconnect starts fresh — previous board/mapping
      // config (if somehow still present) shouldn't silently resume.
      update: {
        accessToken: encryptToken(accessToken),
        boardId: null,
        boardName: null,
        columnMapping: Prisma.JsonNull,
        syncEnabled: true,
      },
    });
  } catch (err) {
    console.error("[monday oauth] token exchange failed:", err instanceof MondayApiError ? err.message : err);
    return NextResponse.redirect(new URL("/integrations?error=connect_failed", req.nextUrl.origin));
  }

  const res = NextResponse.redirect(new URL("/integrations?connected=1", req.nextUrl.origin));
  res.cookies.delete(STATE_COOKIE);
  return res;
}
