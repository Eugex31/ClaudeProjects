import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withAuth } from "@/lib/apiHandler";
import { checkRateLimit } from "@/lib/rateLimit";
import { validatePostReady } from "@/lib/social/validatePostReady";
import { publishSocialPost } from "@/worker/publishSocialPost";

export const POST = withAuth<{ id: string }>(async (_req, { userId, params }) => {
  // A real external side effect — capped against accidental repeat-clicking,
  // not a security boundary. Same shape as test-send/Monday's sync-now.
  const allowed = await checkRateLimit(`social-post-now:${userId}`, 10, 3600);
  if (!allowed) {
    return NextResponse.json({ error: "Too many posts recently. Try again later." }, { status: 429 });
  }

  const post = await prisma.socialPost.findFirst({
    where: { id: params.id, userId },
    include: { socialAccount: true },
  });
  if (!post) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (post.status !== "DRAFT" && post.status !== "SCHEDULED" && post.status !== "FAILED") {
    return NextResponse.json({ error: "This post can no longer be posted" }, { status: 400 });
  }

  const validationError = validatePostReady(post, post.socialAccount);
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 });
  }

  await prisma.socialPost.update({ where: { id: post.id }, data: { status: "PUBLISHING", lockedAt: new Date() } });
  await publishSocialPost(post.id);

  const updated = await prisma.socialPost.findUniqueOrThrow({ where: { id: post.id } });
  return NextResponse.json({ post: updated });
});
