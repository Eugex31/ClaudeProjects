import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withAuth } from "@/lib/apiHandler";
import { getEffectiveSettings } from "@/lib/settings";
import { settingsUpdateSchema } from "@/lib/validation/settings.schema";
import { getConnectedGmailAddress } from "@/lib/gmail/getGmailClient";

export const GET = withAuth(async (_req, { userId }) => {
  const [settings, user, connectedGmailAddress] = await Promise.all([
    getEffectiveSettings(userId),
    prisma.user.findUnique({ where: { id: userId }, select: { passwordHash: true } }),
    getConnectedGmailAddress(userId),
  ]);
  // Never ship the raw logo bytes down as JSON — the UI only needs to know
  // whether one is set; the actual image is fetched via its own endpoint.
  const { signatureLogo, ...rest } = settings;
  return NextResponse.json({
    settings: {
      ...rest,
      hasSignatureLogo: !!signatureLogo,
      hasPassword: !!user?.passwordHash,
      connectedGmailAddress,
    },
  });
});

export const PATCH = withAuth(async (req, { userId }) => {
  const body = settingsUpdateSchema.parse(await req.json());

  const settings = await prisma.settings.upsert({
    where: { userId },
    create: { userId, ...body },
    update: body,
  });

  const { signatureLogo, ...rest } = settings;
  return NextResponse.json({ settings: { ...rest, hasSignatureLogo: !!signatureLogo } });
});
