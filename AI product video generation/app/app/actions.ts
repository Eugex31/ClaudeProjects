"use server";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { ORG_COOKIE, listMyOrgs } from "@/lib/data/orgs";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export async function switchOrg(orgId: string) {
  const orgs = await listMyOrgs();
  if (!orgs.some((o) => o.id === orgId)) throw new Error("Not a member of that workspace");
  (await cookies()).set(ORG_COOKIE, orgId, { httpOnly: true, sameSite: "lax", path: "/" });
  revalidatePath("/app", "layout");
}

export async function signOut() {
  await (await createClient()).auth.signOut();
  redirect("/login");
}
