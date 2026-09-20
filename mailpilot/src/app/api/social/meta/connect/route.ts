import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { auth } from "@/lib/auth";

const STATE_COOKIE = "meta_oauth_state";

// Connect-while-logged-in, not a sign-in flow — same reasoning as Monday's
// connect route (src/app/api/integrations/monday/connect/route.ts): Meta
// isn't an identity source for this app, the session already says who's
// connecting, `state` here is pure CSRF protection.
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const appId = process.env.FACEBOOK_APP_ID;
  if (!appId) {
    return NextResponse.json({ error: "Facebook/Instagram integration isn't configured" }, { status: 503 });
  }

  const state = randomBytes(24).toString("base64url");
  const redirectUri = `${process.env.NEXTAUTH_URL}/api/social/meta/callback`;
  const authorizeUrl = new URL("https://www.facebook.com/v21.0/dialog/oauth");
  authorizeUrl.searchParams.set("client_id", appId);
  authorizeUrl.searchParams.set("redirect_uri", redirectUri);
  authorizeUrl.searchParams.set("state", state);
  authorizeUrl.searchParams.set(
    "scope",
    "pages_show_list,pages_manage_posts,pages_read_engagement,instagram_basic,instagram_content_publish"
  );

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
