/**
 * Validate a URL string for use as WEB media: it must be http or https, carry no
 * embedded credentials, and not point at a private, loopback or link-local
 * address. The last check is a coarse SSRF guard: the preview iframe renders it
 * in the viewer's browser, and a private target would let a signed-in user's
 * session reach an internal host.
 */
export function validateWebUrl(
  raw: string
): { ok: true; url: string } | { ok: false; error: string } {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, error: "Enter a valid URL." };
  }

  if (!["http:", "https:"].includes(url.protocol)) {
    return { ok: false, error: "Only http and https URLs are allowed." };
  }

  if (url.username || url.password) {
    return { ok: false, error: "URLs with embedded credentials are not allowed." };
  }

  if (isPrivateHost(url.hostname)) {
    return { ok: false, error: "That URL points to a private address." };
  }

  return { ok: true, url: url.toString() };
}

/**
 * True for a hostname that resolves to something not routable on the public
 * internet: localhost, an IPv4 loopback / private / link-local range, or the
 * IPv6 loopback / unspecified address.
 */
function isPrivateHost(hostnameRaw: string): boolean {
  const hostname = hostnameRaw.replace(/^\[|\]$/g, "").toLowerCase();

  if (hostname === "localhost" || hostname.endsWith(".localhost")) return true;
  if (hostname === "::1" || hostname === "::") return true;

  const v4 = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!v4) return false;

  const [a, b] = v4.slice(1).map(Number);
  if ([a, b].some((n) => n > 255)) return false;

  if (a === 0) return true; // 0.0.0.0/8
  if (a === 127) return true; // 127.0.0.0/8 loopback
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local

  return false;
}
