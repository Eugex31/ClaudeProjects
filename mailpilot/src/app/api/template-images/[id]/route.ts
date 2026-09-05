import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";

// Deliberately NOT wrapped in withAuth — unlike Settings.signatureLogo's
// serve route (only ever fetched by the owner's own logged-in browser),
// this image is embedded directly in sent campaign HTML and will be
// fetched by arbitrary recipients' mail clients with no session cookie at
// all. Image bytes aren't secret, so no ownership check is needed to serve
// them (same reasoning already applied to the public tracking-pixel route).
// See src/proxy.ts for the matching public-path exemption, scoped to GET
// only so the POST upload route above stays authenticated/CSRF-checked.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const image = await prisma.templateImage.findUnique({
    where: { id },
    select: { data: true, contentType: true },
  });
  if (!image) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return new NextResponse(new Uint8Array(image.data), {
    headers: {
      "Content-Type": image.contentType,
      // Safe to cache indefinitely — an image row is never mutated in
      // place, a re-upload always creates a new id.
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
