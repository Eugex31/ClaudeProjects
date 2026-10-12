"use server";
import { createClient } from "@/lib/supabase/server";
import { randomToken } from "@/lib/tokens";

export async function createShareLink(projectId: string): Promise<string> {
  const supabase = await createClient();
  const { data: p } = await supabase.from("projects").select("status, share_token").eq("id", projectId).single();
  if (!p) throw new Error("Project not found");
  if (p.status !== "approved") throw new Error("Approve the storyboard before sharing");
  if (p.share_token) return p.share_token;
  const token = randomToken();
  const { data, error } = await supabase.from("projects").update({ share_token: token }).eq("id", projectId).is("share_token", null).select("id");
  if (error) throw new Error(error.message);
  if (data && data.length > 0) return token;
  // Zero rows: either a concurrent request set the token, or we lack permission.
  const { data: again } = await supabase.from("projects").select("status, share_token").eq("id", projectId).single();
  if (again?.status === "approved" && again.share_token) return again.share_token;
  throw new Error("You don't have permission to share this project");
}

export async function revokeShareLink(projectId: string): Promise<void> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("projects").update({ share_token: null }).eq("id", projectId).select("id");
  if (error) throw new Error(error.message);
  if (!data || data.length === 0) throw new Error("You don't have permission to revoke this link");
}
