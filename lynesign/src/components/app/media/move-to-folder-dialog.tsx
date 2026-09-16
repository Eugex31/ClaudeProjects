"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { updateAsset } from "@/app/(app)/media/actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";

export interface FolderOption {
  id: string;
  name: string;
  /** Nesting level, for indenting the option label. */
  depth: number;
}

export interface MoveToFolderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** One or more assets to move together. */
  assetIds: string[];
  folders: FolderOption[];
  currentFolderId: string | null;
  onDone?: () => void;
}

const SELECT_CLASS =
  "h-8 w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

/**
 * Controlled dialog that reparents one or more assets. Calls {@link updateAsset}
 * once per id with the chosen `folderId` (empty selection means the root). Any
 * per-asset error is surfaced as a toast; a clean run refreshes the page.
 */
export function MoveToFolderDialog({
  open,
  onOpenChange,
  assetIds,
  folders,
  currentFolderId,
  onDone,
}: MoveToFolderDialogProps) {
  const router = useRouter();
  const [target, setTarget] = React.useState<string>(currentFolderId ?? "");
  const [wasOpen, setWasOpen] = React.useState(open);
  const [pending, startTransition] = React.useTransition();

  // Reset the selection each time the dialog transitions to open.
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setTarget(currentFolderId ?? "");
  }

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (assetIds.length === 0) {
      onOpenChange(false);
      return;
    }
    startTransition(async () => {
      const folderId = target === "" ? null : target;
      const results = await Promise.all(
        assetIds.map((id) => updateAsset(id, { folderId })),
      );
      const failure = results.find((r) => r.error);
      if (failure?.error) {
        toast.error(failure.error);
        return;
      }
      toast.success(
        assetIds.length === 1 ? "Item moved." : `${assetIds.length} items moved.`,
      );
      onOpenChange(false);
      onDone?.();
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {assetIds.length === 1 ? "Move item" : `Move ${assetIds.length} items`}
          </DialogTitle>
          <DialogDescription>
            Pick the folder these items should live in.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="move-target">Folder</Label>
            <select
              id="move-target"
              value={target}
              onChange={(event) => setTarget(event.target.value)}
              className={SELECT_CLASS}
            >
              <option value="">All media (root)</option>
              {folders.map((folder) => (
                <option key={folder.id} value={folder.id}>
                  {`${"\u00a0\u00a0".repeat(folder.depth)}${folder.name}`}
                </option>
              ))}
            </select>
          </div>
          <DialogFooter showCloseButton>
            <Button type="submit" disabled={pending}>
              {pending ? "Moving" : "Move"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
