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
