"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { MoreVertical, Pencil } from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import {
  archiveCanvas,
  deleteCanvas,
  duplicateCanvas,
  restoreCanvas,
} from "@/app/(app)/canvas/actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/** One panel rectangle in canvas coordinates, enough to draw a wireframe. */
export interface CanvasPanelRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CanvasListRow {
  id: string;
  name: string;
  width: number;
  height: number;
  screenCount: number;
  /** Pre-formatted relative time, e.g. "about 2 hours ago". */
  updatedLabel: string;
  isArchived: boolean;
  /** Panel rectangles in draw order (lowest zIndex first). */
  panels: CanvasPanelRect[];
}

export interface CanvasListProps {
  rows: CanvasListRow[];
  showingArchived: boolean;
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
}

/**
 * Canvas index rendered as a card grid. This is a client component because each
 * card owns a confirm dialog and calls the mutation actions directly. The
 * live / archived switch is two links that set the `?archived=1` search param,
 * so the server page runs the matching query and this component only renders
 * whatever set it was handed.
 */
export function CanvasList({
  rows,
  showingArchived,
  canCreate,
  canUpdate,
  canDelete,
}: CanvasListProps) {
  return (
    <div className="space-y-4">
      <div className="flex gap-1 text-sm">
        <ToggleLink href="/canvas" active={!showingArchived}>
          Live
        </ToggleLink>
        <ToggleLink href="/canvas?archived=1" active={showingArchived}>
          Archived
        </ToggleLink>
      </div>

      {rows.length === 0 ? (
        <p className="rounded-panel border border-hairline bg-surface px-4 py-8 text-center text-sm text-body">
          {showingArchived
            ? "No archived canvases."
            : "No canvases yet."}
        </p>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((row) => (
            <CanvasCard
              key={row.id}
              row={row}
              canCreate={canCreate}
              canUpdate={canUpdate}
              canDelete={canDelete}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function ToggleLink({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "rounded-lg px-3 py-1.5 font-medium transition-colors",
        active
          ? "bg-surface text-ink ring-1 ring-hairline"
          : "text-body hover:text-ink",
      )}
    >
      {children}
    </Link>
  );
}

/**
 * A single canvas card: the panel wireframe, the name, its pixel size, how many
 * screens point at it, and when it last changed, plus the row actions. Duplicate,
 * archive and restore refresh the list on success. Delete opens a confirm dialog;
 * a returned `{ error }` (the canvas is still assigned to screens) is shown
 * inline on the card and the card stays put.
 */
function CanvasCard({
  row,
  canCreate,
  canUpdate,
  canDelete,
}: {
  row: CanvasListRow;
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
}) {
  const router = useRouter();
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const [inlineError, setInlineError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  function onDuplicate() {
    startTransition(async () => {
      const result = await duplicateCanvas(row.id);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Canvas duplicated.");
      router.refresh();
    });
  }

  function onArchive() {
    startTransition(async () => {
      const result = await archiveCanvas(row.id);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Canvas archived.");
      router.refresh();
    });
  }

  function onRestore() {
    startTransition(async () => {
      const result = await restoreCanvas(row.id);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Canvas restored.");
      router.refresh();
    });
  }

  function onDelete() {
    setInlineError(null);
    startTransition(async () => {
      const result = await deleteCanvas(row.id);
      if ("error" in result) {
        setInlineError(result.error);
        setConfirmDelete(false);
        return;
      }
      toast.success("Canvas deleted.");
      setConfirmDelete(false);
      router.refresh();
    });
  }

  const hasMenu = canCreate || canUpdate || canDelete;

  return (
    <li className="flex flex-col overflow-hidden rounded-panel border border-hairline bg-surface">
      <Wireframe width={row.width} height={row.height} panels={row.panels} />

      <div className="flex flex-1 flex-col gap-2 p-4">
        <div className="flex items-start justify-between gap-2">
          <p className="min-w-0 truncate font-medium text-ink" title={row.name}>
            {row.name}
          </p>
          {hasMenu ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7"
                  aria-label={`Actions for ${row.name}`}
                >
                  <MoreVertical aria-hidden />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-40">
                {canCreate ? (
                  <DropdownMenuItem
                    disabled={pending}
                    onSelect={() => onDuplicate()}
                  >
                    Duplicate
                  </DropdownMenuItem>
                ) : null}
                {canUpdate ? (
                  row.isArchived ? (
                    <DropdownMenuItem
                      disabled={pending}
                      onSelect={() => onRestore()}
                    >
                      Restore
                    </DropdownMenuItem>
                  ) : (
                    <DropdownMenuItem
                      disabled={pending}
                      onSelect={() => onArchive()}
                    >
                      Archive
                    </DropdownMenuItem>
                  )
                ) : null}
                {canDelete ? (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      variant="destructive"
                      disabled={pending}
                      onSelect={(event) => {
                        event.preventDefault();
                        setConfirmDelete(true);
                      }}
                    >
                      Delete
                    </DropdownMenuItem>
                  </>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>

        <div className="flex flex-wrap gap-x-3 gap-y-1 text-sm text-body">
          <span>{`${row.width} x ${row.height}`}</span>
          <span>
            {`Used by ${row.screenCount} ${row.screenCount === 1 ? "screen" : "screens"}`}
          </span>
          <span>{`Updated ${row.updatedLabel}`}</span>
        </div>

        {inlineError ? (
          <p
            role="alert"
            className="rounded-lg border border-destructive/30 bg-destructive/10 p-2 text-sm text-destructive"
          >
            {inlineError}
          </p>
        ) : null}

        <div className="mt-auto pt-2">
          <Button asChild variant="outline" size="sm">
            <Link href={`/canvas/${row.id}`}>
              <Pencil aria-hidden />
              Edit
            </Link>
          </Button>
        </div>
      </div>

      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {row.name}</DialogTitle>
            <DialogDescription>
              This removes the canvas and its panels for good. A canvas assigned
              to a screen cannot be deleted until that screen points somewhere
              else.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter showCloseButton>
            <Button
              variant="destructive"
              onClick={onDelete}
              disabled={pending}
            >
              {pending ? "Deleting" : "Delete canvas"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </li>
  );
}

/**
 * A to-scale wireframe of the canvas: each panel as an outlined box drawn in
 * canvas coordinates, fit into a fixed-aspect box whose `bg-muted` provides the
 * ground. No media and no frame content, so the list never presigns a URL. The
 * stroke width is derived from the canvas size so it reads the same at any
 * scale.
 */
function Wireframe({
  width,
  height,
  panels,
}: {
  width: number;
  height: number;
  panels: CanvasPanelRect[];
}) {
  const stroke = Math.max(width, height) / 160;
  return (
    <div
      className="w-full border-b border-hairline bg-muted"
      style={{ aspectRatio: `${width} / ${height}`, maxHeight: "12rem" }}
    >
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="xMidYMid meet"
        className="h-full w-full"
        role="img"
        aria-label="Panel layout preview"
      >
        {panels.map((panel, index) => (
          <rect
            key={index}
            x={panel.x}
            y={panel.y}
            width={panel.width}
            height={panel.height}
            className="fill-surface stroke-hairline"
            strokeWidth={stroke}
          />
        ))}
      </svg>
    </div>
  );
}
