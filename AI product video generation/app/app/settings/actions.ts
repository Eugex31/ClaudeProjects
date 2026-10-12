"use server";
import { revalidatePath } from "next/cache";
import { getCurrentOrg } from "@/lib/data/orgs";
import { createClient } from "@/lib/supabase/server";

async function ownerContext() {
  const org = await getCurrentOrg();
  if (org.role !== "owner") throw new Error("Only owners can change workspace settings");
  return { org, supabase: await createClient() };
}

export async function renameOrg(formData: FormData) {
  const { org, supabase } = await ownerContext();
  const name = String(formData.get("name") ?? "").trim().slice(0, 100);
  if (!name) return;
  const { error } = await supabase.from("organizations").update({ name }).eq("id", org.id);
  if (error) throw error;
  revalidatePath("/app", "layout");
}

export async function createInvite(formData: FormData) {
  const { org, supabase } = await ownerContext();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const role = formData.get("role") === "viewer" ? "viewer" : "editor";
  const { error } = await supabase.from("invites").insert({ org_id: org.id, email, role });
  if (error) throw error;
  revalidatePath("/app/settings");
}

export async function changeRole(formData: FormData) {
  const { org, supabase } = await ownerContext();
  const role = String(formData.get("role"));
  if (!["owner", "editor", "viewer"].includes(role)) return;
  const userId = String(formData.get("userId"));
  await assertNotSelf(supabase, userId);
  const { data, error } = await supabase.from("memberships").update({ role }).eq("org_id", org.id).eq("user_id", userId).select();
  if (error) throw error;
  if (!data?.length) throw new Error("Member not found or not permitted");
  revalidatePath("/app/settings");
}

export async function removeMember(formData: FormData) {
  const { org, supabase } = await ownerContext();
  const userId = String(formData.get("userId"));
  await assertNotSelf(supabase, userId);
  const { data, error } = await supabase.from("memberships").delete().eq("org_id", org.id).eq("user_id", userId).select();
  if (error) throw error;
  if (!data?.length) throw new Error("Member not found or not permitted");
  revalidatePath("/app/settings");
}

async function assertNotSelf(supabase: Awaited<ReturnType<typeof createClient>>, userId: string) {
  const { data: { user } } = await supabase.auth.getUser();
  if (user?.id === userId) throw new Error("You can't change or remove your own membership");
}
