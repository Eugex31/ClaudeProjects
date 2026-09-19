import { NextResponse } from "next/server";
import { SocialPostStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { withAuth } from "@/lib/apiHandler";
import { socialPostInputSchema } from "@/lib/validation/social.schema";

export const GET = withAuth(async (req, { userId }) => {
  const statusParam = req.nextUrl.searchParams.get("status");
  const status = statusParam && statusParam in SocialPostStatus ? (statusParam as SocialPostStatus) : undefined;
  const posts = await prisma.socialPost.findMany({
    where: { userId, ...(status ? { status } : {}) },
    include: { socialAccount: { select: { displayName: true, platform: true } } },
    orderBy: { updatedAt: "desc" },
  });
  return NextResponse.json({ posts });
});

export const POST = withAuth(async (req, { userId }) => {
  const body = socialPostInputSchema.parse(await req.json());

  const account = await prisma.socialAccount.findFirst({ where: { id: body.socialAccountId, userId } });
  if (!account) {
    return NextResponse.json({ error: "Social account not found" }, { status: 404 });
  }

  const post = await prisma.socialPost.create({ data: { ...body, userId } });
  return NextResponse.json({ post }, { status: 201 });
});
