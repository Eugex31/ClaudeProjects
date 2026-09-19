import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withAuth } from "@/lib/apiHandler";
import { socialPostUpdateSchema } from "@/lib/validation/social.schema";

export const GET = withAuth<{ id: string }>(async (_req, { userId, params }) => {
  const post = await prisma.socialPost.findFirst({
    where: { id: params.id, userId },
    include: { socialAccount: { select: { displayName: true, platform: true } } },
  });
  if (!post) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ post });
});

export const PATCH = withAuth<{ id: string }>(async (req, { userId, params }) => {
  const body = socialPostUpdateSchema.parse(await req.json());

  const post = await prisma.socialPost.findFirst({ where: { id: params.id, userId } });
  if (!post) return NextResponse.json({ error: "Not found" }, { status: 404 });
  // Publishing changes nothing about already-published content — same
  // reasoning as a sent campaign's body no longer being editable.
  if (post.status === "PUBLISHED" || post.status === "PUBLISHING") {
    return NextResponse.json({ error: "This post can no longer be edited" }, { status: 400 });
  }

  const updated = await prisma.socialPost.update({ where: { id: post.id }, data: body });
  return NextResponse.json({ post: updated });
});

export const DELETE = withAuth<{ id: string }>(async (_req, { userId, params }) => {
  const post = await prisma.socialPost.findFirst({ where: { id: params.id, userId } });
  if (!post) return NextResponse.json({ error: "Not found" }, { status: 404 });
  await prisma.socialPost.delete({ where: { id: post.id } });
  return NextResponse.json({ success: true });
});
