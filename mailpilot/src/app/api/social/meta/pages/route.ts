import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withAuth } from "@/lib/apiHandler";
import { decryptToken } from "@/lib/crypto/tokenCipher";
import { listPages, MetaApiError } from "@/lib/meta/client";

// Page/IG access tokens never leave this route — only display data is
// returned. POST .../activate re-fetches fresh tokens server-side for
// whichever pages are actually selected, rather than trusting anything the
// client sends back.
export const GET = withAuth(async (_req, { userId }) => {
  const identity = await prisma.metaIdentity.findUnique({ where: { userId } });
  if (!identity) {
    return NextResponse.json({ error: "Not connected to Facebook" }, { status: 400 });
  }

  const alreadyConnected = new Set(
    (await prisma.socialAccount.findMany({ where: { userId }, select: { externalAccountId: true } })).map(
      (a) => a.externalAccountId
    )
  );

  try {
    const pages = await listPages(decryptToken(identity.accessToken));
    return NextResponse.json({
      pages: pages.map((p) => ({
        pageId: p.pageId,
        pageName: p.pageName,
        alreadyConnected: alreadyConnected.has(p.pageId),
        instagram: p.instagram
          ? { id: p.instagram.id, username: p.instagram.username, alreadyConnected: alreadyConnected.has(p.instagram.id) }
          : null,
      })),
    });
  } catch (err) {
    const message = err instanceof MetaApiError ? err.message : "Failed to load Facebook Pages";
    return NextResponse.json({ error: message }, { status: 502 });
  }
});
