import { prisma } from "@/lib/prisma";

export const DEFAULT_SETTINGS = {
  businessName: null as string | null,
  dailySendLimit: 400,
  delayMinSeconds: 30,
  delayMaxSeconds: 120,
  senderName: null as string | null,
  replyTo: null as string | null,
  signatureHtml: null as string | null,
  signatureLogo: null as Buffer | null,
  signatureLogoContentType: null as string | null,
  signatureLogoFilename: null as string | null,
  unsubscribeFooterText: null as string | null,
  timezone: "UTC",
};

export async function getEffectiveSettings(userId: string) {
  const settings = await prisma.settings.findUnique({ where: { userId } });
  return settings ?? { userId, ...DEFAULT_SETTINGS, updatedAt: new Date() };
}
