import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { checkRateLimit } from "@/lib/rateLimit";

// 1x1 transparent GIF, served unconditionally regardless of whether the
// token is real — an unauthenticated recipient-facing endpoint must never
// 404/error (a broken-image icon in someone's inbox) and must never let a
// response difference reveal whether a given token is valid.
const PIXEL = Buffer.from("R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==", "base64");

export async function GET(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  try {
    const allowed = await checkRateLimit(`track-open:${token}`, 30, 300);
    if (allowed) {
      const recipient = await prisma.campaignRecipient.findUnique({
        where: { trackingToken: token },
        select: { id: true, campaignId: true },
      });
      if (recipient) {
        await prisma.emailEvent.create({
          data: { campaignId: recipient.campaignId, recipientId: recipient.id, type: "OPEN" },
        });
      }
    }
  } catch (err) {
    console.error("[track/open] failed to record event:", err);
  }

  return new NextResponse(PIXEL, {
    status: 200,
    headers: {
      "Content-Type": "image/gif",
      "Content-Length": String(PIXEL.length),
      "Cache-Control": "no-store, no-cache, must-revalidate",
    },
  });
}
