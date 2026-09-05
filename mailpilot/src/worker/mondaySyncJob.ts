import type { Contact } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { decryptToken } from "@/lib/crypto/tokenCipher";
import { upsertItem, MondayApiError } from "@/lib/monday/client";

// Only these fields are offered in the column-mapping UI — see
// src/app/api/integrations/monday/route.ts's PUT handler.
const FIELD_GETTERS: Record<string, (c: Contact) => string | null> = {
  email: (c) => c.email,
  firstName: (c) => c.firstName,
  lastName: (c) => c.lastName,
  company: (c) => c.company,
  jobTitle: (c) => c.jobTitle,
  website: (c) => c.website,
  greet: (c) => c.greet,
  appointmentAt: (c) => (c.appointmentAt ? c.appointmentAt.toISOString() : null),
};

export async function syncContactToMonday(userId: string, contactId: string): Promise<void> {
  const [integration, contact] = await Promise.all([
    prisma.mondayIntegration.findUnique({ where: { userId } }),
    prisma.contact.findUnique({ where: { id: contactId } }),
  ]);
  if (!integration?.syncEnabled || !integration.boardId || !integration.columnMapping || !contact) {
    return;
  }

  const mapping = integration.columnMapping as Record<string, string>;
  const token = decryptToken(integration.accessToken);

  const columnValues: Record<string, string> = {};
  for (const [field, columnId] of Object.entries(mapping)) {
    const getter = FIELD_GETTERS[field];
    const value = getter?.(contact);
    if (value) {
      columnValues[columnId] = value;
    }
  }

  const itemName = [contact.firstName, contact.lastName].filter(Boolean).join(" ") || contact.email;

  try {
    const itemId = await upsertItem(token, integration.boardId, itemName, columnValues, contact.mondayItemId);
    await prisma.$transaction([
      prisma.contact.update({ where: { id: contact.id }, data: { mondayItemId: itemId } }),
      prisma.mondayIntegration.update({ where: { userId }, data: { lastSyncedAt: new Date() } }),
    ]);
  } catch (err) {
    console.error(`[monday] sync failed for contact ${contact.id}:`, err instanceof MondayApiError ? err.message : err);
    // Best-effort background sync, not the core send path — a plain
    // retry-on-next-poll-tick is proportionate, no backoff/circuit-breaker.
    await prisma.contact.update({ where: { id: contact.id }, data: { mondayDirty: true } });
  }
}
