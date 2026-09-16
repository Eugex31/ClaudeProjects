"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

export interface AnalyticsFiltersProps {
  from: string;
  to: string;
  screens: Array<{
    id: string;
    name: string;
    location: { id: string; name: string };
  }>;
  locations: Array<{ id: string; name: string }>;
  selectedLocation?: string;
  selectedScreen?: string;
}

const CONTROL_CLASS =
  "h-9 rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

type FilterValues = {
  from: string;
  to: string;
  location: string;
  screen: string;
};

/**
 * Filter bar for the analytics page. Two date inputs bound the range and two
 * selects narrow it to a location or a single screen, the screen options
 * grouped into one `<optgroup>` per location. Any change rebuilds the query
 * string from the current four values, changing only the control that moved,
 * drops the empty ones, and navigates to `/analytics?<qs>` so the server
 * component reloads the reports.
 */
export function AnalyticsFilters({
  from,
  to,
  screens,
  locations,
  selectedLocation,
  selectedScreen,
}: AnalyticsFiltersProps) {
  const router = useRouter();

  const current: FilterValues = {
    from,
    to,
    location: selectedLocation ?? "",
    screen: selectedScreen ?? "",
  };

  const pushWith = (patch: Partial<FilterValues>) => {
    const next = { ...current, ...patch };
    const qs = new URLSearchParams();
    for (const key of ["from", "to", "location", "screen"] as const) {
      if (next[key]) qs.set(key, next[key]);
    }
    router.push(`/analytics?${qs.toString()}`);
  };

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
    <div className="flex flex-wrap items-end gap-4">
      <div className="flex flex-col gap-1">
        <label htmlFor="analytics-filter-from" className="text-sm text-body">
          From
        </label>
        <input
          id="analytics-filter-from"
          type="date"
          value={from}
          onChange={(event) => pushWith({ from: event.target.value })}
          className={CONTROL_CLASS}
        />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="analytics-filter-to" className="text-sm text-body">
          To
        </label>
        <input
          id="analytics-filter-to"
          type="date"
          value={to}
          onChange={(event) => pushWith({ to: event.target.value })}
          className={CONTROL_CLASS}
        />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="analytics-filter-location" className="text-sm text-body">
          Location
        </label>
        <select
          id="analytics-filter-location"
          value={selectedLocation ?? ""}
          onChange={(event) => pushWith({ location: event.target.value })}
          className={CONTROL_CLASS}
        >
          <option value="">All locations</option>
          {locations.map((location) => (
            <option key={location.id} value={location.id}>
              {location.name}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="analytics-filter-screen" className="text-sm text-body">
          Screen
        </label>
        <select
          id="analytics-filter-screen"
          value={selectedScreen ?? ""}
          onChange={(event) => pushWith({ screen: event.target.value })}
          className={CONTROL_CLASS}
        >
          <option value="">All screens</option>
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
    </div>
  );
}
