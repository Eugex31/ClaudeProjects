import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { auth, GMAIL_SCOPE } from "@/lib/auth";
import { resolveEffectiveUserId } from "@/lib/activeProfile";

const STATE_COOKIE = "profile_gmail_oauth_state";

// A managed client profile (src/lib/activeProfile.ts) has no Auth.js session
// of its own, so it can't go through signIn("google") — that flow always
// ends by making the browser's real session become whoever the Google
// account belongs to, which would sign the agency out of their own account.
// This route does the same OAuth dance by hand instead (matching the
// existing Meta/Monday connect routes), and only ever fires while a profile
// is actively switched into — real accounts keep using the normal
// "Connect Gmail" button in settings-form.tsx.
export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { activeProfile } = await resolveEffectiveUserId(session.user.id);
  const origin = new URL(req.url).origin;
  if (!activeProfile) {
    return NextResponse.redirect(new URL("/settings", origin));
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) {
    return NextResponse.json({ error: "Google integration isn't configured" }, { status: 503 });
  }

  const state = randomBytes(24).toString("base64url");
  const redirectUri = `${process.env.NEXTAUTH_URL}/api/profile-gmail/callback`;
  const authorizeUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authorizeUrl.searchParams.set("client_id", clientId);
  authorizeUrl.searchParams.set("redirect_uri", redirectUri);
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("scope", GMAIL_SCOPE);
  authorizeUrl.searchParams.set("access_type", "offline");
  authorizeUrl.searchParams.set("prompt", "consent");
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
