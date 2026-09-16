import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withAuth } from "@/lib/apiHandler";
import { decryptToken } from "@/lib/crypto/tokenCipher";
import { listColumns, MondayApiError } from "@/lib/monday/client";

export const GET = withAuth<{ boardId: string }>(async (_req, { userId, params }) => {
  const integration = await prisma.mondayIntegration.findUnique({ where: { userId } });
  if (!integration) {
    return NextResponse.json({ error: "Connect Monday.com first" }, { status: 404 });
  }

  try {
    const columns = await listColumns(decryptToken(integration.accessToken), params.boardId);
    return NextResponse.json({ columns });
  } catch (err) {
    console.error("[monday] failed to list columns:", err);
    const message = err instanceof MondayApiError ? err.message : "Failed to fetch columns from Monday.com";
    return NextResponse.json({ error: message }, { status: 502 });
  }
});
