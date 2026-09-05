import { prisma } from "@/lib/prisma";
import { enrollContactsInMatchingSequences } from "@/lib/sequenceEnrollment";

// Replaces a contact's tag set to exactly `tagIds`, silently dropping any id
// that doesn't belong to this user — same trust boundary as every other
// userId-scoped write in this app, just enforced per-row here since tagIds
// arrives as a bare array of ids with no inherent ownership check.
export async function syncContactTags(userId: string, contactId: string, tagIds: string[]): Promise<void> {
  const [owned, existing] = await Promise.all([
    prisma.tag.findMany({ where: { userId, id: { in: tagIds } }, select: { id: true } }),
    prisma.contactTag.findMany({ where: { contactId }, select: { tagId: true } }),
  ]);
  const ownedIds = owned.map((t) => t.id);
  const existingIds = new Set(existing.map((t) => t.tagId));
  // Only genuinely new tags should fire TAG_ADDED enrollment — re-saving a
  // contact with a tag it already had must not re-trigger a sequence.
  const newlyAdded = ownedIds.filter((id) => !existingIds.has(id));

  await prisma.$transaction([
    prisma.contactTag.deleteMany({ where: { contactId, tagId: { notIn: ownedIds } } }),
    ...ownedIds.map((tagId) =>
      prisma.contactTag.upsert({
        where: { contactId_tagId: { contactId, tagId } },
        create: { contactId, tagId },
        update: {},
      })
    ),
  ]);

  for (const tagId of newlyAdded) {
    await enrollContactsInMatchingSequences(userId, [contactId], { type: "TAG_ADDED", tagId });
  }
}
