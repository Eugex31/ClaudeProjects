import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { auth } from "@/lib/auth";

// "/social/" (not individual filenames) covers every icon under
// public/social/ — same reasoning as "/logo.png": these are static, non-
// secret brand assets a logged-out context can legitimately need (an
// unauthenticated preview, a mail client's own image proxy fetching a raw,
// non-cid asset URL if NEXTAUTH_URL was ever unset when a template was
// seeded). Real sends don't depend on this at all (inlineAppLogo.ts reads
// these files straight off disk and ships them as inline cid: attachments),
// but there's no reason a static, public-by-nature asset should 307 to
// /login just because no session cookie happened to be present.
//
// "/mosaic-" covers the real venue photos (public/mosaic-*.jpg) embedded
// directly via <img src="..."> in HTML-format templates like the LyneSign
// Introduction one — unlike the logo, these are referenced with plain
// image tags, not inline cid: attachments, so a real recipient's mail
// client fetches them with no session at all; without this they'd 307 to
// /login for every real recipient, same failure mode as the logo/social
// case above.
const PUBLIC_PATHS = [
  "/login",
  "/register",
  "/forgot-password",
  "/reset-password",
  "/logo.png",
  "/social/",
  "/mosaic-",
];

// Matches only GET/HEAD /api/template-images/{id} — a template's uploaded
// image, fetched directly by recipients' mail clients (and some link/image
// scanners that HEAD-check before downloading) with no session. Deliberately
// NOT a blanket `startsWith("/api/template-images")` like /api/track's
// exemption: that would also strip auth/CSRF protection from the sibling
// upload route (POST /api/template-images), which must stay authenticated.
const TEMPLATE_IMAGE_ITEM_PATTERN = /^\/api\/template-images\/[^/]+$/;

export default auth((req: NextRequest & { auth: unknown }) => {
  const { pathname } = req.nextUrl;
  const isPublicTemplateImage =
    (req.method === "GET" || req.method === "HEAD") && TEMPLATE_IMAGE_ITEM_PATTERN.test(pathname);

  // Defense-in-depth CSRF check: reject cross-origin mutating requests to our
  // own API even though the session cookie is already SameSite=lax. Doesn't
  // apply to /api/webhooks or /api/track — those are called by parties with
  // no session/Origin to check (Stripe, and email clients rendering a pixel
  // or following a link), authenticated by signature or opaque token instead.
  if (
    req.method !== "GET" &&
    req.method !== "HEAD" &&
    pathname.startsWith("/api/") &&
    !pathname.startsWith("/api/auth") &&
    !pathname.startsWith("/api/webhooks") &&
    !pathname.startsWith("/api/track")
  ) {
    const origin = req.headers.get("origin");
    const expected = process.env.NEXTAUTH_URL ?? req.nextUrl.origin;
    if (origin && origin !== expected) {
      return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
    }
  }

  // /api/webhooks/* (Stripe) and /api/track/* (open pixel, click redirect)
  // are hit by parties with no session cookie at all — authenticity comes
  // from each route's own signature/token check, not a session.
  //
  // "/" (the public landing page) is checked with an EXACT match, not
  // startsWith — every path on the site "starts with /", so adding it to
  // PUBLIC_PATHS' prefix-matched list would silently disable the auth gate
  // for the entire app.
  const isPublic =
    pathname === "/" ||
    PUBLIC_PATHS.some((p) => pathname.startsWith(p)) ||
    pathname.startsWith("/api/auth") ||
    pathname.startsWith("/api/webhooks") ||
    pathname.startsWith("/api/track") ||
    isPublicTemplateImage;
  if (!req.auth && !isPublic) {
    const loginUrl = new URL("/login", req.nextUrl.origin);
    loginUrl.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
