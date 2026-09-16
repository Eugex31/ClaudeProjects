import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withAuth } from "@/lib/apiHandler";
import { checkRateLimit } from "@/lib/rateLimit";

// Multi-asset counterpart to Settings.signatureLogo — same MIME/size/
// rate-limit validation as src/app/api/settings/signature-logo/route.ts,
// but a real `create` per upload (not an upsert onto a single-slot row),
// since a customer can use many different images across many templates.
const ALLOWED_TYPES = ["image/png", "image/jpeg"];
const MAX_BYTES = 2 * 1024 * 1024; // 2MB
const MAX_IMAGES_PER_USER = 50; // flat count cap, same shape as checkTemplateLimit/checkSequenceLimit

export const POST = withAuth(async (req, { userId }) => {
  const allowed = await checkRateLimit(`template-image-upload:${userId}`, 20, 3600);
  if (!allowed) {
    return NextResponse.json({ error: "Too many uploads recently. Try again later." }, { status: 429 });
  }

  const existingCount = await prisma.templateImage.count({ where: { userId } });
  if (existingCount >= MAX_IMAGES_PER_USER) {
    return NextResponse.json(
      { error: `You can upload up to ${MAX_IMAGES_PER_USER} images. Delete an unused one to add more.` },
      { status: 400 }
    );
  }

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }
  if (!ALLOWED_TYPES.includes(file.type)) {
    return NextResponse.json({ error: "Image must be a PNG or JPG" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "Image must be 2MB or smaller" }, { status: 400 });
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  const image = await prisma.templateImage.create({
    data: { userId, data: bytes, contentType: file.type, filename: file.name },
  });

  // Absolute URL — this is embedded directly in sent campaign HTML, so it
  // must resolve for a recipient's mail client, not just same-origin. Shape
  // matches GrapesJS's AssetManager auto-add convention ({ data: [...] }),
  // which the visual editor's Image block asset picker expects.
  const baseUrl = process.env.NEXTAUTH_URL ?? new URL(req.url).origin;
  const src = `${baseUrl}/api/template-images/${image.id}`;
  return NextResponse.json({ data: [{ src }] }, { status: 201 });
});
