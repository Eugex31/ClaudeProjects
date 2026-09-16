"use client";

import * as React from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";

import { createScreen } from "@/app/(app)/screens/actions";
import { assignPlaylistToScreen } from "@/app/(app)/playlists/actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PairScreenDialog } from "@/components/app/pair-screen-dialog";

/**
 * Radix `SelectItem` forbids an empty-string value, so the "no playlist" choice
 * carries this sentinel in the Select and is mapped back to "" in local state.
 */
const NONE_PLAYLIST = "__none__";

export interface ScreenFormLocation {
  id: string;
  name: string;
}

export interface ScreenFormPlaylist {
  id: string;
  name: string;
}

export interface ScreenFormProps {
  locations: ScreenFormLocation[];
  playlists?: ScreenFormPlaylist[];
  canAssignPlaylist?: boolean;
  triggerLabel?: string;
  triggerVariant?: React.ComponentProps<typeof Button>["variant"];
}

/**
 * "Add screen" trigger plus the create dialog. Submits to {@link createScreen};
 * a returned `{ error }` is shown inline and as a toast, and a success closes
 * this dialog and hands the returned pairing code to {@link PairScreenDialog}.
 * A screen cannot be created without a location, so the trigger is disabled
 * until at least one location exists.
 */
export function ScreenForm({
  locations,
  playlists,
  canAssignPlaylist = false,
  triggerLabel = "Add screen",
  triggerVariant = "default",
}: ScreenFormProps) {
  const [open, setOpen] = React.useState(false);
  const [locationId, setLocationId] = React.useState("");
  const [playlistId, setPlaylistId] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [pairingCode, setPairingCode] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  const noLocations = locations.length === 0;
  const showPlaylist = canAssignPlaylist && !!playlists && playlists.length > 0;

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    formData.set("locationId", locationId);
    setError(null);
    startTransition(async () => {
      const result = await createScreen(formData);
      if (result?.error) {
        setError(result.error);
        toast.error(result.error);
        return;
      }
      if (playlistId !== "" && result.screenId) {
        const assigned = await assignPlaylistToScreen(result.screenId, playlistId);
        if (assigned?.error) {
          toast.error(`Screen created. Could not set the playlist: ${assigned.error}`);
        }
      }
      toast.success("Screen created.");
      setOpen(false);
      setLocationId("");
      setPlaylistId("");
      setPairingCode(result.pairingCode ?? null);
    });
  }

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setError(null);
        }}
      >
        <DialogTrigger asChild>
          <Button variant={triggerVariant} size="sm" disabled={noLocations}>
            <Plus aria-hidden />
            {triggerLabel}
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add screen</DialogTitle>
            <DialogDescription>
              Name the screen and pick the location it lives at. You will get a
              pairing code to enter on the device.
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
              <Label htmlFor="screen-name">Name</Label>
              <Input id="screen-name" name="name" required autoFocus />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="screen-location">Location</Label>
              <Select value={locationId} onValueChange={setLocationId}>
                <SelectTrigger id="screen-location" className="w-full">
                  <SelectValue placeholder="Select a location" />
                </SelectTrigger>
                <SelectContent>
                  {locations.map((location) => (
                    <SelectItem key={location.id} value={location.id}>
                      {location.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {showPlaylist ? (
              <div className="space-y-1.5">
                <Label htmlFor="screen-playlist">Playlist</Label>
                <Select
                  value={playlistId === "" ? NONE_PLAYLIST : playlistId}
                  onValueChange={(next) =>
                    setPlaylistId(next === NONE_PLAYLIST ? "" : next)
                  }
                >
                  <SelectTrigger id="screen-playlist" className="w-full">
                    <SelectValue placeholder="None" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE_PLAYLIST}>None</SelectItem>
                    {playlists!.map((playlist) => (
                      <SelectItem key={playlist.id} value={playlist.id}>
                        {playlist.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}

            <DialogFooter showCloseButton>
              <Button type="submit" disabled={pending || locationId === ""}>
                {pending ? "Saving" : "Create screen"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <PairScreenDialog
        pairingCode={pairingCode}
        onOpenChange={(next) => {
          if (!next) setPairingCode(null);
        }}
      />
    </>
  );
}
