import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { registerSchema } from "@/lib/validation/auth.schema";
import { hashPassword, createUserSession, sessionCookieOptions } from "@/lib/passwordAuth";
import { checkRateLimit } from "@/lib/rateLimit";

function clientIp(req: NextRequest): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
}

export async function POST(req: NextRequest) {
  const allowed = await checkRateLimit(`register:${clientIp(req)}`, 10, 3600);
  if (!allowed) {
    return NextResponse.json({ error: "Too many attempts. Try again later." }, { status: 429 });
  }

  const { name, email, password } = registerSchema.parse(await req.json());

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    // Same message whether or not the account exists via Google — avoids
    // leaking which emails are registered.
    return NextResponse.json(
      { error: "An account with this email already exists. Try signing in instead." },
      { status: 409 }
    );
  }

  const passwordHash = await hashPassword(password);
  const user = await prisma.user.create({ data: { name, email, passwordHash } });

  const { token, expires } = await createUserSession(user.id);
  const res = NextResponse.json({ ok: true });
  const { name: cookieName, ...options } = sessionCookieOptions(expires);
  res.cookies.set(cookieName, token, options);
  return res;
}
