import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { isScopedModelPath, modelUrlFor, newestModel } from "./assets";
import type { Language, PartManifest, Step } from "@/lib/storyboard/types";
import { cleanStoredStoryboard } from "@/lib/storyboard/validate";

export type SharedProject = { name: string; language: Language; parts: PartManifest; steps: Step[]; modelUrl: string };

export async function loadSharedProject(token: string, admin: SupabaseClient = createAdminClient()): Promise<SharedProject | null> {
  if (!/^[A-Za-z0-9_-]{32}$/.test(token)) return null;
  const { data, error } = await admin
    .from("projects")
    .select("id, org_id, name, language, status, storyboards(parts, steps), assets(kind, storage_path, created_at)")
    .eq("share_token", token).eq("status", "approved").maybeSingle();
  if (error) { console.error("loadSharedProject query failed", error.message); return null; }
  if (!data) return null;
  const sb = Array.isArray(data.storyboards) ? data.storyboards[0] : data.storyboards;
  const model = newestModel(data.assets as { kind: string; storage_path: string; created_at: string }[]);
  if (!sb || !model) return null;
  if (!isScopedModelPath(model.storage_path, data.org_id, data.id)) return null;
  const { parts, steps } = cleanStoredStoryboard(sb);
  return { name: data.name, language: data.language, parts, steps, modelUrl: await modelUrlFor(admin, model.storage_path) };
}
