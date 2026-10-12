import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { modelUrlFor } from "./assets";
import type { Language, PartManifest, Step } from "@/lib/storyboard/types";

export type SharedProject = { name: string; language: Language; parts: PartManifest; steps: Step[]; modelUrl: string };

export async function loadSharedProject(token: string, admin: SupabaseClient = createAdminClient()): Promise<SharedProject | null> {
  if (!/^[A-Za-z0-9_-]{32}$/.test(token)) return null;
  const { data } = await admin
    .from("projects")
    .select("name, language, status, storyboards(parts, steps), assets(kind, storage_path)")
    .eq("share_token", token).eq("status", "approved").maybeSingle();
  if (!data) return null;
  const sb = Array.isArray(data.storyboards) ? data.storyboards[0] : data.storyboards;
  const model = (data.assets as { kind: string; storage_path: string }[]).find((a) => a.kind === "model");
  if (!sb || !model) return null;
  return { name: data.name, language: data.language, parts: sb.parts, steps: sb.steps, modelUrl: await modelUrlFor(admin, model.storage_path) };
}
