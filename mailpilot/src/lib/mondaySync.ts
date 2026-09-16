import { prisma } from "@/lib/prisma";

// Marks contacts dirty for the next Monday sync cycle (src/worker/poller.ts's
// pollMondaySyncOnce). No-ops for the vast majority of users who have no
// enabled integration, so contact writes for everyone else pay zero extra
// cost beyond this one lookup — same "check for a matching automation first"
// shape as enrollContactsInMatchingSequences.
export async function markContactsDirtyForMonday(userId: string, contactIds: string[]): Promise<void> {
  if (contactIds.length === 0) return;

  const integration = await prisma.mondayIntegration.findUnique({
    where: { userId },
    select: { syncEnabled: true, boardId: true },
  });
  // Not connected, or connected but no board configured yet, or paused.
  if (!integration?.syncEnabled || !integration.boardId) return;

  await prisma.contact.updateMany({
    where: { id: { in: contactIds }, userId },
    data: { mondayDirty: true },
  });
}
