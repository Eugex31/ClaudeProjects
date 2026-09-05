import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { auth } from "@/lib/auth";
import { requireCrmEnabled } from "@/lib/billing";

const STATE_COOKIE = "monday_oauth_state";

// Connect-while-logged-in, not a sign-in flow — deliberately not a NextAuth
// provider (same reasoning as password auth in Phase 1: Monday isn't an
// identity source for this app). The session already tells us who's
// connecting; `state` here is pure CSRF protection.
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const gate = await requireCrmEnabled(session.user.id);
  if (!gate.allowed) {
    return NextResponse.json({ error: gate.message }, { status: 402 });
  }

  const clientId = process.env.MONDAY_CLIENT_ID;
  if (!clientId) {
    return NextResponse.json({ error: "Monday.com integration isn't configured" }, { status: 503 });
  }

  const state = randomBytes(24).toString("base64url");
  const redirectUri = `${process.env.NEXTAUTH_URL}/api/integrations/monday/callback`;
  const authorizeUrl = new URL("https://auth.monday.com/oauth2/authorize");
  authorizeUrl.searchParams.set("client_id", clientId);
  authorizeUrl.searchParams.set("redirect_uri", redirectUri);
  authorizeUrl.searchParams.set("state", state);

  const res = NextResponse.redirect(authorizeUrl);
  res.cookies.set(STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 600,
    path: "/",
  });
  return res;
}
