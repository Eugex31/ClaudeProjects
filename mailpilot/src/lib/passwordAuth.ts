import { randomBytes } from "crypto";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";

const BCRYPT_ROUNDS = 12;
const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60; // 30 days, matches Auth.js's database-session default

// Must match the cookie name Auth.js v5 issues for database sessions (no
// `cookies` override is configured in src/lib/auth.ts, so these are its
// unmodified defaults) — password-based sessions need to be readable by the
// same `auth()` calls that read Google-login sessions.
export const SESSION_COOKIE_NAME =
  process.env.NODE_ENV === "production" ? "__Secure-authjs.session-token" : "authjs.session-token";

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

export function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

// Creates a Session row exactly like Auth.js's PrismaAdapter does for a
// Google sign-in, so the rest of the app (auth(), withAuth(), admin session
// revocation) can't tell the difference between a Google-login session and a
// password-login session.
export async function createUserSession(userId: string): Promise<{ token: string; expires: Date }> {
  const token = randomBytes(32).toString("hex");
  const expires = new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000);
  await prisma.session.create({ data: { sessionToken: token, userId, expires } });
  return { token, expires };
}

export function sessionCookieOptions(expires: Date) {
  return {
    name: SESSION_COOKIE_NAME,
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires,
  };
}
