import { NextResponse } from "next/server";
import { extractText, getDocumentProxy } from "unpdf";
import { createClient } from "@/lib/supabase/server";
import { MAX_PDF_BYTES, normalizeManualText } from "@/lib/manual";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let assetId: unknown;
  try {
    ({ assetId } = await request.json());
  } catch {
    assetId = undefined;
  }
  if (typeof assetId !== "string" || !assetId) {
    return NextResponse.json({ error: "assetId is required" }, { status: 400 });
  }
  const supabase = await createClient();
  const { data: asset } = await supabase.from("assets")
    .select("storage_path").eq("id", assetId).eq("project_id", id).eq("kind", "manual").single();
  if (!asset) return NextResponse.json({ error: "Manual not found" }, { status: 404 });

  const { data: file, error } = await supabase.storage.from("org-files").download(asset.storage_path);
  if (error || !file) return NextResponse.json({ error: "Could not read the PDF" }, { status: 404 });
  // The client checks size too, but only the stored object is authoritative.
  if (file.size > MAX_PDF_BYTES) {
    return NextResponse.json({ error: "PDF is larger than 20 MB. Paste the manual text instead." }, { status: 413 });
  }

  let text: string;
  try {
    const pdf = await getDocumentProxy(new Uint8Array(await file.arrayBuffer()));
    const result = await extractText(pdf, { mergePages: true });
    text = normalizeManualText(result.text as string);
  } catch {
    return NextResponse.json({ error: "This PDF could not be read. Paste the manual text instead." }, { status: 422 });
  }
  if (!text) {
    return NextResponse.json({ error: "No text found in this PDF (it may be scanned images). Paste the manual text instead." }, { status: 422 });
  }
  const { data: updated, error: upErr } = await supabase.from("storyboards")
    .update({ manual_text: text }).eq("project_id", id).select("project_id");
  if (upErr || !updated || updated.length === 0) {
    return NextResponse.json({ error: "You don't have permission to edit this project." }, { status: 403 });
  }
  return NextResponse.json({ chars: text.length });
}
