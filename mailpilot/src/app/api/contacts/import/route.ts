import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withAuth } from "@/lib/apiHandler";
import {
  contactImportRequestSchema,
  contactInputSchema,
  type ContactInput,
} from "@/lib/validation/contact.schema";
import { checkRateLimit } from "@/lib/rateLimit";
import { checkTierLimit } from "@/lib/billing";
import { enrollContactsInMatchingSequences, syncDateFieldEnrollments } from "@/lib/sequenceEnrollment";
import { markContactsDirtyForMonday } from "@/lib/mondaySync";

export const POST = withAuth(async (req, { userId }) => {
  const allowed = await checkRateLimit(`contacts-import:${userId}`, 5, 3600);
  if (!allowed) {
    return NextResponse.json({ error: "Too many imports recently. Try again later." }, { status: 429 });
  }

  const { rows } = contactImportRequestSchema.parse(await req.json());

  const valid: ContactInput[] = [];
  let invalid = 0;
  for (const row of rows) {
    const parsed = contactInputSchema.safeParse(row);
    if (parsed.success) {
      valid.push(parsed.data);
    } else {
      invalid += 1;
    }
  }

  const seen = new Set<string>();
  const deduped = valid.filter((row) => {
    if (seen.has(row.email)) return false;
    seen.add(row.email);
    return true;
  });
  const duplicatesInFile = valid.length - deduped.length;

  const existing = await prisma.contact.findMany({
    where: { userId, email: { in: deduped.map((r) => r.email) } },
    select: { email: true },
  });
  const existingEmails = new Set(existing.map((c) => c.email));

  const toCreate = deduped.filter((row) => !existingEmails.has(row.email));
  const duplicatesExisting = deduped.length - toCreate.length;

  const limitCheck = await checkTierLimit(userId, "contacts", toCreate.length);
  if (!limitCheck.allowed) {
    return NextResponse.json({ error: limitCheck.message, upgradeRequired: true }, { status: 402 });
  }

  const result = await prisma.contact.createMany({
    data: toCreate.map((row) => ({ ...row, userId })),
    skipDuplicates: true,
  });

  if (toCreate.length > 0) {
    // createMany doesn't return the created rows — toCreate's emails were
    // already deduped against existing DB rows above, so every one of them
    // exists now (this insert, or a concurrent one) and is safe to look up.
    const createdContacts = await prisma.contact.findMany({
      where: { userId, email: { in: toCreate.map((r) => r.email) } },
      select: { id: true, appointmentAt: true },
    });
    await enrollContactsInMatchingSequences(
      userId,
      createdContacts.map((c) => c.id),
      { type: "CONTACT_CREATED" }
    );
    for (const c of createdContacts) {
      if (c.appointmentAt) {
        await syncDateFieldEnrollments(userId, c.id, c.appointmentAt);
      }
    }
    await markContactsDirtyForMonday(userId, createdContacts.map((c) => c.id));
  }

  return NextResponse.json({
    totalRows: rows.length,
    imported: result.count,
    duplicatesSkipped: duplicatesInFile + duplicatesExisting,
    invalidSkipped: invalid,
  });
});
