"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Folder, ImagePlus, MoreVertical } from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import {
  deleteAssets,
  deleteFolder,
  finalizeUpload,
  renameFolder,
  requestUpload,
} from "@/app/(app)/media/actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EmptyState } from "@/components/app/empty-state";
import { FolderCrumbs, type Crumb } from "@/components/app/media/folder-crumbs";
import { MediaCard, type MediaCardAsset } from "@/components/app/media/media-card";
import { MediaToolbar } from "@/components/app/media/media-toolbar";
import { MoveToFolderDialog, type FolderOption } from "@/components/app/media/move-to-folder-dialog";
import { UploadQueue, type UploadRow } from "@/components/app/media/upload-queue";

export interface ChildFolder {
  id: string;
  name: string;
  assetCount: number;
  subfolderCount: number;
}

export interface MediaLibraryQuery {
  q: string;
  kind: string;
  sort: string;
  page: number;
  hasMore: boolean;
}

export interface MediaLibraryProps {
  currentFolderId: string | null;
  crumbs: Crumb[];
  childFolders: ChildFolder[];
  assets: MediaCardAsset[];
  allFolders: FolderOption[];
  query: MediaLibraryQuery;
  canCreate: boolean;
  canDelete: boolean;
  canUpdate: boolean;
  canManageFolders: boolean;
}

const UPLOAD_CONCURRENCY = 3;

/**
 * Client shell for the media library. Owns the drag-and-drop upload pipeline
 * and its progress queue, multi-select and the bulk action bar, the folder
 * grid, the asset grid and pagination. Everything interactive lives here so the
 * server page only ever passes serializable data.
 */
