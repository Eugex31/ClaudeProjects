"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { MonitorPlay, Trash2 } from "lucide-react";
import { toast } from "sonner";

import {
  deleteCampaign,
  restoreCampaign,
  setCampaignEnabled,
  updateCampaign,
} from "@/app/(app)/campaigns/actions";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { PlaylistPreviewDialog } from "@/components/app/playlists/playlist-preview-dialog";
import {
  CampaignTargetsPanel,
  type TargetsPanelScreen,
} from "@/components/app/campaigns/campaign-targets-panel";

export interface EditorCampaign {
  id: string;
  name: string;
  description: string | null;
  playlistId: string;
  /** ISO 8601 in UTC. */
  startsAt: string;
  /** ISO 8601 in UTC. */
  endsAt: string;
  priority: number;
  enabled: boolean;
  isArchived: boolean;
  playlist: { id: string; name: string; isArchived: boolean };
}

export interface CampaignEditorProps {
  campaign: EditorCampaign;
  playlists: { id: string; name: string }[];
  screens: TargetsPanelScreen[];
  locations: { id: string; name: string }[];
  targetedScreenIds: string[];
  targetedLocationIds: string[];
  affectedScreenCount: number;
  canUpdate: boolean;
  canDelete: boolean;
}

interface UpdatePatch {
  name?: string;
  description?: string | null;
  playlistId?: string;
  startsAt?: string;
  endsAt?: string;
  priority?: number;
}

/**
 * `YYYY-MM-DDTHH:mm` in the viewer's local time, the value shape a
 * `datetime-local` input wants. The stored window is absolute UTC; this is only
 * how it is shown and edited. Save converts the edited value back with
 * `new Date(local).toISOString()`.
 */
export function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}

/**
 * Client shell for one campaign. The fields form batches its changes behind a
 * single Save that sends only the fields that actually differ from what was
 * loaded; the enable checkbox and every target toggle write immediately. Preview
 * plays the campaign's playlist through the shared player. Delete sits behind a
 * confirm dialog, and an archived campaign shows a restore banner instead. Every
 * control is inert when the caller cannot update the campaign.
 */
