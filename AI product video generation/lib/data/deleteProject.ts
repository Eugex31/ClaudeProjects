import type { SupabaseClient } from "@supabase/supabase-js";

export type DeleteResult = { ok: true; filesRemoved: boolean } | { ok: false; error: string };

/** Deletes a project (RLS-checked via returned rows), then best-effort removes its non-sample storage objects. */
export async function deleteProjectAndFiles(supabase: SupabaseClient, projectId: string): Promise<DeleteResult> {
  const { data: assets } = await supabase.from("assets").select("storage_path").eq("project_id", projectId);
  const paths = ((assets ?? []) as { storage_path: string }[]).map((a) => a.storage_path).filter((p) => !p.startsWith("sample:"));
  const { data: deleted, error } = await supabase.from("projects").delete().eq("id", projectId).select("id");
  if (error) return { ok: false, error: error.message };
  if (!deleted || deleted.length === 0) return { ok: false, error: "You don't have permission to delete this project." };
  if (paths.length) {
    const { error: rmError } = await supabase.storage.from("org-files").remove(paths);
    if (rmError) return { ok: true, filesRemoved: false };
  }
  return { ok: true, filesRemoved: true };
}
