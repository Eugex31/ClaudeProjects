import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withAuth } from "@/lib/apiHandler";
import { scheduleSocialPostSchema } from "@/lib/validation/social.schema";
import { validatePostReady } from "@/lib/social/validatePostReady";

export const POST = withAuth<{ id: string }>(async (req, { userId, params }) => {
  const { scheduledAt } = scheduleSocialPostSchema.parse(await req.json());

  const post = await prisma.socialPost.findFirst({
    where: { id: params.id, userId },
    include: { socialAccount: true },
  });
  if (!post) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (post.status !== "DRAFT" && post.status !== "SCHEDULED") {
    return NextResponse.json({ error: "This post can no longer be scheduled" }, { status: 400 });
  }

  const validationError = validatePostReady(post, post.socialAccount);
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 });
  }

  const updated = await prisma.socialPost.update({
    where: { id: post.id },
    data: { status: "SCHEDULED", scheduledAt },
  });
  return NextResponse.json({ post: updated });
});
