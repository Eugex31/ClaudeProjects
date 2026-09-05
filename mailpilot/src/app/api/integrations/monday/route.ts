import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withAuth } from "@/lib/apiHandler";
import { mondayMappingSchema } from "@/lib/validation/monday.schema";

export const GET = withAuth(async (_req, { userId }) => {
  const integration = await prisma.mondayIntegration.findUnique({ where: { userId } });
  if (!integration) {
    return NextResponse.json({ connected: false });
  }
  return NextResponse.json({
    connected: true,
    boardId: integration.boardId,
    boardName: integration.boardName,
    columnMapping: integration.columnMapping,
    syncEnabled: integration.syncEnabled,
    lastSyncedAt: integration.lastSyncedAt,
  });
});

export const PUT = withAuth(async (req, { userId }) => {
  const existing = await prisma.mondayIntegration.findUnique({ where: { userId } });
  if (!existing) {
    return NextResponse.json({ error: "Connect Monday.com first" }, { status: 404 });
  }

  const { boardId, boardName, columnMapping } = mondayMappingSchema.parse(await req.json());

  // Switching to a different board invalidates every remembered item id
  // (those items belong to the old board) — reset them so the next sync
  // creates fresh items rather than trying to update items on the wrong
  // board. Remapping columns on the *same* board keeps existing item ids;
  // only the column values need to resync.
  const boardChanged = existing.boardId !== boardId;

  await prisma.$transaction([
    prisma.mondayIntegration.update({
      where: { userId },
      data: { boardId, boardName, columnMapping, syncEnabled: true },
    }),
    prisma.contact.updateMany({
      where: { userId },
      data: { mondayDirty: true, ...(boardChanged ? { mondayItemId: null } : {}) },
    }),
  ]);

  return NextResponse.json({ ok: true });
});

export const DELETE = withAuth(async (_req, { userId }) => {
  await prisma.mondayIntegration.deleteMany({ where: { userId } });
  return NextResponse.json({ ok: true });
});
