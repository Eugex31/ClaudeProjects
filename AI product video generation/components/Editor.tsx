"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserSupabase } from "@/lib/supabase/client";
import { validateStoryboard } from "@/lib/storyboard/validate";
import { addStep, moveStep, removeStep, togglePart } from "@/lib/storyboard/edit";
import { CAMERA_PRESETS, DIRECTIONS, LIMITS, type Issue, type Language, type PartManifest, type Step } from "@/lib/storyboard/types";
import { canEdit, type Role } from "@/lib/roles";
import { EditorViewport } from "./EditorViewport";
import { Player } from "./Player";

export type EditorProject = { id: string; name: string; language: Language; status: "draft" | "approved"; share_token: string | null; org_id: string };

export function Editor(props: {
  project: EditorProject; role: Role; parts: PartManifest; steps: Step[]; manualText: string; modelUrl: string;
  toolbarExtras?: (ctx: { approved: boolean; steps: Step[]; parts: PartManifest; project: EditorProject }) => React.ReactNode;
}) {
  const router = useRouter();
  const [supabase] = useState(() => createBrowserSupabase());
  const editable = canEdit(props.role);
  const [steps, setSteps] = useState(props.steps);
  const [parts, setParts] = useState(props.parts);
  const [manualText, setManualText] = useState(props.manualText);
  const [status, setStatus] = useState(props.project.status);
  const [selected, setSelected] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [serverIssues, setServerIssues] = useState<Issue[]>([]);
  const [preview, setPreview] = useState(false);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const issues = useMemo(() => [...validateStoryboard(steps, parts).issues, ...serverIssues], [steps, parts, serverIssues]);
  const step = steps[selected];

  function edit(next: Step[]) { setSteps(next); setDirty(true); setServerIssues([]); }
  function patch(fields: Partial<Step>) { edit(steps.map((s, i) => (i === selected ? { ...s, ...fields } : s))); }

  async function refreshStatus() {
    const { data } = await supabase.from("projects").select("status").eq("id", props.project.id).single();
    if (data) setStatus(data.status);
  }

  async function save(): Promise<boolean> {
    setBusy("Saving…");
    const { steps: clean } = validateStoryboard(steps, parts);
    const { data, error } = await supabase.from("storyboards")
      .update({ steps: clean, parts, manual_text: manualText }).eq("project_id", props.project.id).select("project_id");
    setBusy(null);
    if (error) { setMessage(error.message); return false; }
    if (!data || data.length === 0) { setMessage("You don't have permission to edit this project."); return false; }
    setSteps(clean);
    setSelected((s) => Math.min(s, Math.max(0, clean.length - 1)));
    setDirty(false);
    setMessage("Saved.");
    await refreshStatus();
    return true;
  }

  async function generate() {
    if (steps.length && !confirm("Replace the current storyboard with a new AI draft?")) return;
    if (dirty && !(await save())) return;
    setBusy("Generating with AI… this can take a minute.");
    try {
      const res = await fetch(`/api/projects/${props.project.id}/generate`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setMessage(body.error ?? "Generation failed."); return; }
      setSteps(body.steps);
      setServerIssues(body.issues ?? []);
      setSelected(0);
      setDirty(false);
      setMessage("AI draft ready. Review every step before approving.");
      await refreshStatus();
    } catch {
      setMessage("Generation failed. Check your connection and try again.");
    } finally {
      setBusy(null);
    }
  }

  async function approve() {
    const { data, error } = await supabase.from("projects").update({ status: "approved" }).eq("id", props.project.id).select("status");
    if (error) return setMessage(error.message);
    if (!data || data.length === 0) return setMessage("You don't have permission to approve this project.");
    setStatus(data[0].status);
    setMessage("Approved. You can now record and share the video.");
  }

  async function deleteProject() {
    if (!confirm(`Delete "${props.project.name}" and all its files? This cannot be undone.`)) return;
    if (busy) return;
    setBusy("Deleting…");
    const { data: assets } = await supabase.from("assets").select("storage_path").eq("project_id", props.project.id);
    const paths = (assets ?? []).map((a) => a.storage_path).filter((p) => !p.startsWith("sample:"));
    const { data: deleted, error } = await supabase.from("projects").delete().eq("id", props.project.id).select("id");
    if (error || !deleted || deleted.length === 0) {
      setBusy(null);
      return setMessage(error ? error.message : "You don't have permission to delete this project.");
    }
    if (paths.length) {
      const { error: rmError } = await supabase.storage.from("org-files").remove(paths);
      if (rmError) alert("Project deleted, but some files could not be removed.");
    }
    router.push("/app");
    router.refresh();
  }

  const approved = status === "approved" && !dirty;
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="mr-2 text-xl font-semibold">{props.project.name}</h1>
          <span className={`rounded px-2 py-0.5 text-xs ${approved ? "bg-green-100 text-green-800" : "bg-amber-100 text-amber-800"}`}>
            {dirty ? "unsaved changes" : status}
          </span>
          {editable && <>
            <button onClick={generate} disabled={!!busy} className="rounded border px-3 py-1">Generate with AI</button>
            <button onClick={save} disabled={!!busy || !dirty} className="rounded border px-3 py-1">Save</button>
            <button onClick={approve} disabled={!!busy || dirty || status === "approved" || steps.length === 0} className="rounded bg-green-700 px-3 py-1 text-white disabled:opacity-40">Approve</button>
          </>}
          <button onClick={() => setPreview(!preview)} className="rounded border px-3 py-1">{preview ? "Back to editing" : "Preview video"}</button>
          {props.toolbarExtras?.({ approved, steps, parts, project: props.project })}
          {editable && <button onClick={deleteProject} className="ml-auto text-sm text-red-700 underline">Delete project</button>}
        </div>
        {(busy || message) && <p role="status" className="text-sm">{busy ?? message}</p>}
        {preview
          ? <Player modelUrl={props.modelUrl} steps={steps} manifest={parts} language={props.project.language} />
          : <EditorViewport modelUrl={props.modelUrl} steps={steps} parts={parts} selectedIndex={selected}
              onPartClick={editable && step ? (id) => edit(togglePart(steps, selected, id)) : undefined} />}
        {issues.length > 0 && (
          <ul className="rounded border border-amber-300 bg-amber-50 p-3 text-sm">
            {issues.map((i, n) => <li key={n}>{i.level === "error" ? "⛔" : "⚠"} {i.message}</li>)}
          </ul>
        )}
        <details>
          <summary className="cursor-pointer text-sm">Manual text ({manualText.length.toLocaleString()} characters)</summary>
          <textarea value={manualText} disabled={!editable} rows={10} maxLength={500000}
            onChange={(e) => { setManualText(e.target.value); setDirty(true); }}
            className="mt-2 w-full rounded border p-2 font-mono text-xs" />
        </details>
        <details>
          <summary className="cursor-pointer text-sm">Part names ({parts.length})</summary>
          <ul className="mt-2 grid grid-cols-2 gap-1 text-sm">
            {parts.map((p, n) => (
              <li key={p.id} className="flex items-center gap-1">
                <code className="w-28 truncate text-xs">{p.id}</code>
                <input value={p.label} disabled={!editable} className="flex-1 rounded border px-1"
                  onChange={(e) => { setParts(parts.map((q, m) => (m === n ? { ...q, label: e.target.value } : q))); setDirty(true); }} />
              </li>
            ))}
          </ul>
        </details>
      </div>

      <aside className="space-y-3">
        <ol className="divide-y rounded border">
          {steps.map((s, i) => (
            <li key={s.id} draggable={editable}
              onDragStart={() => setDragFrom(i)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => { if (dragFrom !== null && dragFrom !== i) { edit(moveStep(steps, dragFrom, i)); setSelected(i); } setDragFrom(null); }}
              onClick={() => setSelected(i)}
              className={`cursor-pointer p-2 text-sm ${i === selected ? "bg-blue-50" : ""}`}>
              <span className="mr-2 text-gray-500">{i + 1}.</span>{s.title}
              <span className="ml-1 text-xs text-gray-500">({s.parts.length} parts)</span>
            </li>
          ))}
        </ol>
        {editable && (
          <div className="flex gap-2 text-sm">
            <button onClick={() => { edit(addStep(steps, selected)); setSelected(Math.min(selected + 1, steps.length)); }} className="rounded border px-2 py-1">+ Add step</button>
            {step && <button onClick={() => { edit(removeStep(steps, selected)); setSelected(Math.max(0, selected - 1)); }} className="rounded border px-2 py-1 text-red-700">Delete step</button>}
          </div>
        )}
        {step && (
          <fieldset disabled={!editable} className="space-y-2 text-sm">
            <label className="block">Title<input value={step.title} maxLength={LIMITS.title} onChange={(e) => patch({ title: e.target.value })} className="mt-1 w-full rounded border p-1" /></label>
            <label className="block">Narration<textarea value={step.narration} maxLength={LIMITS.narration} rows={4} onChange={(e) => patch({ narration: e.target.value })} className="mt-1 w-full rounded border p-1" /></label>
            <label className="block">Safety warning (optional)<input value={step.warning ?? ""} maxLength={LIMITS.warning} onChange={(e) => patch({ warning: e.target.value || undefined })} className="mt-1 w-full rounded border p-1" /></label>
            <div className="flex gap-2">
              <label className="flex-1">Parts come from
                <select value={step.from} onChange={(e) => patch({ from: e.target.value as Step["from"] })} className="mt-1 w-full rounded border p-1">
                  {DIRECTIONS.map((d) => <option key={d}>{d}</option>)}
                </select>
              </label>
              <label className="flex-1">Camera
                <select value={step.camera} onChange={(e) => patch({ camera: e.target.value as Step["camera"] })} className="mt-1 w-full rounded border p-1">
                  {CAMERA_PRESETS.map((c) => <option key={c}>{c}</option>)}
                </select>
              </label>
            </div>
            <p className="text-xs text-gray-600">Parts: {step.parts.map((id) => parts.find((p) => p.id === id)?.label ?? id).join(", ") || "none — click parts in the 3D view"}</p>
          </fieldset>
        )}
      </aside>
    </div>
  );
}
