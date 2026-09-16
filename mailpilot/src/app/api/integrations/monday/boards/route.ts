import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withAuth } from "@/lib/apiHandler";
import { decryptToken } from "@/lib/crypto/tokenCipher";
import { listBoards, MondayApiError } from "@/lib/monday/client";

export const GET = withAuth(async (_req, { userId }) => {
  const integration = await prisma.mondayIntegration.findUnique({ where: { userId } });
  if (!integration) {
    return NextResponse.json({ error: "Connect Monday.com first" }, { status: 404 });
  }

  try {
    const boards = await listBoards(decryptToken(integration.accessToken));
    return NextResponse.json({ boards });
  } catch (err) {
    console.error("[monday] failed to list boards:", err);
    const message = err instanceof MondayApiError ? err.message : "Failed to fetch boards from Monday.com";
    return NextResponse.json({ error: message }, { status: 502 });
  }
});
