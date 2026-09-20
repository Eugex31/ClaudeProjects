import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withRealAuth } from "@/lib/apiHandler";
import { ACTIVE_PROFILE_COOKIE } from "@/lib/activeProfile";

export const POST = withRealAuth<{ id: string }>(async (_req, { userId, params }) => {
  const profile = await prisma.clientProfile.findFirst({ where: { id: params.id, parentUserId: userId } });
  if (!profile) {
    return NextResponse.json({ error: "Profile not found" }, { status: 404 });
  }

  const res = NextResponse.json({ ok: true, profile: { id: profile.id, label: profile.label } });
  res.cookies.set(ACTIVE_PROFILE_COOKIE, profile.id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
  });
  return res;
});
