import { redirect } from "next/navigation";
import { canEdit, getCurrentOrg } from "@/lib/data/orgs";
import { NewProjectForm } from "./NewProjectForm";

export default async function NewProjectPage() {
  const org = await getCurrentOrg();
  if (!canEdit(org.role)) redirect("/app");
  return <NewProjectForm orgId={org.id} />;
}
