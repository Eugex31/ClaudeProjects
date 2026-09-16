"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { updatePlaylist } from "@/app/(app)/playlists/actions";
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
import { Textarea } from "@/components/ui/textarea";

export interface PlaylistSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  playlist: {
    id: string;
    name: string;
    description: string | null;
    defaultImageDurationSeconds: number;
    defaultWebDurationSeconds: number;
  };
}

function clampDuration(raw: string, fallback: number): number {
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(3600, Math.max(1, parsed));
}

/**
 * Controlled settings dialog. Edits the playlist name, description and the two
 * default durations, then submits the lot through {@link updatePlaylist}. Fields
 * reset to the current values every time the dialog opens.
 */
export function PlaylistSettingsDialog({
  open,
  onOpenChange,
  playlist,
}: PlaylistSettingsDialogProps) {
  const router = useRouter();
  const [name, setName] = React.useState(playlist.name);
  const [description, setDescription] = React.useState(playlist.description ?? "");
  const [imageDuration, setImageDuration] = React.useState(
    playlist.defaultImageDurationSeconds.toString(),
  );
  const [webDuration, setWebDuration] = React.useState(
    playlist.defaultWebDurationSeconds.toString(),
  );
  const [error, setError] = React.useState<string | null>(null);
  const [wasOpen, setWasOpen] = React.useState(open);
  const [pending, startTransition] = React.useTransition();

  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setName(playlist.name);
      setDescription(playlist.description ?? "");
      setImageDuration(playlist.defaultImageDurationSeconds.toString());
      setWebDuration(playlist.defaultWebDurationSeconds.toString());
      setError(null);
    }
  }

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError("Enter a playlist name.");
      return;
    }
    setError(null);
    const patch = {
      name: trimmedName,
      description: description.trim() || null,
      defaultImageDurationSeconds: clampDuration(
        imageDuration,
        playlist.defaultImageDurationSeconds,
      ),
      defaultWebDurationSeconds: clampDuration(
        webDuration,
        playlist.defaultWebDurationSeconds,
      ),
    };
    startTransition(async () => {
      const result = await updatePlaylist(playlist.id, patch);
      if (result?.error) {
        setError(result.error);
        toast.error(result.error);
        return;
      }
      toast.success("Playlist updated.");
      onOpenChange(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Playlist settings</DialogTitle>
          <DialogDescription>
            Name this playlist and set how long images and web pages play by
            default.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          {error ? (
            <p
              role="alert"
              className="rounded-lg border border-destructive/30 bg-destructive/10 p-2 text-sm text-destructive"
            >
              {error}
            </p>
          ) : null}
          <div className="space-y-1.5">
            <Label htmlFor="playlist-settings-name">Name</Label>
            <Input
              id="playlist-settings-name"
              required
              autoFocus
              maxLength={120}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="playlist-settings-description">Description</Label>
            <Textarea
              id="playlist-settings-description"
              maxLength={500}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="playlist-settings-image">Image seconds</Label>
              <Input
                id="playlist-settings-image"
                type="number"
                min={1}
                max={3600}
                value={imageDuration}
                onChange={(event) => setImageDuration(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="playlist-settings-web">Web seconds</Label>
              <Input
                id="playlist-settings-web"
                type="number"
                min={1}
                max={3600}
                value={webDuration}
                onChange={(event) => setWebDuration(event.target.value)}
              />
            </div>
          </div>
          <DialogFooter showCloseButton>
            <Button type="submit" disabled={pending || name.trim().length === 0}>
              {pending ? "Saving" : "Save settings"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
