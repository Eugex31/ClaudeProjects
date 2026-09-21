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
  socialFacebookUrl: null as string | null,
  socialInstagramUrl: null as string | null,
  socialLinkedinUrl: null as string | null,
  socialYoutubeUrl: null as string | null,
  socialXUrl: null as string | null,
  ctaDefaultLabel: null as string | null,
  ctaDefaultUrl: null as string | null,
};

export async function getEffectiveSettings(userId: string) {
  const settings = await prisma.settings.findUnique({ where: { userId } });
  return settings ?? { userId, ...DEFAULT_SETTINGS, updatedAt: new Date() };
}
