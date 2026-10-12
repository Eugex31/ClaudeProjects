import { execSync } from "node:child_process";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let cached: { url: string; anonKey: string; serviceKey: string } | null = null;

export function localEnv() {
  if (cached) return cached;
  const out = execSync("npx supabase status -o env", { encoding: "utf8" });
  const get = (k: string) => {
    const m = out.match(new RegExp(`^${k}="?([^"\\n]+)"?`, "m"));
    if (!m) throw new Error(`Missing ${k} in supabase status; is the local stack running?`);
    return m[1];
  };
  cached = { url: get("API_URL"), anonKey: get("ANON_KEY"), serviceKey: get("SERVICE_ROLE_KEY") };
  return cached;
}

export const admin = (): SupabaseClient =>
  createClient(localEnv().url, localEnv().serviceKey, { auth: { persistSession: false } });

export async function makeUser(email: string) {
  const password = "test-password-123";
  const { data, error } = await admin().auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  const client = createClient(localEnv().url, localEnv().anonKey, { auth: { persistSession: false } });
  const { error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError) throw signInError;
  const { data: m } = await client.from("memberships").select("org_id").eq("user_id", data.user.id).single();
  return { client, userId: data.user.id, orgId: m!.org_id as string };
}
