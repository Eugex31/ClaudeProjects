import { randomBytes } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { forgotPasswordSchema } from "@/lib/validation/auth.schema";
import { checkRateLimit } from "@/lib/rateLimit";
import { sendSystemEmail } from "@/lib/email/sendSystemEmail";

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

function clientIp(req: NextRequest): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
}

export async function POST(req: NextRequest) {
  const { email } = forgotPasswordSchema.parse(await req.json());

  const allowed = await Promise.all([
    checkRateLimit(`forgot-password:${clientIp(req)}`, 10, 3600),
    checkRateLimit(`forgot-password:${email}`, 3, 3600),
  ]);
  // Always return the same response either way — the rate-limit check must
  // not itself become a way to probe which emails are registered.
  if (allowed.every((ok) => ok)) {
    const user = await prisma.user.findUnique({ where: { email } });
    if (user?.passwordHash) {
      const token = randomBytes(32).toString("hex");
      await prisma.verificationToken.create({
        data: { identifier: email, token, expires: new Date(Date.now() + RESET_TOKEN_TTL_MS) },
      });
      const resetUrl = `${process.env.NEXTAUTH_URL}/reset-password?token=${token}`;
      await sendSystemEmail({
        to: email,
        subject: "Reset your Email Marketing password",
        html: `<p>Click below to reset your password. This link expires in 1 hour.</p><p><a href="${resetUrl}">${resetUrl}</a></p><p>If you didn't request this, you can ignore this email.</p>`,
        text: `Reset your password: ${resetUrl}\n\nThis link expires in 1 hour. If you didn't request this, you can ignore this email.`,
      });
    } else if (user) {
      await sendSystemEmail({
        to: email,
        subject: "About your Email Marketing account",
        html: `<p>This account signs in with Google, so there's no password to reset. Use "Continue with Google" on the sign-in page.</p>`,
        text: `This account signs in with Google, so there's no password to reset. Use "Continue with Google" on the sign-in page.`,
      });
    }
  }

  return NextResponse.json({
    ok: true,
    message: "If an account exists for that email, we've sent instructions.",
  });
}
