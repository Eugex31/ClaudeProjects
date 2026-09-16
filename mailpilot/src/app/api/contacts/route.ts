import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { withAuth } from "@/lib/apiHandler";
import { contactInputSchema, contactListQuerySchema } from "@/lib/validation/contact.schema";
import { checkTierLimit } from "@/lib/billing";
import { syncContactTags } from "@/lib/syncContactTags";
import { enrollContactsInMatchingSequences, syncDateFieldEnrollments } from "@/lib/sequenceEnrollment";
import { markContactsDirtyForMonday } from "@/lib/mondaySync";

export const GET = withAuth(async (req: NextRequest, { userId }) => {
  const { q, tagId, page, pageSize } = contactListQuerySchema.parse(
    Object.fromEntries(req.nextUrl.searchParams)
  );

  const where: Prisma.ContactWhereInput = {
    userId,
    ...(q
      ? {
          OR: [
            { firstName: { contains: q, mode: "insensitive" } },
            { lastName: { contains: q, mode: "insensitive" } },
            { email: { contains: q, mode: "insensitive" } },
            { company: { contains: q, mode: "insensitive" } },
          ],
        }
      : {}),
    ...(tagId ? { tags: { some: { tagId } } } : {}),
  };

  const [contacts, total] = await Promise.all([
    prisma.contact.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { tags: { select: { tag: { select: { id: true, name: true } } } } },
    }),
    prisma.contact.count({ where }),
  ]);

  return NextResponse.json({
    contacts: contacts.map((c) => ({ ...c, tags: c.tags.map((t) => t.tag) })),
    total,
    page,
    pageSize,
  });
});

export const POST = withAuth(async (req: NextRequest, { userId }) => {
  const { tagIds, ...body } = contactInputSchema.parse(await req.json());

  const limitCheck = await checkTierLimit(userId, "contacts", 1);
  if (!limitCheck.allowed) {
    return NextResponse.json({ error: limitCheck.message, upgradeRequired: true }, { status: 402 });
  }

  try {
    const contact = await prisma.contact.create({ data: { ...body, userId } });
    await enrollContactsInMatchingSequences(userId, [contact.id], { type: "CONTACT_CREATED" });
    if (contact.appointmentAt) {
      await syncDateFieldEnrollments(userId, contact.id, contact.appointmentAt);
    }
    if (tagIds) {
      await syncContactTags(userId, contact.id, tagIds);
    }
    await markContactsDirtyForMonday(userId, [contact.id]);
    return NextResponse.json({ contact }, { status: 201 });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return NextResponse.json({ error: "A contact with this email already exists" }, { status: 409 });
    }
    throw err;
  }
});