export function MediaLibrary({
  currentFolderId,
  crumbs,
  childFolders,
  assets,
  allFolders,
  query,
  canCreate,
  canDelete,
  canUpdate,
  canManageFolders,
}: MediaLibraryProps) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const [rawSelected, setSelected] = React.useState<Set<string>>(new Set());
  const [uploads, setUploads] = React.useState<UploadRow[]>([]);
  const [dragOver, setDragOver] = React.useState(false);
  const [bulkMove, setBulkMove] = React.useState(false);

  // Ignore any selected id that is no longer on the page (e.g. after a refresh
  // that dropped a deleted asset). Derived, so no reconciliation effect.
  const selected = React.useMemo(() => {
    const live = new Set(assets.map((a) => a.id));
    return new Set([...rawSelected].filter((id) => live.has(id)));
  }, [assets, rawSelected]);

  function toggleSelected(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function patchRow(id: string, patch: Partial<UploadRow>) {
    setUploads((rows) => rows.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  }

  async function putWithProgress(
    url: string,
    headers: Record<string, string>,
    file: File,
    rowId: string,
  ): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const xhr = new XMLHttpRequest();
      xhr.open("PUT", url);
      for (const [key, value] of Object.entries(headers)) {
        xhr.setRequestHeader(key, value);
      }
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) {
          patchRow(rowId, { pct: Math.round((event.loaded / event.total) * 100) });
        }
      };
      xhr.onload = () => resolve(xhr.status >= 200 && xhr.status < 300);
      xhr.onerror = () => resolve(false);
      xhr.send(file);
    });
  }

  async function uploadOne(file: File, rowId: string) {
    try {
      const requested = await requestUpload({
        folderId: currentFolderId ?? undefined,
        filename: file.name,
        mimeType: file.type,
        sizeBytes: file.size,
      });
      if ("error" in requested) {
        patchRow(rowId, { status: "failed", message: "Rejected" });
        toast.error(requested.error);
        return;
      }

      const ok = await putWithProgress(
        requested.upload.url,
        requested.upload.headers,
        file,
        rowId,
      );
      if (!ok) {
        patchRow(rowId, { status: "failed", message: "Failed" });
        toast.error("That upload could not be sent.");
        return;
      }

      patchRow(rowId, { status: "finalizing", pct: 100 });
      const result = await finalizeUpload(requested.assetId);
      if (result.status === "FAILED") {
        patchRow(rowId, { status: "failed", message: "Failed" });
        toast.error("That upload could not be verified.");
        return;
      }

      patchRow(rowId, { status: "done", pct: 100 });
      if (result.duplicateOf) {
        toast.info("Looks like a copy of an existing asset.");
      }
    } catch {
      patchRow(rowId, { status: "failed", message: "Failed" });
      toast.error("That upload could not be completed.");
    }
  }

  async function handleFiles(list: FileList | null) {
    if (!list || list.length === 0) return;
    const files = Array.from(list);
    const rows: UploadRow[] = files.map((file, index) => ({
      id: `${Date.now()}-${index}-${file.name}`,
      name: file.name,
      pct: 0,
      status: "uploading",
    }));
    setUploads((current) => [...current, ...rows]);

    let cursor = 0;
    async function worker() {
      while (cursor < files.length) {
        const index = cursor++;
        await uploadOne(files[index], rows[index].id);
      }
    }
    try {
      await Promise.all(
        Array.from({ length: Math.min(UPLOAD_CONCURRENCY, files.length) }, worker),
      );
    } finally {
      router.refresh();
    }
  }

  function onDrop(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragOver(false);
    if (!canCreate) return;
    void handleFiles(event.dataTransfer.files);
  }

  function bulkDelete() {
    const ids = [...selected];
    if (ids.length === 0) return;
    void deleteAssets(ids)
      .then((result) => {
        if (result.error) {
          toast.error(result.error);
          return;
        }
        toast.success(`${result.archived} moved to trash.`);
        setSelected(new Set());
        router.refresh();
      })
      .catch(() => toast.error("That delete could not be completed."));
  }

  function pageHref(page: number): string {
    const next = new URLSearchParams(params.toString());
    if (page <= 1) next.delete("page");
    else next.set("page", String(page));
    const qs = next.toString();
    return qs ? `${pathname}?${qs}` : pathname;
  }

  const nothingHere = childFolders.length === 0 && assets.length === 0;
  const filtered = query.q !== "" || query.kind !== "";

  return (
    <div className="space-y-4">
      <FolderCrumbs crumbs={crumbs} />

      <MediaToolbar
        q={query.q}
        kind={query.kind}
        sort={query.sort}
        canCreate={canCreate}
        canManageFolders={canManageFolders}
        parentId={currentFolderId}
        onUpload={() => fileInputRef.current?.click()}
      />

      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="image/png,image/jpeg,image/webp,image/gif,video/mp4,video/webm"
        className="hidden"
        onChange={(event) => {
          void handleFiles(event.target.files);
          event.target.value = "";
        }}
      />

      <UploadQueue rows={uploads} onDismiss={() => setUploads([])} />

      {selected.size > 0 ? (
        <div className="flex flex-wrap items-center gap-3 rounded-panel border border-hairline bg-surface px-4 py-2 text-sm">
          <span className="font-medium text-ink">{selected.size} selected</span>
          <div className="ml-auto flex items-center gap-2">
            {canUpdate ? (
              <Button variant="outline" size="sm" onClick={() => setBulkMove(true)}>
                Move
              </Button>
            ) : null}
            {canDelete ? (
              <Button variant="destructive" size="sm" onClick={bulkDelete}>
                Delete
              </Button>
            ) : null}
            <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
              Clear
            </Button>
          </div>
        </div>
      ) : null}

      <div
        onDragOver={(event) => {
          if (!canCreate) return;
          event.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        className={cn(
          "rounded-panel border border-dashed border-transparent transition-colors",
          dragOver && "border-primary bg-primary/5",
        )}
      >
        {nothingHere ? (
          <EmptyState
            icon={ImagePlus}
            title={filtered ? "Nothing matches" : "No media here yet"}
            description={
              filtered
                ? "Try a different search or filter."
                : canCreate
                  ? "Drag files here or use Upload to add images and videos."
                  : "Media added by your team will show up here."
            }
          />
        ) : (
          <div className="space-y-6">
            {childFolders.length > 0 ? (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                {childFolders.map((folder) => (
                  <FolderTile
                    key={folder.id}
                    folder={folder}
                    href={folderHref(params, pathname, folder.id)}
                    canManage={canManageFolders}
                  />
                ))}
              </div>
            ) : null}

            {assets.length > 0 ? (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                {assets.map((asset) => (
                  <MediaCard
                    key={asset.id}
                    asset={asset}
                    folders={allFolders}
                    currentFolderId={currentFolderId}
                    canUpdate={canUpdate}
                    canDelete={canDelete}
                    canManageFolders={canManageFolders}
                    selected={selected.has(asset.id)}
                    onToggleSelected={toggleSelected}
                  />
                ))}
              </div>
            ) : null}
          </div>
        )}
      </div>

      {(query.page > 1 || query.hasMore) && assets.length > 0 ? (
        <div className="flex items-center justify-between">
          {query.page > 1 ? (
            <Button asChild variant="outline" size="sm">
              <Link href={pageHref(query.page - 1)}>Previous</Link>
            </Button>
          ) : (
            <Button variant="outline" size="sm" disabled>
              Previous
            </Button>
          )}
          <span className="text-sm text-muted-foreground">Page {query.page}</span>
          {query.hasMore ? (
            <Button asChild variant="outline" size="sm">
              <Link href={pageHref(query.page + 1)}>Next</Link>
            </Button>
          ) : (
            <Button variant="outline" size="sm" disabled>
              Next
            </Button>
          )}
        </div>
      ) : null}

      <MoveToFolderDialog
        open={bulkMove}
        onOpenChange={setBulkMove}
        assetIds={[...selected]}
        folders={allFolders}
        currentFolderId={currentFolderId}
        onDone={() => setSelected(new Set())}
      />
    </div>
  );
}

function folderHref(
  params: URLSearchParams,
  pathname: string,
  folderId: string,
): string {
  const next = new URLSearchParams(params.toString());
  next.set("folder", folderId);
  next.delete("page");
  return `${pathname}?${next.toString()}`;
}

function FolderTile({
  folder,
  href,
  canManage,
}: {
  folder: ChildFolder;
  href: string;
  canManage: boolean;
}) {
  const router = useRouter();
  const [renaming, setRenaming] = React.useState(false);
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const [name, setName] = React.useState(folder.name);
  const [pending, startTransition] = React.useTransition();

  function submitRename(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next = name.trim();
    if (!next || next === folder.name) {
      setRenaming(false);
      return;
    }
    startTransition(async () => {
      const result = await renameFolder(folder.id, next);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success("Folder renamed.");
      setRenaming(false);
      router.refresh();
    });
  }

  function onDelete() {
    startTransition(async () => {
      const result = await deleteFolder(folder.id);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success("Folder deleted.");
      setConfirmDelete(false);
      router.refresh();
    });
  }

  return (
    <div className="group relative flex items-center gap-3 rounded-xl bg-card p-3 ring-1 ring-foreground/10">
      <Link href={href} className="flex min-w-0 flex-1 items-center gap-3">
        <span className="flex size-9 items-center justify-center rounded-lg bg-muted text-muted-foreground">
          <Folder aria-hidden className="size-4" />
        </span>
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium text-ink">{folder.name}</span>
          <span className="block text-xs text-muted-foreground">
            {folder.assetCount} {folder.assetCount === 1 ? "item" : "items"}
            {folder.subfolderCount > 0 ? `, ${folder.subfolderCount} folders` : ""}
          </span>
        </span>
      </Link>

      {canManage ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              aria-label={`Actions for folder ${folder.name}`}
            >
              <MoreVertical aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-36">
            <DropdownMenuItem onSelect={() => setRenaming(true)}>Rename</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              onSelect={(event) => {
                event.preventDefault();
                setConfirmDelete(true);
              }}
            >
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}

      <Dialog
        open={renaming}
        onOpenChange={(next) => {
          setRenaming(next);
          if (!next) setName(folder.name);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename folder</DialogTitle>
            <DialogDescription>Names must be unique within the parent folder.</DialogDescription>
          </DialogHeader>
          <form onSubmit={submitRename} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor={`folder-rename-${folder.id}`}>Name</Label>
              <Input
                id={`folder-rename-${folder.id}`}
                value={name}
                onChange={(event) => setName(event.target.value)}
                autoFocus
                required
                maxLength={120}
              />
            </div>
            <DialogFooter showCloseButton>
              <Button type="submit" disabled={pending}>
                {pending ? "Saving" : "Save name"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {folder.name}</DialogTitle>
            <DialogDescription>
              Items inside move up to the parent folder. Nested folders are removed.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter showCloseButton>
            <Button variant="destructive" onClick={onDelete} disabled={pending}>
              {pending ? "Deleting" : "Delete folder"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
