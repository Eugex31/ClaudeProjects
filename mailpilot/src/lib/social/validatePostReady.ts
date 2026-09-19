import type { SocialAccount, SocialPost } from "@prisma/client";

// Shared by both POST /api/social/posts/[id]/schedule and .../post-now —
// the same readiness rule applies whether a post goes out now or later.
export function validatePostReady(post: SocialPost, account: SocialAccount): string | null {
  if (!post.caption.trim()) return "Add a caption before scheduling or posting.";
  if (account.platform === "INSTAGRAM_BUSINESS" && !post.mediaImageId) {
    return "Instagram posts require an image.";
  }
  return null;
}
