import type { SupabaseClient } from "@supabase/supabase-js";

export function resolveSamplePath(storagePath: string): string | null {
  const m = storagePath.match(/^sample:([A-Za-z0-9_-]+\.glb)$/);
  return m ? `/sample/${m[1]}` : null;
}

export async function modelUrlFor(supabase: SupabaseClient, storagePath: string): Promise<string> {
  const sample = resolveSamplePath(storagePath);
  if (sample) return sample;
  const { data, error } = await supabase.storage.from("org-files").createSignedUrl(storagePath, 600);
  if (error || !data) throw new Error("Could not sign model URL");
  return data.signedUrl;
}

export function isScopedModelPath(path: string, orgId: string, projectId: string): boolean {
  if (resolveSamplePath(path) !== null) return true;
  const prefix = `${orgId}/${projectId}/`;
  return path.startsWith(prefix) && /^[A-Za-z0-9_-][A-Za-z0-9._-]*$/.test(path.slice(prefix.length));
}

export function newestModel<T extends { kind: string; created_at: string }>(assets: T[]): T | undefined {
  return assets.filter((a) => a.kind === "model").sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
}
