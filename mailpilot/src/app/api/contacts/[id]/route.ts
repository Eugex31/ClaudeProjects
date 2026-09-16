import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { withAuth } from "@/lib/apiHandler";
import { contactUpdateSchema } from "@/lib/validation/contact.schema";
import { syncContactTags } from "@/lib/syncContactTags";
import { syncDateFieldEnrollments } from "@/lib/sequenceEnrollment";
import { markContactsDirtyForMonday } from "@/lib/mondaySync";

export const PATCH = withAuth<{ id: string }>(async (req, { userId, params }) => {
  const { tagIds, ...body } = contactUpdateSchema.parse(await req.json());
  // Only touch the appointment-reminder schedule when the request actually
  // included this field — editing an unrelated field must not reset it.
  const appointmentChanged = Object.prototype.hasOwnProperty.call(body, "appointmentAt");

  const existing = await prisma.contact.findFirst({ where: { id: params.id, userId } });
  if (!existing) {
    return NextResponse.json({ error: "Contact not found" }, { status: 404 });
  }

  try {
    const contact = await prisma.contact.update({ where: { id: params.id }, data: body });
    if (tagIds) {
      await syncContactTags(userId, contact.id, tagIds);
    }
    if (appointmentChanged) {
      await syncDateFieldEnrollments(userId, contact.id, contact.appointmentAt);
    }
    await markContactsDirtyForMonday(userId, [contact.id]);
    return NextResponse.json({ contact });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return NextResponse.json({ error: "A contact with this email already exists" }, { status: 409 });
    }
    throw err;
  }
});

export const DELETE = withAuth<{ id: string }>(async (_req, { userId, params }) => {
  const { count } = await prisma.contact.deleteMany({ where: { id: params.id, userId } });
  if (count === 0) {
    return NextResponse.json({ error: "Contact not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
});
