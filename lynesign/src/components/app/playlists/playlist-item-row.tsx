"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, Globe, Image as ImageIcon, Trash2, Video } from "lucide-react";
import { toast } from "sonner";

import {
  removeItem,
  setItemDuration,
  setItemEnabled,
} from "@/app/(app)/playlists/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";

export type PlaylistItemKind = "IMAGE" | "VIDEO" | "WEB";
export type PlaylistItemStatus = "UPLOADING" | "READY" | "FAILED";

export interface PlaylistRowItem {
  id: string;
  position: number;
  /** Per-item override in seconds, or null when the playlist default applies. */
  durationSeconds: number | null;
  enabled: boolean;
  /** Seconds this item actually plays, resolved server-side. */
  resolvedDurationSeconds: number;
  mediaAsset: {
    id: string;
    name: string;
    kind: PlaylistItemKind;
    status: PlaylistItemStatus;
    isArchived: boolean;
    thumbnailUrl: string | null;
  };
}

export interface PlaylistItemRowProps {
  item: PlaylistRowItem;
  canUpdate: boolean;
  isFirst: boolean;
  isLast: boolean;
  onMove: (itemId: string, direction: "up" | "down") => void;
}

const KIND_LABEL: Record<PlaylistItemKind, string> = {
  IMAGE: "Image",
  VIDEO: "Video",
  WEB: "Web",
};

function KindGlyph({ kind }: { kind: PlaylistItemKind }) {
  const Icon = kind === "VIDEO" ? Video : kind === "WEB" ? Globe : ImageIcon;
  return <Icon aria-hidden className="size-6 text-muted-foreground" />;
}

/**
 * One row in the playlist. Owns its own duration field and toggle, and calls the
 * item server actions directly, refreshing the route on success so the parent
 * page re-reads the ordered list. Reordering is delegated up through `onMove`
 * because it needs the full sibling order.
 */
export function PlaylistItemRow({
  item,
  canUpdate,
  isFirst,
  isLast,
  onMove,
}: PlaylistItemRowProps) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [value, setValue] = React.useState(item.durationSeconds?.toString() ?? "");
  const [seen, setSeen] = React.useState(item.durationSeconds);

  // Re-sync the field when the route refresh brings a new override value.
  if (seen !== item.durationSeconds) {
    setSeen(item.durationSeconds);
    setValue(item.durationSeconds?.toString() ?? "");
  }

  const { mediaAsset } = item;
  const unavailable = mediaAsset.status !== "READY" || mediaAsset.isArchived;

  function run(action: () => Promise<{ error?: string }>) {
    startTransition(async () => {
      const result = await action();
      if (result?.error) {
        toast.error(result.error);
        return;
      }
      router.refresh();
    });
  }

  function commitDuration() {
    const raw = value.trim();
    if (raw === "") {
      if (item.durationSeconds === null) return;
      run(() => setItemDuration(item.id, { durationSeconds: null }));
      return;
    }
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed) || parsed < 1 || parsed > 3600) {
      toast.error("Enter a duration between 1 and 3600 seconds.");
      setValue(item.durationSeconds?.toString() ?? "");
      return;
    }
    if (parsed === item.durationSeconds) return;
    run(() => setItemDuration(item.id, { durationSeconds: parsed }));
  }

  return (
    <li className="flex items-center gap-3 px-3 py-2.5">
      <div className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted">
        {mediaAsset.thumbnailUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={mediaAsset.thumbnailUrl}
            alt={mediaAsset.name}
            className="size-full object-cover"
          />
        ) : (
          <KindGlyph kind={mediaAsset.kind} />
        )}
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="truncate text-sm font-medium text-ink" title={mediaAsset.name}>
          {mediaAsset.name}
        </span>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant="outline">{KIND_LABEL[mediaAsset.kind]}</Badge>
          {unavailable ? <Badge variant="destructive">Unavailable</Badge> : null}
          {!item.enabled ? <Badge variant="secondary">Disabled</Badge> : null}
        </div>
      </div>

      <label className="flex items-center gap-1.5 text-xs text-body">
        <span className="sr-only">{`Duration for ${mediaAsset.name} in seconds`}</span>
        <Input
          type="number"
          min={1}
          max={3600}
          inputMode="numeric"
          aria-label={`Duration for ${mediaAsset.name} in seconds`}
          placeholder="default"
          className="h-8 w-24"
          value={value}
          disabled={!canUpdate || pending}
          onChange={(event) => setValue(event.target.value)}
          onBlur={commitDuration}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              event.currentTarget.blur();
            }
          }}
        />
        <span aria-hidden>s</span>
      </label>

      <label className="flex items-center gap-1.5 text-xs text-body">
        <Checkbox
          checked={item.enabled}
          disabled={!canUpdate || pending}
          aria-label={`Enabled ${mediaAsset.name}`}
          onCheckedChange={(next) =>
            run(() => setItemEnabled(item.id, next === true))
          }
        />
        <span>Enabled</span>
      </label>

      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          aria-label={`Move ${mediaAsset.name} up`}
          disabled={!canUpdate || isFirst || pending}
          onClick={() => onMove(item.id, "up")}
        >
          <ArrowUp aria-hidden />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          aria-label={`Move ${mediaAsset.name} down`}
          disabled={!canUpdate || isLast || pending}
          onClick={() => onMove(item.id, "down")}
        >
          <ArrowDown aria-hidden />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-8 text-destructive"
          aria-label={`Remove ${mediaAsset.name}`}
          disabled={!canUpdate || pending}
          onClick={() => run(() => removeItem(item.id))}
        >
          <Trash2 aria-hidden />
        </Button>
      </div>
    </li>
  );
}
