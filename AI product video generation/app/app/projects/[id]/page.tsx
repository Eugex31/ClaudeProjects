import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { modelUrlFor } from "@/lib/data/assets";
import { Editor } from "@/components/Editor";

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: project } = await supabase
    .from("projects")
    .select("id, name, language, status, share_token, org_id, storyboards(parts, steps, manual_text), assets(kind, storage_path, created_at)")
    .eq("id", id).maybeSingle();
  if (!project || !user) notFound();
  const { data: membership } = await supabase.from("memberships").select("role")
    .eq("org_id", project.org_id).eq("user_id", user.id).maybeSingle();
  if (!membership) notFound();
  const sb = Array.isArray(project.storyboards) ? project.storyboards[0] : project.storyboards;
  const model = [...project.assets]
    .filter((a: { kind: string }) => a.kind === "model")
    .sort((a: { created_at: string }, b: { created_at: string }) => b.created_at.localeCompare(a.created_at))[0];
  if (!model) return <p>This project has no model. Delete it and create it again.</p>;
  const modelUrl = await modelUrlFor(supabase, model.storage_path);
  return (
    <Editor
      project={{ id: project.id, name: project.name, language: project.language, status: project.status, share_token: project.share_token, org_id: project.org_id }}
      role={membership.role}
      parts={sb?.parts ?? []}
      steps={sb?.steps ?? []}
      manualText={sb?.manual_text ?? ""}
      modelUrl={modelUrl}
    />
  );
}