export function CampaignEditor({
  campaign,
  playlists,
  screens,
  locations,
  targetedScreenIds,
  targetedLocationIds,
  affectedScreenCount,
  canUpdate,
  canDelete,
}: CampaignEditorProps) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [previewOpen, setPreviewOpen] = React.useState(false);
  const [confirmDelete, setConfirmDelete] = React.useState(false);

  const seededDescription = campaign.description ?? "";
  const seededStarts = toLocalInput(campaign.startsAt);
  const seededEnds = toLocalInput(campaign.endsAt);
  const seededPriority = String(campaign.priority);

  const [name, setName] = React.useState(campaign.name);
  const [description, setDescription] = React.useState(seededDescription);
  const [playlistId, setPlaylistId] = React.useState(campaign.playlistId);
  const [startsLocal, setStartsLocal] = React.useState(seededStarts);
  const [endsLocal, setEndsLocal] = React.useState(seededEnds);
  const [priorityStr, setPriorityStr] = React.useState(seededPriority);

  function buildPatch(): UpdatePatch {
    const patch: UpdatePatch = {};

    const trimmedName = name.trim();
    if (trimmedName !== campaign.name) patch.name = trimmedName;

    const trimmedDescription = description.trim();
    if (trimmedDescription !== seededDescription) {
      patch.description = trimmedDescription === "" ? null : trimmedDescription;
    }

    if (playlistId !== campaign.playlistId) patch.playlistId = playlistId;

    if (startsLocal !== "" && startsLocal !== seededStarts) {
      patch.startsAt = new Date(startsLocal).toISOString();
    }
    if (endsLocal !== "" && endsLocal !== seededEnds) {
      patch.endsAt = new Date(endsLocal).toISOString();
    }

    const priorityNum = Number(priorityStr);
    if (
      priorityStr !== seededPriority &&
      priorityStr.trim() !== "" &&
      Number.isFinite(priorityNum)
    ) {
      patch.priority = priorityNum;
    }

    return patch;
  }

  const hasChanges = Object.keys(buildPatch()).length > 0;

  function onSave() {
    const patch = buildPatch();
    startTransition(async () => {
      const result = await updateCampaign(campaign.id, patch);
      if (result?.error) {
        toast.error(result.error);
        return;
      }
      toast.success("Campaign saved.");
      router.refresh();
    });
  }

  function onToggleEnabled(next: boolean) {
    startTransition(async () => {
      const result = await setCampaignEnabled(campaign.id, next);
      if (result?.error) {
        toast.error(result.error);
        return;
      }
      router.refresh();
    });
  }

  function onDelete() {
    startTransition(async () => {
      const result = await deleteCampaign(campaign.id);
      if (result?.error) {
        toast.error(result.error);
        return;
      }
      toast.success("Campaign deleted.");
      router.push("/campaigns");
    });
  }

  function onRestore() {
    startTransition(async () => {
      const result = await restoreCampaign(campaign.id);
      if (result?.error) {
        toast.error(result.error);
        return;
      }
      toast.success("Campaign restored.");
      router.refresh();
    });
  }

  const fieldsDisabled = !canUpdate || pending;

  return (
    <div className="space-y-6">
      {campaign.isArchived ? (
        <div className="flex flex-wrap items-center gap-3 rounded-panel border border-hairline bg-muted/40 px-4 py-2 text-sm text-body">
          <span>This campaign is archived.</span>
          <Button
            variant="outline"
            size="sm"
            className="ml-auto"
            onClick={onRestore}
            disabled={pending || !canUpdate}
          >
            Restore
          </Button>
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <Card>
          <CardHeader>
            <CardTitle>Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="campaign-name">Name</Label>
              <Input
                id="campaign-name"
                maxLength={120}
                value={name}
                disabled={fieldsDisabled}
                onChange={(event) => setName(event.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="campaign-description">Description</Label>
              <Textarea
                id="campaign-description"
                maxLength={500}
                value={description}
                disabled={fieldsDisabled}
                onChange={(event) => setDescription(event.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="campaign-playlist">Playlist</Label>
              <Select
                value={playlistId}
                onValueChange={setPlaylistId}
                disabled={fieldsDisabled}
              >
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
                  type="datetime-local"
                  value={startsLocal}
                  disabled={fieldsDisabled}
                  onChange={(event) => setStartsLocal(event.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="campaign-ends">End</Label>
                <Input
                  id="campaign-ends"
                  type="datetime-local"
                  value={endsLocal}
                  disabled={fieldsDisabled}
                  onChange={(event) => setEndsLocal(event.target.value)}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="campaign-priority">Priority</Label>
              <Input
                id="campaign-priority"
                type="number"
                min={0}
                max={1000}
                value={priorityStr}
                disabled={fieldsDisabled}
                onChange={(event) => setPriorityStr(event.target.value)}
              />
            </div>

            <div className="flex items-center gap-3">
              <Checkbox
                id="campaign-enabled"
                checked={campaign.enabled}
                disabled={!canUpdate || pending}
                aria-label="Campaign enabled"
                onCheckedChange={(next) => onToggleEnabled(next === true)}
              />
              <Label htmlFor="campaign-enabled" className="font-normal">
                Enabled
              </Label>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <Button
                onClick={onSave}
                disabled={fieldsDisabled || !hasChanges}
              >
                {pending ? "Saving" : "Save"}
              </Button>
              <Button
                variant="outline"
                onClick={() => setPreviewOpen(true)}
              >
                <MonitorPlay aria-hidden />
                Preview
              </Button>
            </div>

            <p className="text-sm text-muted-foreground">
              {`This campaign currently affects ${affectedScreenCount} ${
                affectedScreenCount === 1 ? "screen" : "screens"
              }.`}
            </p>

            {campaign.playlist.isArchived ? (
              <p className="text-sm text-destructive">
                The playlist this campaign uses is archived.
              </p>
            ) : null}
          </CardContent>
        </Card>

        <CampaignTargetsPanel
          campaignId={campaign.id}
          screens={screens}
          locations={locations}
          targetedScreenIds={targetedScreenIds}
          targetedLocationIds={targetedLocationIds}
          canUpdate={canUpdate}
        />
      </div>

      {canDelete ? (
        <Card>
          <CardHeader>
            <CardTitle>Danger zone</CardTitle>
          </CardHeader>
          <CardContent>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => setConfirmDelete(true)}
            >
              <Trash2 aria-hidden />
              Delete campaign
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <PlaylistPreviewDialog
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        playlistId={campaign.playlist.id}
        playlistName={campaign.playlist.name}
        fetchPath={`/api/campaigns/${campaign.id}/preview`}
      />

      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {campaign.name}</DialogTitle>
            <DialogDescription>
              This removes the campaign and its targets. Screens fall back to
              their base playlist. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter showCloseButton>
            <Button
              variant="destructive"
              onClick={onDelete}
              disabled={pending}
            >
              {pending ? "Deleting" : "Delete campaign"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
