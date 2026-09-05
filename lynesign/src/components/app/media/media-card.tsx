"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Globe, Image as ImageIcon, MoreVertical, Video } from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { formatBytes } from "@/lib/format";
import { deleteAssets, updateAsset } from "@/app/(app)/media/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { MediaPreviewDialog } from "@/components/app/media/media-preview-dialog";
import { MoveToFolderDialog, type FolderOption } from "@/components/app/media/move-to-folder-dialog";
import { TagEditor } from "@/components/app/media/tag-editor";

export type MediaCardKind = "IMAGE" | "VIDEO" | "WEB";
export type MediaCardStatus = "UPLOADING" | "READY" | "FAILED";

export interface MediaCardAsset {
  id: string;
  name: string;
  kind: MediaCardKind;
  status: MediaCardStatus;
  /** Byte size as a base-10 string (bigint does not cross the RSC boundary). */
  sizeBytes: string;
  mimeType: string | null;
  /** Pre-signed thumbnail URL, or null when there is nothing to show yet. */
  thumbnailUrl: string | null;
  width: number | null;
  height: number | null;
  durationSeconds: number | null;
  url: string | null;
  tags: string[];
  /** Count of pictures + videos that reference this asset. */
  usedCount: number;
  /** Pre-formatted relative time, e.g. "2 days ago". */
  createdAtLabel: string;
}

export interface MediaCardProps {
  asset: MediaCardAsset;
  folders: FolderOption[];
  currentFolderId?: string | null;
  canUpdate: boolean;
  canDelete: boolean;
  canManageFolders: boolean;
  selected: boolean;
  onToggleSelected: (id: string) => void;
}

const KIND_LABEL: Record<MediaCardKind, string> = {
  IMAGE: "Image",
  VIDEO: "Video",
  WEB: "Web",
};

const STATUS_LABEL: Record<MediaCardStatus, string> = {
  UPLOADING: "Uploading",
  READY: "Ready",
  FAILED: "Failed",
};

function KindGlyph({ kind }: { kind: MediaCardKind }) {
  const Icon = kind === "VIDEO" ? Video : kind === "WEB" ? Globe : ImageIcon;
  return <Icon aria-hidden className="size-8 text-muted-foreground" />;
}

/**
 * One tile in the media grid. The page pre-signs `thumbnailUrl`; when it is null
 * a kind glyph stands in. The dropdown exposes Preview always, and Rename / Move
 * / Tags when `canUpdate`, and Delete when `canDelete`. Rename, Move, Tags and
 * the preview are all owned here as controlled dialogs, so no function prop ever
 * has to cross from the server page.
 */
export function MediaCard({
  asset,
  folders,
  currentFolderId = null,
  canUpdate,
  canDelete,
  selected,
  onToggleSelected,
}: MediaCardProps) {
  const router = useRouter();
  const [preview, setPreview] = React.useState(false);
  const [renaming, setRenaming] = React.useState(false);
  const [moving, setMoving] = React.useState(false);
  const [tagging, setTagging] = React.useState(false);
  const [name, setName] = React.useState(asset.name);
  const [pending, startTransition] = React.useTransition();

  function submitRename(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next = name.trim();
    if (!next || next === asset.name) {
      setRenaming(false);
      return;
    }
    startTransition(async () => {
      const result = await updateAsset(asset.id, { name: next });
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success("Name updated.");
      setRenaming(false);
      router.refresh();
    });
  }

  function onDelete() {
    startTransition(async () => {
      const result = await deleteAssets([asset.id]);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(`${result.archived} moved to trash.`);
      router.refresh();
    });
  }

  return (
    <div
      className={cn(
        "group relative flex flex-col overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10",
        selected && "ring-2 ring-primary",
      )}
    >
      <div className="absolute left-2 top-2 z-10">
        <Checkbox
          checked={selected}
          onCheckedChange={() => onToggleSelected(asset.id)}
          aria-label={`Select ${asset.name}`}
          className={cn(
            "bg-surface/90",
            !selected && "opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100",
          )}
        />
      </div>

      <div className="absolute right-2 top-2 z-10">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-7 bg-surface/90"
              aria-label={`Actions for ${asset.name}`}
            >
              <MoreVertical aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-40">
            <DropdownMenuItem onSelect={() => setPreview(true)}>Preview</DropdownMenuItem>
            {canUpdate ? (
              <>
                <DropdownMenuItem onSelect={() => setRenaming(true)}>Rename</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setMoving(true)}>Move</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setTagging(true)}>Tags</DropdownMenuItem>
              </>
            ) : null}
            {canDelete ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  variant="destructive"
                  disabled={pending}
                  onSelect={(event) => {
                    event.preventDefault();
                    onDelete();
                  }}
                >
                  Delete
                </DropdownMenuItem>
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <button
        type="button"
        onClick={() => setPreview(true)}
        aria-label={`Preview ${asset.name}`}
        className="flex aspect-video w-full items-center justify-center bg-muted"
      >
        {asset.thumbnailUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={asset.thumbnailUrl}
            alt={asset.name}
            className="size-full object-cover"
          />
        ) : (
          <KindGlyph kind={asset.kind} />
        )}
      </button>

      <div className="flex flex-1 flex-col gap-1.5 p-3">
        <p className="truncate text-sm font-medium text-ink" title={asset.name}>
          {asset.name}
        </p>
        <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          <Badge variant="outline">{KIND_LABEL[asset.kind]}</Badge>
          {asset.kind !== "WEB" ? <span>{formatBytes(BigInt(asset.sizeBytes))}</span> : null}
          {asset.status !== "READY" ? (
            <Badge variant={asset.status === "FAILED" ? "destructive" : "secondary"}>
              {STATUS_LABEL[asset.status]}
            </Badge>
          ) : null}
          {asset.usedCount > 0 ? (
            <Badge variant="secondary">Used in {asset.usedCount}</Badge>
          ) : null}
        </div>
      </div>

      <MediaPreviewDialog open={preview} onOpenChange={setPreview} asset={asset} />

      <MoveToFolderDialog
        open={moving}
        onOpenChange={setMoving}
        assetIds={[asset.id]}
        folders={folders}
        currentFolderId={currentFolderId}
      />

      <TagEditor
        open={tagging}
        onOpenChange={setTagging}
        assetId={asset.id}
        assetName={asset.name}
        tags={asset.tags}
      />

      <Dialog
        open={renaming}
        onOpenChange={(next) => {
          setRenaming(next);
          if (!next) setName(asset.name);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename item</DialogTitle>
            <DialogDescription>Give this item a clearer name.</DialogDescription>
          </DialogHeader>
          <form onSubmit={submitRename} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor={`rename-${asset.id}`}>Name</Label>
              <Input
                id={`rename-${asset.id}`}
                value={name}
                onChange={(event) => setName(event.target.value)}
                autoFocus
                required
                maxLength={200}
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
    </div>
  );
}
