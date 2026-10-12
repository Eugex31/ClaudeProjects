import { NextResponse } from "next/server";
import { extractText, getDocumentProxy } from "unpdf";
import { createClient } from "@/lib/supabase/server";
import { normalizeManualText } from "@/lib/manual";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { assetId } = await request.json();
  const supabase = await createClient();
  const { data: asset } = await supabase.from("assets")
    .select("storage_path, org_id").eq("id", assetId).eq("project_id", id).eq("kind", "manual").single();
  if (!asset) return NextResponse.json({ error: "Manual not found" }, { status: 404 });

  const { data: file, error } = await supabase.storage.from("org-files").download(asset.storage_path);
  if (error || !file) return NextResponse.json({ error: "Could not read the PDF" }, { status: 404 });

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
  const { error: upErr } = await supabase.from("storyboards").update({ manual_text: text }).eq("project_id", id);
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 403 });
  return NextResponse.json({ chars: text.length });
}
