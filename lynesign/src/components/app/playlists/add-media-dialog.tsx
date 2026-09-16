"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Globe, Image as ImageIcon, Video } from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { addItems } from "@/app/(app)/playlists/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export type AddMediaKind = "IMAGE" | "VIDEO" | "WEB";

export interface AddMediaAsset {
  id: string;
  name: string;
  kind: AddMediaKind;
  thumbnailUrl: string | null;
}

export interface AddMediaDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  playlistId: string;
  assets: AddMediaAsset[];
}

const KIND_LABEL: Record<AddMediaKind, string> = {
  IMAGE: "Image",
  VIDEO: "Video",
  WEB: "Web",
};

function KindGlyph({ kind }: { kind: AddMediaKind }) {
  const Icon = kind === "VIDEO" ? Video : kind === "WEB" ? Globe : ImageIcon;
  return <Icon aria-hidden className="size-7 text-muted-foreground" />;
}

/**
 * Controlled picker for adding library assets to the playlist. Selection lives
 * in local state and resets whenever the dialog opens. "Add selected" calls
 * {@link addItems} once with every chosen id, then closes and refreshes.
 */
export function AddMediaDialog({
  open,
  onOpenChange,
  playlistId,
  assets,
}: AddMediaDialogProps) {
  const router = useRouter();
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [wasOpen, setWasOpen] = React.useState(open);
  const [pending, startTransition] = React.useTransition();

  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setSelected(new Set());
  }

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function onAdd() {
    const ids = [...selected];
    if (ids.length === 0) return;
    startTransition(async () => {
      const result = await addItems(playlistId, { mediaAssetIds: ids });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success(
        result.added === 1 ? "Added 1 item." : `Added ${result.added} items.`,
      );
      onOpenChange(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Add media</DialogTitle>
          <DialogDescription>
            Pick the assets to append to the end of this playlist.
          </DialogDescription>
        </DialogHeader>

        {assets.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No ready media in this organization yet.
          </p>
        ) : (
          <div className="grid max-h-[24rem] grid-cols-2 gap-3 overflow-y-auto pr-1 sm:grid-cols-3">
            {assets.map((asset) => {
              const isOn = selected.has(asset.id);
              return (
                <button
                  key={asset.id}
                  type="button"
                  aria-pressed={isOn}
                  aria-label={`Select ${asset.name}`}
                  onClick={() => toggle(asset.id)}
                  className={cn(
                    "flex flex-col overflow-hidden rounded-lg bg-card text-left ring-1 ring-foreground/10 transition-shadow",
                    isOn && "ring-2 ring-primary",
                  )}
                >
                  <span className="flex aspect-video w-full items-center justify-center bg-muted">
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
                  </span>
                  <span className="flex flex-col gap-1 p-2">
                    <span className="truncate text-xs font-medium text-ink" title={asset.name}>
                      {asset.name}
                    </span>
                    <Badge variant="outline">{KIND_LABEL[asset.kind]}</Badge>
                  </span>
                </button>
              );
            })}
          </div>
        )}

        <DialogFooter showCloseButton>
          <Button
            type="button"
            onClick={onAdd}
            disabled={pending || selected.size === 0}
          >
            {pending
              ? "Adding"
              : selected.size === 0
                ? "Add selected"
                : `Add ${selected.size} selected`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
