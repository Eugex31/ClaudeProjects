import { MapPin } from "lucide-react";

import { requireOrg } from "@/lib/auth/context";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/empty-state";
import { DataTable } from "@/components/app/data-table";
import { LocationForm } from "@/components/app/location-form";

export const metadata = { title: "Locations" };

interface LocationRow {
  id: string;
  name: string;
  parentName: string;
  timeZone: string;
  screens: number;
}

/**
 * Locations list for the active organization. Reads through the tenant facade,
 * so every row (and its screen count) is scoped to the caller's org. Managers
 * and up get an "Add location" dialog; the plan's location ceiling is enforced
 * server-side by the create action.
 */
export default async function LocationsPage() {
  const ctx = await requireOrg();

  const locations = await ctx.db.location.findMany({
    orderBy: { name: "asc" },
    include: {
      parent: { select: { name: true } },
      _count: { select: { screens: true } },
    },
  });

  const rows: LocationRow[] = locations.map((location) => ({
    id: location.id,
    name: location.name,
    parentName: location.parent?.name ?? "None",
    timeZone: location.timeZone,
    screens: location._count.screens,
  }));

  const parents = locations.map((location) => ({
    id: location.id,
    name: location.name,
  }));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Locations"
        description="Group your screens by site so schedules and reporting follow the physical layout of your network."
        actions={<LocationForm parents={parents} />}
      />

      {rows.length === 0 ? (
        <EmptyState
          icon={MapPin}
          title="No locations yet"
          description="Add your first location to group your screens by site."
          action={<LocationForm parents={parents} />}
        />
      ) : (
        <DataTable<LocationRow>
          columns={[
            { key: "name", header: "Name", sortable: true },
            { key: "parentName", header: "Parent", sortable: true },
            { key: "timeZone", header: "Time zone", sortable: true },
            { key: "screens", header: "Screens", sortable: true },
          ]}
          rows={rows}
        />
      )}
    </div>
  );
}
