"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { toast } from "sonner";

import { createCampaign } from "@/app/(app)/campaigns/actions";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

/**
 * "New campaign" trigger and dialog. Collects a name, an optional description, a
 * playlist, a start and end datetime, and an optional priority, converts the
 * local datetimes to ISO 8601, and submits to {@link createCampaign}. A returned
 * `{ error }` is shown inline and as a toast; a returned `{ id }` closes the
 * dialog and navigates to the new campaign.
 */
export function NewCampaignDialog({
  playlists,
}: {
  playlists: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [playlistId, setPlaylistId] = React.useState("");
  const [startsLocal, setStartsLocal] = React.useState("");
  const [endsLocal, setEndsLocal] = React.useState("");
  const [priorityStr, setPriorityStr] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  function reset() {
    setName("");
    setDescription("");
    setPlaylistId("");
    setStartsLocal("");
    setEndsLocal("");
    setPriorityStr("");
    setError(null);
  }

  const missingRequired =
    name.trim().length === 0 ||
    playlistId.length === 0 ||
    startsLocal.length === 0 ||
    endsLocal.length === 0;

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (missingRequired) return;
    const startsAt = new Date(startsLocal).toISOString();
    const endsAt = new Date(endsLocal).toISOString();
    setError(null);
    startTransition(async () => {
      const result = await createCampaign({
        name: name.trim(),
        description: description.trim() || undefined,
        playlistId,
        startsAt,
        endsAt,
        priority: priorityStr === "" ? undefined : Number(priorityStr),
      });
      if ("error" in result) {
        setError(result.error);
        toast.error(result.error);
        return;
      }
      toast.success("Campaign created.");
      setOpen(false);
      reset();
      router.push(`/campaigns/${result.id}`);
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Plus aria-hidden />
          New campaign
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New campaign</DialogTitle>
          <DialogDescription>
            Run a playlist across a group of screens for a date range.
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
            <Label htmlFor="campaign-name">Name</Label>
            <Input
              id="campaign-name"
              name="name"
              required
              autoFocus
              maxLength={120}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="campaign-description">Description</Label>
            <Textarea
              id="campaign-description"
              name="description"
              maxLength={500}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="campaign-playlist">Playlist</Label>
            <Select value={playlistId} onValueChange={setPlaylistId}>
              <SelectTrigger id="campaign-playlist" className="w-full">
                <SelectValue placeholder="Choose a playlist" />
              </SelectTrigger>
              <SelectContent>
                {playlists.map((playlist) => (
                  <SelectItem key={playlist.id} value={playlist.id}>
                    {playlist.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="campaign-starts">Start</Label>
              <Input
                id="campaign-starts"
                name="startsAt"
                type="datetime-local"
                required
                value={startsLocal}
                onChange={(event) => setStartsLocal(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="campaign-ends">End</Label>
              <Input
                id="campaign-ends"
                name="endsAt"
                type="datetime-local"
                required
                value={endsLocal}
                onChange={(event) => setEndsLocal(event.target.value)}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="campaign-priority">Priority</Label>
            <Input
              id="campaign-priority"
              name="priority"
              type="number"
              min={0}
              max={1000}
              value={priorityStr}
              onChange={(event) => setPriorityStr(event.target.value)}
            />
          </div>
          <DialogFooter showCloseButton>
            <Button type="submit" disabled={pending || missingRequired}>
              {pending ? "Creating" : "Create campaign"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
