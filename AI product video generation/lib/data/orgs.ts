import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type Role = "owner" | "editor" | "viewer";
export type OrgSummary = { id: string; name: string; role: Role; plan: string; monthly_generation_quota: number };
export const ORG_COOKIE = "stepreel_org";
export const canEdit = (role: Role) => role === "owner" || role === "editor";

export async function listMyOrgs(): Promise<OrgSummary[]> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data, error } = await supabase
    .from("memberships")
    .select("role, organizations(id, name, plan, monthly_generation_quota)")
    .eq("user_id", user.id);
  if (error) throw error;
  return (data ?? []).map((m: any) => ({ ...m.organizations, role: m.role }));
}

export async function getCurrentOrg(provided?: OrgSummary[]): Promise<OrgSummary> {
  const orgs = provided ?? await listMyOrgs();
  if (orgs.length === 0) throw new Error("Your account has no workspace. Contact support.");
  const wanted = (await cookies()).get(ORG_COOKIE)?.value;
  return orgs.find((o) => o.id === wanted) ?? orgs[0];
}
