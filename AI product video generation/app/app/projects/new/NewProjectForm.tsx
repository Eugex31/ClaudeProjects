"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserSupabase } from "@/lib/supabase/client";
import { extractManifest } from "@/lib/three/manifest";
import { loadGlb } from "@/lib/three/loadGlb";
import { deleteProjectAndFiles } from "@/lib/data/deleteProject";
import { LANGUAGES } from "@/lib/storyboard/types";
import { MAX_MODEL_BYTES, MAX_PASTED_CHARS, MAX_PDF_BYTES, assetPath, normalizeManualText } from "@/lib/manual";

export function NewProjectForm({ orgId }: { orgId: string }) {
  const router = useRouter();
  const supabase = createBrowserSupabase();
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const name = String(form.get("name")).trim();
    const language = String(form.get("language"));
    const model = form.get("model") as File;
    const pdf = form.get("pdf") as File | null;
    const pasted = String(form.get("text") ?? "");

    if (!name) return setStatus("Please enter a product name.");
    if (!model?.name.toLowerCase().endsWith(".glb")) return setStatus("Please choose a .glb model file.");
    if (model.size > MAX_MODEL_BYTES) return setStatus("Model is larger than 50 MB.");
    const hasPdf = pdf && pdf.size > 0;
    if (hasPdf && pdf.size > MAX_PDF_BYTES) return setStatus("PDF is larger than 20 MB.");
    if (!hasPdf && !pasted.trim()) return setStatus("Upload the manual PDF or paste its text.");
    if (pasted.length > MAX_PASTED_CHARS) return setStatus("Pasted text is longer than 100,000 characters.");

    setBusy(true);
    try {
      setStatus("Reading model…");
      const root = await loadGlb(await model.arrayBuffer());
      const parts = extractManifest(root);
      if (parts.length === 0) throw new Error("No meshes found in this model.");

      setStatus("Creating project…");
      const { data: project, error } = await supabase.from("projects").insert({ org_id: orgId, name, language }).select().single();
      if (error) throw error;
      try {
        const { error: sbErr } = await supabase.from("storyboards").insert({
          project_id: project.id, org_id: orgId, parts, steps: [], manual_text: normalizeManualText(pasted),
        });
        if (sbErr) throw sbErr;
        setStatus("Uploading model…");
        await uploadAsset(project.id, "model", model);
      } catch (err) {
        // Never leave a model-less project behind: roll back (best effort) and stay on the form.
        await deleteProjectAndFiles(supabase, project.id).catch(() => undefined);
        throw err;
      }

      try {
        if (hasPdf) {
          setStatus("Uploading and reading manual…");
          const assetId = await uploadAsset(project.id, "manual", pdf);
          const res = await fetch(`/api/projects/${project.id}/manual`, {
            method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ assetId }),
          });
          if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            alert(`${body.error ?? "The manual could not be read."} You can paste the text in the editor.`);
          }
        }
      } catch (err) {
        alert(`${err instanceof Error ? err.message : "The manual upload failed."} The project was created; paste the manual text in the editor.`);
      }
      router.push(`/app/projects/${project.id}`);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Something went wrong.");
      setBusy(false);
    }
  }

  async function uploadAsset(projectId: string, kind: "model" | "manual", file: File) {
    const assetId = crypto.randomUUID();
    const path = assetPath(orgId, projectId, assetId, file.name);
    const { error } = await supabase.storage.from("org-files").upload(path, file, { contentType: file.type || undefined });
    if (error) throw error;
    const { error: aErr } = await supabase.from("assets").insert({
      id: assetId, org_id: orgId, project_id: projectId, kind, storage_path: path, filename: file.name, size_bytes: file.size,
    });
    if (aErr) {
      await supabase.storage.from("org-files").remove([path]).catch(() => undefined);
      throw aErr;
    }
    return assetId;
  }

  return (
    <form onSubmit={submit} className="max-w-xl space-y-4">
      <h1 className="text-xl font-semibold">New project</h1>
      <label className="block">Product name<input name="name" required maxLength={120} className="mt-1 w-full rounded border p-2" /></label>
      <label className="block">Video language
        <select name="language" className="mt-1 w-full rounded border p-2">
          {LANGUAGES.map((l) => <option key={l} value={l}>{l.toUpperCase()}</option>)}
        </select>
      </label>
      <label className="block">3D model (.glb, max 50 MB)<input name="model" type="file" accept=".glb" required className="mt-1 block" /></label>
      <label className="block">Assembly manual (PDF, max 20 MB)<input name="pdf" type="file" accept="application/pdf" className="mt-1 block" /></label>
      <label className="block">…or paste the manual text<textarea name="text" rows={6} className="mt-1 w-full rounded border p-2" /></label>
      <button disabled={busy} className="rounded bg-black px-4 py-2 text-white disabled:opacity-50">Create project</button>
      {status && <p role="status" className="text-sm">{status}</p>}
    </form>
  );
}
