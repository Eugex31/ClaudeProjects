import Link from "next/link";
import { canEdit, getCurrentOrg } from "@/lib/data/orgs";
import { createClient } from "@/lib/supabase/server";

export default async function ProjectsPage() {
  const org = await getCurrentOrg();
  const supabase = await createClient();
  const { data: projects } = await supabase
    .from("projects").select("id, name, status, language, updated_at")
    .eq("org_id", org.id).order("updated_at", { ascending: false });
  return (
    <section>
      <div className="mb-4 flex items-center">
        <h1 className="text-xl font-semibold">Projects</h1>
        {canEdit(org.role) && <Link href="/app/projects/new" className="ml-auto rounded bg-black px-3 py-1.5 text-white">New project</Link>}
      </div>
      {projects?.length ? (
        <ul className="divide-y rounded border">
          {projects.map((p) => (
            <li key={p.id}>
              <Link href={`/app/projects/${p.id}`} className="flex gap-4 p-3 hover:bg-gray-50">
                <span className="font-medium">{p.name}</span>
                <span className="text-sm uppercase text-gray-500">{p.language}</span>
                <span className={`ml-auto text-sm ${p.status === "approved" ? "text-green-700" : "text-amber-700"}`}>{p.status}</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : <p className="text-gray-600">No projects yet.</p>}
    </section>
  );
}
