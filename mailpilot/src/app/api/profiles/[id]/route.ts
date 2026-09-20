import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withRealAuth } from "@/lib/apiHandler";
import { ACTIVE_PROFILE_COOKIE } from "@/lib/activeProfile";
import { profileInputSchema } from "@/lib/validation/profile.schema";

export const PATCH = withRealAuth<{ id: string }>(async (req, { userId, params }) => {
  const existing = await prisma.clientProfile.findFirst({ where: { id: params.id, parentUserId: userId } });
  if (!existing) {
    return NextResponse.json({ error: "Profile not found" }, { status: 404 });
  }

  const { label } = profileInputSchema.parse(await req.json());
  const profile = await prisma.clientProfile.update({ where: { id: params.id }, data: { label } });
  return NextResponse.json({ profile: { id: profile.id, label: profile.label, createdAt: profile.createdAt } });
});

export const DELETE = withRealAuth<{ id: string }>(async (req, { userId, params }) => {
  const existing = await prisma.clientProfile.findFirst({ where: { id: params.id, parentUserId: userId } });
  if (!existing) {
    return NextResponse.json({ error: "Profile not found" }, { status: 404 });
  }

  // Deletes the profile's own User row, which cascades every table it owns
  // (Contact, Campaign, Template, Sequence, Settings, ...) — the same
  // onDelete: Cascade already proven for real customer deletion in the admin
  // console. The ClientProfile join row disappears with it automatically.
  await prisma.user.delete({ where: { id: existing.profileUserId } });

  const res = NextResponse.json({ ok: true });
  const wasActive = req.cookies.get(ACTIVE_PROFILE_COOKIE)?.value === params.id;
  if (wasActive) {
    res.cookies.delete(ACTIVE_PROFILE_COOKIE);
  }
  return res;
});
