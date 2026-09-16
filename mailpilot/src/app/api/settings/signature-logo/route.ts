import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withAuth } from "@/lib/apiHandler";
import { checkRateLimit } from "@/lib/rateLimit";

const ALLOWED_TYPES = ["image/png", "image/jpeg"];
const MAX_BYTES = 2 * 1024 * 1024; // 2MB

export const GET = withAuth(async (_req, { userId }) => {
  const settings = await prisma.settings.findUnique({
    where: { userId },
    select: { signatureLogo: true, signatureLogoContentType: true },
  });
  if (!settings?.signatureLogo || !settings.signatureLogoContentType) {
    return NextResponse.json({ error: "No signature logo set" }, { status: 404 });
  }

  return new NextResponse(new Uint8Array(settings.signatureLogo), {
    headers: {
      "Content-Type": settings.signatureLogoContentType,
      "Cache-Control": "private, max-age=300",
    },
  });
});

export const POST = withAuth(async (req, { userId }) => {
  const allowed = await checkRateLimit(`signature-logo-upload:${userId}`, 10, 3600);
  if (!allowed) {
    return NextResponse.json({ error: "Too many uploads recently. Try again later." }, { status: 429 });
  }

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }
  if (!ALLOWED_TYPES.includes(file.type)) {
    return NextResponse.json({ error: "Logo must be a PNG or JPG image" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "Logo must be 2MB or smaller" }, { status: 400 });
  }

  const bytes = Buffer.from(await file.arrayBuffer());

  await prisma.settings.upsert({
    where: { userId },
    create: {
      userId,
      signatureLogo: bytes,
      signatureLogoContentType: file.type,
      signatureLogoFilename: file.name,
    },
    update: {
      signatureLogo: bytes,
      signatureLogoContentType: file.type,
      signatureLogoFilename: file.name,
    },
  });

  return NextResponse.json({ ok: true });
});

export const DELETE = withAuth(async (_req, { userId }) => {
  await prisma.settings.updateMany({
    where: { userId },
    data: { signatureLogo: null, signatureLogoContentType: null, signatureLogoFilename: null },
  });
  return NextResponse.json({ ok: true });
});
