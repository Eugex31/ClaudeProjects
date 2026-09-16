import { requireOrg } from "@/lib/auth/context";
import { prisma } from "@/lib/db/root";
import { PageHeader } from "@/components/app/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata = { title: "Settings" };

/**
 * Organization settings overview. Read-only for now: the organization's name and
 * slug plus the signed-in user's role in it. Editing arrives in a later task.
 */
export default async function SettingsPage() {
  const ctx = await requireOrg();
  const org = await prisma.organization.findUnique({
    where: { id: ctx.organizationId },
    select: { name: true, slug: true },
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Organization"
        accent="Settings"
        description="Your organization details and your access level."
      />
      <Card>
        <CardHeader>
          <CardTitle>Organization</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="flex justify-between gap-4">
            <span className="text-body">Name</span>
            <span className="font-medium text-ink">{org?.name ?? "Unknown"}</span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="text-body">Slug</span>
            <span className="font-medium text-ink">{org?.slug ?? "unknown"}</span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="text-body">Your role</span>
            <span className="font-medium text-ink">{ctx.role}</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
