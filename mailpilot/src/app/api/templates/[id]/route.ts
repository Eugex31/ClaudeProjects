import { NextResponse } from "next/server";
import mjml2html from "mjml";
import { prisma } from "@/lib/prisma";
import { withAuth } from "@/lib/apiHandler";
import { templateUpdateSchema } from "@/lib/validation/template.schema";

// mjml needs Node APIs (not available on the Edge runtime) — no route in
// this app sets `runtime` explicitly today, so Node is already the default
// everywhere, but this is the first route with a real Node-only dependency.
export const runtime = "nodejs";

export const GET = withAuth<{ id: string }>(async (_req, { userId, params }) => {
  const template = await prisma.template.findFirst({ where: { id: params.id, userId } });
  if (!template) {
    return NextResponse.json({ error: "Template not found" }, { status: 404 });
  }
  return NextResponse.json({ template });
});

export const PATCH = withAuth<{ id: string }>(async (req, { userId, params }) => {
  const existing = await prisma.template.findFirst({ where: { id: params.id, userId } });
  if (!existing) {
    return NextResponse.json({ error: "Template not found" }, { status: 404 });
  }

  const body = templateUpdateSchema.parse(await req.json());

  // The visual editor sends its current MJML source as `editorSource` —
  // compile it server-side into the real `body`/`bodyFormat` rather than
  // trusting anything the client might also send for those fields, so the
  // two can never drift out of sync and validation happens in one place.
  let data: typeof body = body;
  if (body.editorSource) {
    const { html, errors } = await mjml2html(body.editorSource, { validationLevel: "soft" });
    if (errors.length > 0) {
      return NextResponse.json(
        { error: "This template's content couldn't be saved.", details: errors.map((e) => e.formattedMessage) },
        { status: 400 }
      );
    }
    data = { ...body, body: html, bodyFormat: "HTML" };
  }

  const template = await prisma.template.update({ where: { id: params.id }, data });
  return NextResponse.json({ template });
});

export const DELETE = withAuth<{ id: string }>(async (_req, { userId, params }) => {
  const existing = await prisma.template.findFirst({ where: { id: params.id, userId } });
  if (!existing) {
    return NextResponse.json({ error: "Template not found" }, { status: 404 });
  }

  const newsletterCount = await prisma.newsletter.count({ where: { templateId: params.id } });
  if (newsletterCount > 0) {
    return NextResponse.json(
      { error: "This template is used by a newsletter — remove that first" },
      { status: 409 }
    );
  }

  await prisma.template.delete({ where: { id: params.id } });
  return NextResponse.json({ ok: true });
});
