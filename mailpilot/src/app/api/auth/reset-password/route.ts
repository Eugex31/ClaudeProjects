import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resetPasswordSchema } from "@/lib/validation/auth.schema";
import { hashPassword } from "@/lib/passwordAuth";

export async function POST(req: NextRequest) {
  const { token, password } = resetPasswordSchema.parse(await req.json());

  const record = await prisma.verificationToken.findUnique({ where: { token } });
  if (!record || record.expires < new Date()) {
    return NextResponse.json({ error: "This reset link is invalid or has expired" }, { status: 400 });
  }

  const user = await prisma.user.findUnique({ where: { email: record.identifier } });
  if (!user) {
    return NextResponse.json({ error: "This reset link is invalid or has expired" }, { status: 400 });
  }

  const passwordHash = await hashPassword(password);
  await prisma.$transaction([
    prisma.user.update({ where: { id: user.id }, data: { passwordHash } }),
    // A password reset should kill any sessions issued before it, on any device.
    prisma.session.deleteMany({ where: { userId: user.id } }),
    prisma.verificationToken.delete({ where: { token } }),
  ]);

  return NextResponse.json({ ok: true });
}
