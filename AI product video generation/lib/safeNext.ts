function isSafe(p: string): boolean {
  return p.startsWith("/") && !p.startsWith("//") && !p.includes("\\") && !/[\x00-\x1f\x7f]/.test(p);
}

/** Returns `next` only if it is a same-origin relative path; otherwise `fallback`. */
export function safeNext(next: string | null | undefined, fallback = "/app"): string {
  if (!next || !isSafe(next)) return fallback;
  try {
    if (!isSafe(decodeURIComponent(next))) return fallback;
  } catch {
    return fallback;
  }
  return next;
}

/** Link to another auth page that keeps a safe `next` (omitted when it is the default). */
export function authHref(path: "/login" | "/signup", next: string | null | undefined): string {
  const target = safeNext(next);
  return target === "/app" ? path : `${path}?next=${encodeURIComponent(target)}`;
}
