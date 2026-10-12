"use client";
import { useState } from "react";
import { createBrowserSupabase } from "@/lib/supabase/client";
import { useDeleteProject } from "./useDeleteProject";

export function MissingModel({ project, editable }: { project: { id: string; name: string }; editable: boolean }) {
  const [supabase] = useState(() => createBrowserSupabase());
  const del = useDeleteProject(supabase, project);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function onDelete() {
    if (busy) return;
    setBusy(true);
    const outcome = await del();
    if (outcome.kind === "deleted") return;
    setBusy(false);
    if (outcome.kind === "error") setMessage(outcome.message);
  }

  return (
    <div className="max-w-xl space-y-3">
      <h1 className="text-xl font-semibold">{project.name}</h1>
      <p>This project&apos;s 3D model is missing or unavailable.</p>
      {editable && <button onClick={onDelete} disabled={busy} className="rounded border border-red-700 px-3 py-1 text-red-700 disabled:opacity-40">{busy ? "Deleting…" : "Delete project"}</button>}
      {message && <p role="status" className="text-sm">{message}</p>}
    </div>
  );
}
