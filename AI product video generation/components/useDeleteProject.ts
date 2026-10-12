"use client";
import { useRouter } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { deleteProjectAndFiles } from "@/lib/data/deleteProject";

export type DeleteOutcome = { kind: "cancelled" } | { kind: "error"; message: string } | { kind: "deleted" };

/** Confirm, delete via the shared helper, then go back to the project list. */
export function useDeleteProject(supabase: SupabaseClient, project: { id: string; name: string }) {
  const router = useRouter();
  return async (): Promise<DeleteOutcome> => {
    if (!confirm(`Delete "${project.name}" and all its files? This cannot be undone.`)) return { kind: "cancelled" };
    const result = await deleteProjectAndFiles(supabase, project.id);
    if (!result.ok) return { kind: "error", message: result.error };
    if (!result.filesRemoved) alert("Project deleted, but some files could not be removed.");
    router.push("/app");
    router.refresh();
    return { kind: "deleted" };
  };
}
