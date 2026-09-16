import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { checkRateLimit } from "@/lib/rateLimit";

// Only http(s) destinations are ever accepted. This endpoint is public and
// unauthenticated by necessity (it's reached from inside an email, with no
// session) — without this check it would be an open redirector off this
// app's own domain, a real phishing vector, not a theoretical one.
function parseSafeDestination(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const destination = parseSafeDestination(req.nextUrl.searchParams.get("u"));
  if (!destination) {
    return NextResponse.json({ error: "Invalid or missing destination URL" }, { status: 400 });
  }

  try {
    const allowed = await checkRateLimit(`track-click:${token}`, 30, 300);
    if (allowed) {
      const recipient = await prisma.campaignRecipient.findUnique({
        where: { trackingToken: token },
        select: { id: true, campaignId: true },
      });
      if (recipient) {
        await prisma.emailEvent.create({
          data: { campaignId: recipient.campaignId, recipientId: recipient.id, type: "CLICK", url: destination },
        });
      }
    }
  } catch (err) {
    console.error("[track/click] failed to record event:", err);
  }

  // A bogus/expired token still redirects — the token only identifies who
  // clicked for reporting purposes, it isn't an authorization check on the
  // destination, so a lookup miss must never strand the recipient.
  return NextResponse.redirect(destination, { status: 302 });
}
