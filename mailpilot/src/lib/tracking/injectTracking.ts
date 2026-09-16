import { appendBeforeBodyClose } from "@/lib/personalization/htmlDocument";

// A tracked link/pixel is only useful if `baseUrl` is somewhere a real
// recipient's mail client can actually reach. "localhost" (or an
// equivalent loopback address) always resolves to the recipient's own
// device, never back to wherever the app is actually running — rewriting
// links through it wouldn't track anything, it would just replace every
// real destination with one nobody but this machine can open. Real
// customer complaint that motivated this check: NEXTAUTH_URL left at its
// http://localhost:3000 dev default meant every link in every sent
// campaign silently broke for every recipient. Skipping the rewrite here
// degrades to "no click/open tracking yet" (this app's own pre-tracking
// behavior), which is far better than "every link in every email is
// broken" for a send made before the app has a real public domain.
function isPubliclyReachable(baseUrl: string): boolean {
  try {
    const { hostname } = new URL(baseUrl);
    return !["localhost", "127.0.0.1", "::1", "0.0.0.0"].includes(hostname);
  } catch {
    return false;
  }
}

// Rewrites every http(s) link in a composed email's HTML to route through the
// click-tracking redirector, and appends an invisible open-tracking pixel.
// Deliberately takes only primitives (no Prisma types) so it stays a pure,
// easily-testable function — the caller is responsible for knowing this is a
// real tracked send (only sendRecipient calls this; preview/test-send never do,
// since neither has a real CampaignRecipient to attach events to).
export function injectTracking(html: string, trackingToken: string, baseUrl: string): string {
  if (!isPubliclyReachable(baseUrl)) return html;
  const rewritten = html.replace(/<a\s+([^>]*?)href="(https?:\/\/[^"]+)"/gi, (_match, attrs: string, href: string) => {
    const trackedUrl = `${baseUrl}/api/track/click/${trackingToken}?u=${encodeURIComponent(href)}`;
    return `<a ${attrs}href="${trackedUrl}"`;
  });

  const pixel = `<img src="${baseUrl}/api/track/open/${trackingToken}" width="1" height="1" alt="" style="display:none" />`;
  // Full HTML-format documents have a real </body> — insert before it rather
  // than appending after the closing tags. Fragments (RICH_TEXT) have no
  // </body>, so this is a plain append, same as before.
  return appendBeforeBodyClose(rewritten, pixel);
}
