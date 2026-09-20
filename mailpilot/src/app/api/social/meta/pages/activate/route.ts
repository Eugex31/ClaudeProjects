import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { withAuth } from "@/lib/apiHandler";
import { decryptToken, encryptToken } from "@/lib/crypto/tokenCipher";
import { checkSocialAccountLimit } from "@/lib/billing";
import { listPages, MetaApiError } from "@/lib/meta/client";

const activateSchema = z.object({ pageIds: z.array(z.string()).min(1) });

export const POST = withAuth(async (req, { userId }) => {
  const { pageIds } = activateSchema.parse(await req.json());

  const identity = await prisma.metaIdentity.findUnique({ where: { userId } });
  if (!identity) {
    return NextResponse.json({ error: "Not connected to Facebook" }, { status: 400 });
  }

  let pages;
  try {
    pages = await listPages(decryptToken(identity.accessToken));
  } catch (err) {
    const message = err instanceof MetaApiError ? err.message : "Failed to load Facebook Pages";
    return NextResponse.json({ error: message }, { status: 502 });
  }

  const selected = pages.filter((p) => pageIds.includes(p.pageId));
  if (selected.length === 0) {
    return NextResponse.json({ error: "None of the selected pages were found" }, { status: 400 });
  }

  // Net-new rows this request would add — pages already connected (a
  // re-activate / re-sync) don't count against the limit again.
  const existing = new Set(
    (await prisma.socialAccount.findMany({ where: { userId }, select: { externalAccountId: true } })).map(
      (a) => a.externalAccountId
    )
  );
  const netNew = selected.reduce((count, p) => {
    let n = count;
    if (!existing.has(p.pageId)) n += 1;
    if (p.instagram && !existing.has(p.instagram.id)) n += 1;
    return n;
  }, 0);

  const limitCheck = await checkSocialAccountLimit(userId, netNew);
  if (!limitCheck.allowed) {
    return NextResponse.json({ error: limitCheck.message, upgradeRequired: true }, { status: 402 });
  }

  await prisma.$transaction(
    selected.flatMap((p) => {
      const writes = [
        prisma.socialAccount.upsert({
          where: { userId_platform_externalAccountId: { userId, platform: "FACEBOOK_PAGE", externalAccountId: p.pageId } },
          create: {
            userId,
            metaIdentityId: identity.id,
            platform: "FACEBOOK_PAGE",
            externalAccountId: p.pageId,
            displayName: p.pageName,
            accessToken: encryptToken(p.pageAccessToken),
          },
          update: { displayName: p.pageName, accessToken: encryptToken(p.pageAccessToken) },
        }),
      ];
      if (p.instagram) {
        writes.push(
          prisma.socialAccount.upsert({
            where: {
              userId_platform_externalAccountId: { userId, platform: "INSTAGRAM_BUSINESS", externalAccountId: p.instagram.id },
            },
            create: {
              userId,
              metaIdentityId: identity.id,
              platform: "INSTAGRAM_BUSINESS",
              externalAccountId: p.instagram.id,
              displayName: `@${p.instagram.username}`,
              // Instagram publishing uses the linked Page's own token — Graph API issues no separate IG token.
              accessToken: encryptToken(p.pageAccessToken),
            },
            update: { displayName: `@${p.instagram.username}`, accessToken: encryptToken(p.pageAccessToken) },
          })
        );
      }
      return writes;
    })
  );

  return NextResponse.json({ success: true, activated: selected.length });
});
