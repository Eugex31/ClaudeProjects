import { prisma } from "@/lib/prisma";
import { decryptToken } from "@/lib/crypto/tokenCipher";
import { publishToPage, publishToInstagram, MetaApiError } from "@/lib/meta/client";

// The one function both the scheduled worker poll (src/worker/poller.ts)
// and the manual "Post now" route call — same "factor the real work out so
// both the poller and a manual trigger share it" shape as
// spawnNewsletterCampaign/sendEnrollmentStep. Never throws: every outcome
// (success or failure) is written to the row itself, since a worker crash
// mid-call must not leave a post silently stuck with no record of what
// happened — the stale-lock reap in poller.ts handles the crash case, this
// handles the "the call completed, one way or the other" case.
export async function publishSocialPost(postId: string): Promise<void> {
  const post = await prisma.socialPost.findUniqueOrThrow({
    where: { id: postId },
    include: { socialAccount: true },
  });

  const imageUrl = post.mediaImageId
    ? `${process.env.NEXTAUTH_URL}/api/template-images/${post.mediaImageId}`
    : undefined;

  if (post.socialAccount.platform === "INSTAGRAM_BUSINESS" && !imageUrl) {
    await prisma.socialPost.update({
      where: { id: post.id },
      data: { status: "FAILED", errorMessage: "Instagram posts require an image.", lockedAt: null },
    });
    return;
  }

  const accessToken = decryptToken(post.socialAccount.accessToken);

  try {
    const externalPostId =
      post.socialAccount.platform === "FACEBOOK_PAGE"
        ? await publishToPage(accessToken, post.socialAccount.externalAccountId, { message: post.caption, imageUrl })
        : await publishToInstagram(accessToken, post.socialAccount.externalAccountId, { caption: post.caption, imageUrl: imageUrl! });

    await prisma.socialPost.update({
      where: { id: post.id },
      data: { status: "PUBLISHED", publishedAt: new Date(), externalPostId, lockedAt: null },
    });
  } catch (err) {
    const message = err instanceof MetaApiError ? err.message : "Failed to publish";
    await prisma.socialPost.update({
      where: { id: post.id },
      data: { status: "FAILED", errorMessage: message, lockedAt: null },
    });
  }
}
