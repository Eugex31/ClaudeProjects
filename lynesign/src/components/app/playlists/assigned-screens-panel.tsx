"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { assignPlaylistToScreen } from "@/app/(app)/playlists/actions";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export interface PanelScreen {
  id: string;
  name: string;
  locationName: string;
  /** The playlist this screen currently plays, if any. */
  playlistId: string | null;
}

export interface AssignedScreensPanelProps {
  playlistId: string;
  screens: PanelScreen[];
  assignedScreenIds: string[];
  canAssign: boolean;
}

/**
 * Which screens play this playlist. Each checkbox assigns or clears the screen
 * through {@link assignPlaylistToScreen}; a screen already on a different
 * playlist can still be checked here, which reassigns it.
 */
export function AssignedScreensPanel({
  playlistId,
  screens,
  assignedScreenIds,
  canAssign,
}: AssignedScreensPanelProps) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const assigned = new Set(assignedScreenIds);

  function onToggle(screenId: string, checked: boolean) {
    startTransition(async () => {
      const result = await assignPlaylistToScreen(
        screenId,
        checked ? playlistId : null,
      );
      if (result?.error) {
        toast.error(result.error);
        return;
      }
      toast.success(checked ? "Screen assigned." : "Screen removed.");
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Screens</CardTitle>
        <CardDescription>
          Choose which screens play this playlist.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {screens.length === 0 ? (
          <p className="text-sm text-muted-foreground">No screens yet.</p>
        ) : (
          <ul className="divide-y divide-hairline">
            {screens.map((screen) => {
              const isOn = assigned.has(screen.id);
              const onOther =
                !isOn &&
                screen.playlistId !== null &&
                screen.playlistId !== playlistId;
              return (
                <li key={screen.id} className="flex items-center gap-3 py-2.5">
                  <Checkbox
                    checked={isOn}
                    disabled={!canAssign || pending}
                    aria-label={`Play on ${screen.name}`}
                    onCheckedChange={(next) => onToggle(screen.id, next === true)}
                  />
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-sm font-medium text-ink">
                      {screen.name}
                    </span>
                    <span className="truncate text-xs text-muted-foreground">
                      {screen.locationName}
                    </span>
                    {onOther ? (
                      <span className="text-xs text-muted-foreground">
                        currently on another playlist
                      </span>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
