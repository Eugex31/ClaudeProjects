"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { setCampaignTargets } from "@/app/(app)/campaigns/actions";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export interface TargetsPanelScreen {
  id: string;
  name: string;
  locationId: string;
  locationName: string;
}

export interface CampaignTargetsPanelProps {
  campaignId: string;
  screens: TargetsPanelScreen[];
  locations: { id: string; name: string }[];
  targetedScreenIds: string[];
  targetedLocationIds: string[];
  canUpdate: boolean;
}

/**
 * The screens and locations a campaign runs on. A checked location targets every
 * screen under it, so each of those screens renders checked and disabled with a
 * "via location" hint and its own box no longer matters. Any toggle recomputes
 * the effective sets (individually checked screens NOT already covered by a
 * checked location, plus the checked locations) and replaces the targets through
 * {@link setCampaignTargets}. Validation lives in the action: a toggle that would
 * clear every target still calls it and surfaces the returned message.
 */
export function CampaignTargetsPanel({
  campaignId,
  screens,
  locations,
  targetedScreenIds,
  targetedLocationIds,
  canUpdate,
}: CampaignTargetsPanelProps) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [screenSet, setScreenSet] = React.useState<Set<string>>(
    () => new Set(targetedScreenIds),
  );
  const [locSet, setLocSet] = React.useState<Set<string>>(
    () => new Set(targetedLocationIds),
  );

  const screensByLocation = React.useMemo(() => {
    const map = new Map<string, TargetsPanelScreen[]>();
    for (const screen of screens) {
      const list = map.get(screen.locationId) ?? [];
      list.push(screen);
      map.set(screen.locationId, list);
    }
    return map;
  }, [screens]);

  function submit(nextScreenSet: Set<string>, nextLocSet: Set<string>) {
    const effectiveScreenIds = [...nextScreenSet].filter((sid) => {
      const scr = screens.find((s) => s.id === sid);
      return scr !== undefined && !nextLocSet.has(scr.locationId);
    });
    const effectiveLocationIds = [...nextLocSet];

    const prevScreenSet = screenSet;
    const prevLocSet = locSet;

    setScreenSet(nextScreenSet);
    setLocSet(nextLocSet);

    startTransition(async () => {
      const result = await setCampaignTargets(campaignId, {
        screenIds: effectiveScreenIds,
        locationIds: effectiveLocationIds,
      });
      if (result?.error) {
        toast.error(result.error);
        setScreenSet(prevScreenSet);
        setLocSet(prevLocSet);
        return;
      }
      router.refresh();
    });
  }

  function toggleLocation(locationId: string, checked: boolean) {
    const next = new Set(locSet);
    if (checked) next.add(locationId);
    else next.delete(locationId);
    submit(new Set(screenSet), next);
  }

  function toggleScreen(screenId: string, checked: boolean) {
    const next = new Set(screenSet);
    if (checked) next.add(screenId);
    else next.delete(screenId);
    submit(next, new Set(locSet));
  }

  const disabled = !canUpdate || pending;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Targets</CardTitle>
        <CardDescription>
          Choose the screens and locations this campaign runs on.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {locations.length === 0 ? (
          <p className="text-sm text-muted-foreground">No locations yet.</p>
        ) : (
          <ul className="space-y-4">
            {locations.map((location) => {
              const locChecked = locSet.has(location.id);
              const locScreens = screensByLocation.get(location.id) ?? [];
              return (
                <li key={location.id} className="space-y-2">
                  <div className="flex items-center gap-3">
                    <Checkbox
                      checked={locChecked}
                      disabled={disabled}
                      aria-label={`Target all screens at ${location.name}`}
                      onCheckedChange={(next) =>
                        toggleLocation(location.id, next === true)
                      }
                    />
                    <span className="text-sm font-medium text-ink">
                      {location.name}
                    </span>
                  </div>
                  {locScreens.length > 0 ? (
                    <ul className="ml-7 space-y-1.5">
                      {locScreens.map((screen) => {
                        const coveredByLocation = locChecked;
                        const isOn =
                          coveredByLocation || screenSet.has(screen.id);
                        return (
                          <li
                            key={screen.id}
                            className="flex items-center gap-3"
                          >
                            <Checkbox
                              checked={isOn}
                              disabled={disabled || coveredByLocation}
                              aria-label={`Target ${screen.name}`}
                              onCheckedChange={(next) =>
                                toggleScreen(screen.id, next === true)
                              }
                            />
                            <span className="text-sm text-body">
                              {screen.name}
                            </span>
                            {coveredByLocation ? (
                              <span className="text-xs text-muted-foreground">
                                via location
                              </span>
                            ) : null}
                          </li>
                        );
                      })}
                    </ul>
                  ) : (
                    <p className="ml-7 text-xs text-muted-foreground">
                      No screens at this location.
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
