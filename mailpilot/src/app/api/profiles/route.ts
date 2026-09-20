import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { prisma } from "@/lib/prisma";
import { withRealAuth } from "@/lib/apiHandler";
import { checkProfileLimit } from "@/lib/billing";
import { getConnectedGmailAddress } from "@/lib/gmail/getGmailClient";
import { profileInputSchema } from "@/lib/validation/profile.schema";

export const GET = withRealAuth(async (_req, { userId }) => {
  const profiles = await prisma.clientProfile.findMany({
    where: { parentUserId: userId },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      label: true,
      createdAt: true,
      profileUserId: true,
      profileUser: {
        select: { _count: { select: { contacts: true, campaigns: true } } },
      },
    },
  });

  const withGmail = await Promise.all(
    profiles.map(async (p) => ({
      id: p.id,
      label: p.label,
      createdAt: p.createdAt,
      contactCount: p.profileUser._count.contacts,
      campaignCount: p.profileUser._count.campaigns,
      gmailConnected: (await getConnectedGmailAddress(p.profileUserId)) !== null,
    }))
  );

  return NextResponse.json({ profiles: withGmail });
});

export const POST = withRealAuth(async (req, { userId }) => {
  const { label } = profileInputSchema.parse(await req.json());

  const check = await checkProfileLimit(userId);
  if (!check.allowed) {
    return NextResponse.json({ error: check.message }, { status: 402 });
  }

  // No password, no Google Account — the only way into this row is the
  // parent switching into it (src/lib/activeProfile.ts). The placeholder
  // email satisfies User.email's @unique/non-null constraint until Gmail is
  // connected (POST /api/profile-gmail/connect), which overwrites it with
  // the real address.
  const profileUser = await prisma.user.create({
    data: { email: `profile-${randomBytes(12).toString("hex")}@profiles.internal`, name: label },
  });
  const profile = await prisma.clientProfile.create({
    data: { parentUserId: userId, profileUserId: profileUser.id, label },
  });

  return NextResponse.json({ profile: { id: profile.id, label: profile.label, createdAt: profile.createdAt } }, { status: 201 });
});
