import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { currentPeriod } from "@/lib/quota";
import { generateSteps } from "@/lib/ai/generate";
import { runGeneration, type GenerationContext } from "@/lib/ai/runGeneration";

export const maxDuration = 300;

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const period = currentPeriod();
  const { data: project } = await supabase
    .from("projects").select("id, org_id, language, organizations(monthly_generation_quota)").eq("id", id).maybeSingle();

  let ctx: GenerationContext | null = null;
  if (project) {
    const [{ data: membership }, { data: usage }, { data: sb }] = await Promise.all([
      supabase.from("memberships").select("role").eq("org_id", project.org_id).eq("user_id", user.id).single(),
      supabase.from("usage").select("generations").eq("org_id", project.org_id).eq("period", period).maybeSingle(),
      supabase.from("storyboards").select("parts, manual_text").eq("project_id", id).single(),
    ]);
    if (!membership) return NextResponse.json({ error: "You are not a member of this workspace." }, { status: 403 });
    if (!sb) return NextResponse.json({ error: "Storyboard not found." }, { status: 404 });
    const org = Array.isArray(project.organizations) ? project.organizations[0] : project.organizations;
    ctx = {
      role: membership.role,
      quota: org?.monthly_generation_quota ?? 0,
      used: usage?.generations ?? 0,
      language: project.language,
      parts: sb.parts ?? [],
      manualText: sb.manual_text ?? "",
      aiConfigured: Boolean(process.env.ANTHROPIC_API_KEY),
    };
  }

  const result = await runGeneration(ctx, {
    generate: (input) => generateSteps(input),
    saveSteps: async (steps) => {
      const { data, error } = await supabase.from("storyboards").update({ steps }).eq("project_id", id).select("project_id");
      if (error || !data || data.length === 0) throw error ?? new Error("Storyboard could not be saved");
    },
    incrementUsage: async () => {
      const { error } = await createAdminClient().rpc("increment_usage", { target_org: project!.org_id, target_period: period });
      if (error) console.error("usage increment failed", error);
    },
  });
  const { status, ...body } = result;
  return NextResponse.json(body, { status });
}
