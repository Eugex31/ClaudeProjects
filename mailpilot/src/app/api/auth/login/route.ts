import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { loginSchema } from "@/lib/validation/auth.schema";
import { verifyPassword, createUserSession, sessionCookieOptions } from "@/lib/passwordAuth";
import { checkRateLimit } from "@/lib/rateLimit";

function clientIp(req: NextRequest): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
}

export async function POST(req: NextRequest) {
  const { email, password } = loginSchema.parse(await req.json());

  const allowed = await Promise.all([
    checkRateLimit(`login:${clientIp(req)}`, 20, 900),
    checkRateLimit(`login:${email}`, 8, 900),
  ]);
  if (allowed.some((ok) => !ok)) {
    return NextResponse.json({ error: "Too many attempts. Try again later." }, { status: 429 });
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user?.passwordHash) {
    // Covers both "no such user" and "this account only has Google sign-in" —
    // same generic message either way to avoid confirming which is true.
    return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
  }
  if (user.status === "SUSPENDED") {
    return NextResponse.json({ error: "This account has been suspended" }, { status: 403 });
  }

  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) {
    return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
  }

  const [{ token, expires }] = await Promise.all([
    createUserSession(user.id),
    prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } }),
  ]);
  const res = NextResponse.json({ ok: true });
  const { name: cookieName, ...options } = sessionCookieOptions(expires);
  res.cookies.set(cookieName, token, options);
  return res;
}
