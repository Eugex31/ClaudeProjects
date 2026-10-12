import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { modelUrlFor, newestModel } from "@/lib/data/assets";
import { ProjectEditor } from "@/components/ProjectEditor";
import { MissingModel } from "@/components/MissingModel";
import { canEdit } from "@/lib/roles";
import { cleanStoredStoryboard } from "@/lib/storyboard/validate";

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: project } = await supabase
    .from("projects")
    .select("id, name, language, status, share_token, org_id, storyboards(parts, steps, manual_text, updated_at), assets(kind, storage_path, created_at)")
    .eq("id", id).maybeSingle();
  if (!project || !user) notFound();
  const { data: membership } = await supabase.from("memberships").select("role")
    .eq("org_id", project.org_id).eq("user_id", user.id).maybeSingle();
  if (!membership) notFound();
  const sb = Array.isArray(project.storyboards) ? project.storyboards[0] : project.storyboards;
  const { parts, steps } = cleanStoredStoryboard(sb);
  const model = newestModel(project.assets);
  const modelUrl = model ? await modelUrlFor(supabase, model.storage_path).catch(() => null) : null;
  if (!modelUrl) return <MissingModel project={{ id: project.id, name: project.name }} editable={canEdit(membership.role)} />;
  return (
    <ProjectEditor
      project={{ id: project.id, name: project.name, language: project.language, status: project.status, share_token: project.share_token, org_id: project.org_id }}
      role={membership.role}
      parts={parts}
      steps={steps}
      manualText={sb?.manual_text ?? ""}
      modelUrl={modelUrl}
      storyboardUpdatedAt={sb?.updated_at ?? new Date(0).toISOString()}
    />
  );
}
