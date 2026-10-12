"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ORG_COOKIE } from "@/lib/data/orgs";

export async function acceptInvite(token: string) {
  const supabase = await createClient();
  const { data: orgId, error } = await supabase.rpc("accept_invite", { invite_token: token });
  if (error) redirect(`/invite/${token}?error=${encodeURIComponent(error.message)}`);
  (await cookies()).set(ORG_COOKIE, orgId as string, { httpOnly: true, sameSite: "lax", path: "/" });
  redirect("/app");
}
