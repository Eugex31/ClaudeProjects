import { formatDistanceToNow } from "date-fns";
import { LayoutGrid } from "lucide-react";

import { requireRole } from "@/lib/auth/context";
import { can } from "@/lib/rbac/can";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/empty-state";
import { NewCanvasDialog } from "@/components/app/canvas/new-canvas-dialog";
import { CanvasList, type CanvasListRow } from "@/components/app/canvas/canvas-list";

export const metadata = { title: "Canvas" };

/**
 * Canvas index for the active organization. A `?archived=1` search param picks
 * which set the page loads: live canvases (`archivedAt: null`) or archived ones
 * (`archivedAt: { not: null }`). Each row carries just the panel rectangles the
 * list needs for a to-scale wireframe, never frames or media, so no URL is ever
 * presigned here. Everything handed to the client is serializable: the update
 * time is turned into a relative-time label and the archived flag into a
 * boolean, so no `Date` crosses the boundary.
 */
export default async function CanvasPage({
  searchParams,
}: {
  searchParams: Promise<{ archived?: string }>;
}) {
  const ctx = await requireRole("canvas.view");
  const { archived } = await searchParams;
  const showingArchived = archived === "1";

  const canCreate = can(ctx.actor, "canvas.create");
  const canUpdate = can(ctx.actor, "canvas.update");
  const canDelete = can(ctx.actor, "canvas.delete");

  const canvases = await ctx.db.canvas.findMany({
    where: { archivedAt: showingArchived ? { not: null } : null },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      name: true,
      width: true,
      height: true,
      updatedAt: true,
      _count: { select: { screens: true } },
      panels: {
        select: { x: true, y: true, width: true, height: true, zIndex: true },
      },
    },
  });

  const rows: CanvasListRow[] = canvases.map((c) => ({
    id: c.id,
    name: c.name,
    width: c.width,
    height: c.height,
    screenCount: c._count.screens,
    updatedLabel: formatDistanceToNow(c.updatedAt, { addSuffix: true }),
    isArchived: showingArchived,
    panels: [...c.panels]
      .sort((a, b) => a.zIndex - b.zIndex)
      .map((p) => ({ x: p.x, y: p.y, width: p.width, height: p.height })),
  }));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Canvas"
        description="Multi-panel layouts that a screen shows in place of a playlist."
        actions={canCreate ? <NewCanvasDialog /> : null}
      />
      {rows.length === 0 && !showingArchived ? (
        <EmptyState
          icon={LayoutGrid}
          title="No canvases yet"
          description="Create a canvas to arrange panels of media, text, and clocks on one screen."
          action={canCreate ? <NewCanvasDialog /> : null}
        />
      ) : (
        <CanvasList
          rows={rows}
          showingArchived={showingArchived}
          canCreate={canCreate}
          canUpdate={canUpdate}
          canDelete={canDelete}
        />
      )}
    </div>
  );
}
