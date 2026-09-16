"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

export interface ScheduleScreenPickerProps {
  screens: Array<{
    id: string;
    name: string;
    location: { id: string; name: string };
  }>;
  selectedId: string;
}

const SELECT_CLASS =
  "h-9 rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

/**
 * Screen selector for the schedule page. Options are grouped into one
 * `<optgroup>` per location, in the order the screens arrive (the server sorts
 * them by location name then screen name). Changing the selection navigates to
 * `/schedule?screen=<id>` so the server component reloads that screen's rules.
 */
export function ScheduleScreenPicker({
  screens,
  selectedId,
}: ScheduleScreenPickerProps) {
  const router = useRouter();

  const groups: Array<{ id: string; name: string; screens: typeof screens }> =
    [];
  for (const screen of screens) {
    let group = groups.find((g) => g.id === screen.location.id);
    if (!group) {
      group = { id: screen.location.id, name: screen.location.name, screens: [] };
      groups.push(group);
    }
    group.screens.push(screen);
  }

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor="schedule-screen-picker" className="text-sm text-body">
        Screen
      </label>
      <select
        id="schedule-screen-picker"
        value={selectedId}
        onChange={(event) =>
          router.push(`/schedule?screen=${event.target.value}`)
        }
        className={SELECT_CLASS}
      >
        {groups.map((group) => (
          <optgroup key={group.id} label={group.name}>
            {group.screens.map((screen) => (
              <option key={screen.id} value={screen.id}>
                {screen.name}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </div>
  );
}
