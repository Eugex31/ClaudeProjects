"use client";

import * as React from "react";
import type { ScreenStatus } from "@prisma/client";

import { DataTable, type DataTableColumn } from "@/components/app/data-table";
import { StatusDot } from "@/components/app/status-dot";
import { Button } from "@/components/ui/button";
import { ScreenContentSourceDialog } from "@/components/app/screens/screen-content-source-dialog";
import { ScreenPreviewDialog } from "@/components/app/screens/screen-preview-dialog";

export interface ScreenTableRow {
  id: string;
  name: string;
  locationName: string;
  status: ScreenStatus;
  lastSeen: string;
  playlistId: string | null;
  canvasId: string | null;
  playlistName: string | null;
  canvasName: string | null;
}

interface NamedRow {
  id: string;
  name: string;
}

export interface ScreensTableProps {
  rows: ScreenTableRow[];
  playlists: NamedRow[];
  canvases: NamedRow[];
  canUpdate: boolean;
}

/** Canvas first, to match `resolveScreenContent`, which checks the canvas tier
 * before the base playlist. The two ids are meant to be mutually exclusive; if a
 * legacy row still carries both, the label names the one the screen actually
 * plays. */
function contentSourceLabel(row: ScreenTableRow): string {
  if (row.canvasId) return `Canvas: ${row.canvasName ?? "Unknown"}`;
  if (row.playlistId) return `Playlist: ${row.playlistName ?? "Unknown"}`;
  return "None";
}

/**
 * Trigger plus dialog for switching one screen's content source. Kept as its own
 * component so each row owns its open state; the dialog itself lives in
 * {@link ScreenContentSourceDialog}.
 */
function ContentSourceAction({
  row,
  playlists,
  canvases,
}: {
  row: ScreenTableRow;
  playlists: NamedRow[];
  canvases: NamedRow[];
}) {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        Change
      </Button>
      <ScreenContentSourceDialog
        open={open}
        onOpenChange={setOpen}
        screen={{
          id: row.id,
          name: row.name,
          playlistId: row.playlistId,
          canvasId: row.canvasId,
        }}
        playlists={playlists}
        canvases={canvases}
      />
    </>
  );
}

/**
 * Trigger plus dialog for previewing what one screen is playing right now. Its
 * own component so each row owns its open state; `screen.view` is in the `ALL`
 * group, so this shows for every row regardless of `canUpdate`.
 */
function PreviewAction({ row }: { row: ScreenTableRow }) {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        Preview
      </Button>
      <ScreenPreviewDialog
        open={open}
        onOpenChange={setOpen}
        screenId={row.id}
        screenName={row.name}
      />
    </>
  );
}

/**
 * Client wrapper for the screens list. The status and content-source columns'
 * `render` are functions, and a Server Component cannot hand a function across
 * the boundary to the `"use client"` {@link DataTable} -- in a production build
 * that throws "Functions cannot be passed directly to Client Components" while
 * the page's RSC payload is serialized. Declaring the columns in this client
 * module keeps the closures on the client side.
 */
export function ScreensTable({
  rows,
  playlists,
  canvases,
  canUpdate,
}: ScreensTableProps) {
  const columns: DataTableColumn<ScreenTableRow>[] = [
    { key: "name", header: "Name", sortable: true },
    { key: "locationName", header: "Location", sortable: true },
    {
      key: "status",
      header: "Status",
      sortable: true,
      render: (row) => <StatusDot status={row.status} />,
    },
    {
      key: "contentSource",
      header: "Content source",
      render: (row) => contentSourceLabel(row),
    },
    { key: "lastSeen", header: "Last seen" },
    {
      key: "rowActions",
      header: "",
      render: (row) => (
        <div className="flex items-center justify-end gap-1.5">
          <PreviewAction row={row} />
          {canUpdate ? (
            <ContentSourceAction
              row={row}
              playlists={playlists}
              canvases={canvases}
            />
          ) : null}
        </div>
      ),
    },
  ];

  return <DataTable<ScreenTableRow> columns={columns} rows={rows} />;
}
