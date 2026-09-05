import { Prisma, type SequenceTriggerType } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export type SequenceTrigger = { type: "CONTACT_CREATED" } | { type: "TAG_ADDED"; tagId: string };

// Auto-enrollment for ACTIVE sequences whose triggerType matches. Takes an
// array of contact ids (not just one) so a single new contact and a bulk CSV
// import both funnel through the same code path — see callers in
// src/app/api/contacts/route.ts, src/app/api/contacts/import/route.ts, and
// src/lib/syncContactTags.ts.
export async function enrollContactsInMatchingSequences(
  userId: string,
  contactIds: string[],
  trigger: SequenceTrigger
): Promise<void> {
  if (contactIds.length === 0) return;

  const where: Prisma.SequenceWhereInput =
    trigger.type === "CONTACT_CREATED"
      ? { userId, status: "ACTIVE", triggerType: "CONTACT_CREATED" }
      : { userId, status: "ACTIVE", triggerType: "TAG_ADDED", triggerTagId: trigger.tagId };

  const sequences = await prisma.sequence.findMany({
    where,
    include: { steps: { where: { order: 0 }, take: 1 } },
  });

  const enrollable = sequences.filter((s) => s.steps.length > 0);
  if (enrollable.length === 0) return;

  const now = Date.now();
  const data = enrollable.flatMap((sequence) =>
    contactIds.map((contactId) => ({
      sequenceId: sequence.id,
      contactId,
      nextSendAt: new Date(now + sequence.steps[0].delaySeconds * 1000),
    }))
  );

  await prisma.sequenceEnrollment.createMany({ data, skipDuplicates: true });
}

// What "this step's delay" means depends on the sequence's trigger: every
// trigger type except DATE_FIELD counts forward from an event (enrollment or
// the previous step); DATE_FIELD counts backward from a target date, since
// its steps are independent "remind me N before X" offsets, not a chain.
// Shared by the worker (advancing to the next step) and enrollment/reschedule
// logic below, so this is the one place "what does this step's timing mean"
// lives.
export function computeStepSendAt(
  triggerType: SequenceTriggerType,
  appointmentAt: Date | null,
  delaySeconds: number
): Date | null {
  if (triggerType === "DATE_FIELD") {
    if (!appointmentAt) return null;
    return new Date(appointmentAt.getTime() - delaySeconds * 1000);
  }
  return new Date(Date.now() + delaySeconds * 1000);
}

// Enrolls, reschedules, or cancels a contact's enrollment in every ACTIVE
// DATE_FIELD sequence the user has, based on their current appointmentAt.
//
// Unlike every other trigger type, this deliberately CAN resurrect a
// COMPLETED/CANCELED enrollment: an appointment is a live, editable fact, not
// a one-time event like a signup, so moving the date again should re-arm the
// reminder schedule relative to the new date even if the old schedule
// already finished (or was manually removed) — the @@unique(sequenceId,
// contactId) constraint means there's only ever one row to reset, never a
// second one to create.
export async function syncDateFieldEnrollments(
  userId: string,
  contactId: string,
  appointmentAt: Date | null
): Promise<void> {
  const sequences = await prisma.sequence.findMany({
    where: { userId, status: "ACTIVE", triggerType: "DATE_FIELD" },
    include: { steps: { orderBy: { order: "asc" } } },
  });
  if (sequences.length === 0) return;

  for (const sequence of sequences) {
    const existing = await prisma.sequenceEnrollment.findUnique({
      where: { sequenceId_contactId: { sequenceId: sequence.id, contactId } },
    });

    if (!appointmentAt || sequence.steps.length === 0) {
      if (existing && existing.status === "ACTIVE") {
        await prisma.sequenceEnrollment.update({
          where: { id: existing.id },
          data: { status: "CANCELED", nextSendAt: null },
        });
      }
      continue;
    }

    // Skip any step whose offset from the (possibly new) date has already
    // passed — a rescheduled-nearer appointment shouldn't fire a burst of
    // "reminders" for offsets that are now in the past.
    let stepIndex = -1;
    let nextSendAt: Date | null = null;
    for (let i = 0; i < sequence.steps.length; i++) {
      const candidate = computeStepSendAt("DATE_FIELD", appointmentAt, sequence.steps[i].delaySeconds);
      if (candidate && candidate.getTime() > Date.now()) {
        stepIndex = i;
        nextSendAt = candidate;
        break;
      }
    }

    if (!nextSendAt) {
      // Every configured offset is already in the past for this date — mark
      // COMPLETED (creating the row if this is the contact's first pass
      // through this sequence) rather than leaving no record at all, so the
      // Enrollments tab shows why this contact never got a reminder.
      if (existing) {
        if (existing.status === "ACTIVE") {
          await prisma.sequenceEnrollment.update({
            where: { id: existing.id },
            data: { status: "COMPLETED", currentStep: sequence.steps.length, nextSendAt: null },
          });
        }
      } else {
        await prisma.sequenceEnrollment.create({
          data: {
            sequenceId: sequence.id,
            contactId,
            status: "COMPLETED",
            currentStep: sequence.steps.length,
            nextSendAt: null,
          },
        });
      }
      continue;
    }

    if (existing) {
      await prisma.sequenceEnrollment.update({
        where: { id: existing.id },
        data: { status: "ACTIVE", currentStep: stepIndex, nextSendAt },
      });
    } else {
      await prisma.sequenceEnrollment.create({
        data: { sequenceId: sequence.id, contactId, currentStep: stepIndex, nextSendAt },
      });
    }
  }
}
