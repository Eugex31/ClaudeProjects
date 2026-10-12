"use client";
import { useState } from "react";
import { createBrowserSupabase } from "@/lib/supabase/client";
import { recordVideo } from "@/lib/player/record";
import { assetPath } from "@/lib/manual";
import type { PartManifest, Step } from "@/lib/storyboard/types";
import type { EditorProject } from "./Editor";

const MAX_EXPORT_BYTES = 200 * 1024 * 1024;

export function RecordButton({ project, steps, parts, modelUrl, approved, canUpload }: {
  project: EditorProject; steps: Step[]; parts: PartManifest; modelUrl: string; approved: boolean; canUpload: boolean;
}) {
  const [progress, setProgress] = useState<number | null>(null);
  const [note, setNote] = useState<string | null>(null);

  async function record() {
    setNote("Recording in real time — keep this tab visible. The file has captions but no voice.");
    setProgress(0);
    try {
      const { blob, mimeType } = await recordVideo({ modelUrl, steps, manifest: parts, onProgress: setProgress });
      const ext = mimeType.startsWith("video/mp4") ? "mp4" : "webm";
      const filename = `${project.name.replace(/[^A-Za-z0-9_-]+/g, "-")}.${ext}`;
      const url = URL.createObjectURL(blob);
      Object.assign(document.createElement("a"), { href: url, download: filename }).click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);

      if (canUpload && blob.size <= MAX_EXPORT_BYTES) {
        const supabase = createBrowserSupabase();
        const assetId = crypto.randomUUID();
        const path = assetPath(project.org_id, project.id, assetId, filename);
        const { error } = await supabase.storage.from("org-files").upload(path, blob, { contentType: blob.type });
        if (error) {
          setNote(`Downloaded, but saving a copy failed: ${error.message}`);
        } else {
          const { error: insertError } = await supabase.from("assets").insert({
            id: assetId, org_id: project.org_id, project_id: project.id, kind: "export",
            storage_path: path, filename, size_bytes: blob.size,
          });
          setNote(insertError
            ? `Downloaded, but registering the saved copy failed: ${insertError.message}`
            : "Downloaded and saved to the workspace.");
        }
      } else {
        setNote("Downloaded.");
      }
    } catch (err) {
      setNote(err instanceof Error ? err.message : "Recording failed.");
    } finally {
      setProgress(null);
    }
  }

  return (
    <>
      <button onClick={record} disabled={!approved || progress !== null} title={approved ? "" : "Approve the storyboard first"}
        className="rounded border px-3 py-1 disabled:opacity-40">
        {progress === null ? "Record video" : `Recording ${Math.round(progress * 100)}%`}
      </button>
      {note && <span className="text-xs text-gray-600">{note}</span>}
    </>
  );
}
