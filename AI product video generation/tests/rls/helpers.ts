import { execFileSync, execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
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

/** Approve through the RPC using the storyboard version the caller currently sees. */
export async function approveCurrent(client: SupabaseClient, projectId: string) {
  const { data: sb } = await client.from("storyboards").select("updated_at").eq("project_id", projectId).maybeSingle();
  return client.rpc("approve_project", { p_project: projectId, p_storyboard_updated_at: sb?.updated_at ?? new Date(0).toISOString() });
}

/** Run SQL as postgres inside the local Supabase DB container (test-only escape hatch). */
export function psql(sql: string) {
  const projectId = readFileSync(path.resolve(__dirname, "../../supabase/config.toml"), "utf8").match(/^project_id\s*=\s*"([^"]+)"/m)![1];
  execFileSync("docker", ["exec", `supabase_db_${projectId}`, "psql", "-U", "postgres", "-v", "ON_ERROR_STOP=1", "-c", sql], { encoding: "utf8" });
}
