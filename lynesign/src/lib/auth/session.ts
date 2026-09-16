import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/db/root";

const THIRTY_DAYS_MS = 60 * 60 * 24 * 30 * 1000;
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

/**
 * Whether Auth.js v5 will prefix and secure its cookies. `@auth/core` decides
 * this with `config.useSecureCookies ?? url.protocol === "https:"` -- the scheme
 * of the deployment URL, not `NODE_ENV`. A credential login must key its cookie
 * off the *same* signal, or a production build served over HTTP (the e2e suite,
 * any plain-HTTP deployment) writes `__Secure-authjs.session-token` while
 * `auth()` still reads `authjs.session-token`, and every request looks signed
 * out. Real production sets `AUTH_URL=https://...`, so this stays `true` there.
 */
const useSecureCookies = (process.env.AUTH_URL ?? "").startsWith("https://");

/**
 * Cookie name Auth.js v5 uses for the database session token. No `cookies`
 * override is set in `authConfig`, so these are its unmodified defaults. A
 * credential login must write the cookie under the same name that `auth()`
 * reads: `__Secure-`-prefixed only when the deployment is served over HTTPS.
 */
export const SESSION_COOKIE = useSecureCookies
  ? "__Secure-authjs.session-token"
  : "authjs.session-token";

/**
 * Attributes for the session cookie a credential login sets, matching Auth.js's
 * own defaults for the session token. `secure` tracks the same scheme signal as
 * {@link SESSION_COOKIE}; a `__Secure-`-prefixed name with `secure: false` (or
 * the reverse) is rejected by the browser.
 */
export const sessionCookieOptions = {
  httpOnly: true,
  sameSite: "lax",
  secure: useSecureCookies,
  path: "/",
  maxAge: SESSION_MAX_AGE_SECONDS,
} as const;

/**
 * Creates a `Session` row directly for an email + password login, byte-for-byte
 * the same shape `PrismaAdapter` writes for any other sign-in, and returns the
 * opaque token. The caller is responsible for setting the `SESSION_COOKIE`
 * cookie with {@link sessionCookieOptions}: httpOnly, sameSite=lax, secure when
 * AUTH_URL uses https (not when NODE_ENV is production), `maxAge` 30 days.
 */
export async function createCredentialsSession(userId: string): Promise<string> {
  const sessionToken = randomBytes(32).toString("hex");
  await prisma.session.create({
    data: { sessionToken, userId, expires: new Date(Date.now() + THIRTY_DAYS_MS) },
  });
  return sessionToken;
}

export async function getServerAuth(): Promise<
  { user: { id: string; email: string; isSuperAdmin: boolean } } | null
> {
  // Imported lazily so this module stays loadable in a plain Node context
  // (unit tests, one-off scripts) that only needs `createCredentialsSession` or
  // `SESSION_COOKIE`; `@/lib/auth` pulls in the full Auth.js + `next/server`
  // graph, which only resolves inside the Next.js runtime.
  const { auth } = await import("@/lib/auth");
  const session = await auth();
  if (!session?.user?.id) return null;
  return {
    user: {
      id: session.user.id,
      email: session.user.email ?? "",
      isSuperAdmin: session.user.isSuperAdmin ?? false,
    },
  };
}
