"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import {
  archiveScheduleRule,
  createScheduleRule,
  deleteScheduleRule,
  restoreScheduleRule,
  setScheduleRuleEnabled,
  setScheduleRuleTargets,
  updateScheduleRule,
} from "@/app/(app)/schedule/actions";
import { parseHHMM, minutesToHHMM } from "@/lib/validation/schedule";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/** One rule as the schedule page serializes it for the client. */
export interface SerializedScheduleRule {
  id: string;
  name: string | null;
  enabled: boolean;
  isArchived: boolean;
  daysOfWeek: number[];
  startMinute: number;
  endMinute: number;
  effectiveFrom: string | null;
  effectiveUntil: string | null;
  playlist: { id: string; name: string } | null;
  campaign: { id: string; name: string } | null;
  screenIds: string[];
  locationIds: string[];
}

export interface ScheduleRuleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "create" | "edit";
  /** The rule under edit. Required when `mode` is "edit". */
  rule?: SerializedScheduleRule | null;
  /** The seed for a fresh rule. Used when `mode` is "create". */
  prefill?: { daysOfWeek: number[]; startMinute: number } | null;
  screenId: string;
  playlistOptions: Array<{ id: string; name: string }>;
  campaignOptions: Array<{ id: string; name: string }>;
  /**
   * Locations the caller may target. The schedule page does not currently pass
   * a location list, so this defaults to empty and the "Choose a location"
   * option only lists a rule's existing location targets in edit mode.
   */
  locationOptions?: Array<{ id: string; name: string }>;
  canManage: boolean;
  canDelete: boolean;
}

const WEEKDAYS: Array<{ label: string; value: number }> = [
  { label: "Monday", value: 1 },
  { label: "Tuesday", value: 2 },
  { label: "Wednesday", value: 3 },
  { label: "Thursday", value: 4 },
  { label: "Friday", value: 5 },
  { label: "Saturday", value: 6 },
  { label: "Sunday", value: 0 },
];

type PayloadMode = "playlist" | "campaign";
type TargetMode = "screen" | "location";

interface CreateInput {
  name?: string;
  playlistId?: string;
  campaignId?: string;
  daysOfWeek: number[];
  startMinute: number;
  endMinute: number;
  effectiveFrom?: string;
  effectiveUntil?: string;
  screenIds: string[];
  locationIds: string[];
  enabled?: boolean;
}

interface UpdatePatch {
  name?: string;
  playlistId?: string | null;
  campaignId?: string | null;
  daysOfWeek?: number[];
  startMinute?: number;
  endMinute?: number;
  effectiveFrom?: string | null;
  effectiveUntil?: string | null;
}

function sameNumbers(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((v, i) => v === b[i]);
}

function sameStrings(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sortedB = [...b].sort();
  return [...a].sort().every((v, i) => v === sortedB[i]);
}

function isRedirect(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "digest" in error &&
    typeof (error as { digest?: unknown }).digest === "string" &&
    (error as { digest: string }).digest.startsWith("NEXT_REDIRECT")
  );
}

const FIELD_CLASS =
  "h-9 w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

/**
 * End-time choices, every 30 minutes from "00:30" through "24:00". A native
 * `<input type="time">` cannot hold "24:00", which is a valid `endMinute` of
 * 1440 everywhere else in the stack, so the end control is a `<select>`.
 */
const END_TIME_OPTIONS: string[] = (() => {
  const options: string[] = [];
  for (let minute = 30; minute <= 1440; minute += 30) {
    options.push(minutesToHHMM(minute));
  }
  return options;
})();

/**
 * Create and edit form for one schedule rule, in a Radix dialog. The grid keeps
 * this mounted and swaps a `key` on every open so the state below seeds cleanly
 * from `rule` or `prefill`. Create submits to {@link createScheduleRule}; that
 * action calls `redirect` on success, so a thrown Next redirect is treated as a
 * success here. Edit submits the changed fields to {@link updateScheduleRule},
 * then {@link setScheduleRuleTargets} when the target changed, and also exposes
 * enable, archive or restore, and delete. Any `{ error }` keeps the dialog open
 * with the message shown.
 */
export function ScheduleRuleDialog({
  open,
  onOpenChange,
  mode,
  rule,
  prefill,
  screenId,
  playlistOptions,
  campaignOptions,
  locationOptions = [],
  canManage,
  canDelete,
}: ScheduleRuleDialogProps) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);

  const editing = mode === "edit" && rule ? rule : null;

  const [name, setName] = React.useState(editing?.name ?? "");
  const [payloadMode, setPayloadMode] = React.useState<PayloadMode>(
    editing?.campaign ? "campaign" : "playlist",
  );
  const [playlistId, setPlaylistId] = React.useState(
    editing?.playlist?.id ?? "",
  );
  const [campaignId, setCampaignId] = React.useState(
    editing?.campaign?.id ?? "",
  );
  const [days, setDays] = React.useState<number[]>(
    editing?.daysOfWeek ?? prefill?.daysOfWeek ?? [],
  );
  const [start, setStart] = React.useState(
    minutesToHHMM(editing?.startMinute ?? prefill?.startMinute ?? 540),
  );
  const [end, setEnd] = React.useState(
    minutesToHHMM(
      editing?.endMinute ??
        Math.min((prefill?.startMinute ?? 540) + 60, 1440),
    ),
  );
  const [effectiveFrom, setEffectiveFrom] = React.useState(
    editing?.effectiveFrom ?? "",
  );
  const [effectiveUntil, setEffectiveUntil] = React.useState(
    editing?.effectiveUntil ?? "",
  );
  const [enabled, setEnabled] = React.useState(editing?.enabled ?? true);
  const [targetMode, setTargetMode] = React.useState<TargetMode>(
    editing && editing.locationIds.length > 0 ? "location" : "screen",
  );
  const [locationId, setLocationId] = React.useState(
    editing?.locationIds[0] ?? "",
  );

  const locationChoices = React.useMemo(() => {
    const seen = new Map<string, string>();
    for (const option of locationOptions) seen.set(option.id, option.name);
    for (const id of editing?.locationIds ?? []) {
      if (!seen.has(id)) seen.set(id, id);
    }
    return [...seen.entries()].map(([id, label]) => ({ id, name: label }));
  }, [locationOptions, editing]);

  function toggleDay(value: number, checked: boolean) {
    setDays((current) => {
      const next = checked
        ? [...current, value]
        : current.filter((d) => d !== value);
      return WEEKDAYS.filter((w) => next.includes(w.value)).map((w) => w.value);
    });
  }

  function currentDays(): number[] {
    return WEEKDAYS.filter((w) => days.includes(w.value)).map((w) => w.value);
  }

  function targetIds(): { screenIds: string[]; locationIds: string[] } {
    if (targetMode === "location") {
      return {
        screenIds: [],
        locationIds: locationId ? [locationId] : [],
      };
    }
    return { screenIds: [screenId], locationIds: [] };
  }

  function finishSuccess() {
    onOpenChange(false);
    router.refresh();
  }

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    let startMinute: number;
    let endMinute: number;
    try {
      startMinute = parseHHMM(start);
      endMinute = parseHHMM(end);
    } catch {
      setError("Enter the times as HH:MM in 24 hour form.");
      return;
    }
    if (endMinute <= startMinute) {
      setError("End time must be after start time.");
      return;
    }
    const chosenDays = currentDays();
    if (chosenDays.length === 0) {
      setError("Pick at least one weekday.");
      return;
    }
    if (payloadMode === "playlist" && !playlistId) {
      setError("Choose a playlist.");
      return;
    }
    if (payloadMode === "campaign" && !campaignId) {
      setError("Choose a campaign.");
      return;
    }

    const targets = targetIds();

    if (mode === "create") {
      const input: CreateInput = {
        daysOfWeek: chosenDays,
        startMinute,
        endMinute,
        screenIds: targets.screenIds,
        locationIds: targets.locationIds,
      };
      const trimmed = name.trim();
      if (trimmed) input.name = trimmed;
      if (payloadMode === "playlist") input.playlistId = playlistId;
      if (payloadMode === "campaign") input.campaignId = campaignId;
      if (effectiveFrom) input.effectiveFrom = effectiveFrom;
      if (effectiveUntil) input.effectiveUntil = effectiveUntil;
      if (!enabled) input.enabled = false;

      startTransition(async () => {
        try {
          const result = await createScheduleRule(input);
          if (result && "error" in result) {
            setError(result.error);
            return;
          }
          finishSuccess();
        } catch (thrown) {
          if (isRedirect(thrown)) {
            finishSuccess();
            return;
          }
          throw thrown;
        }
      });
      return;
    }

    if (!editing) return;
    const ruleId = editing.id;
    const patch: UpdatePatch = {};
    if (name.trim() !== (editing.name ?? "")) patch.name = name.trim();
    if (payloadMode === "playlist" && playlistId !== editing.playlist?.id) {
      patch.playlistId = playlistId;
      patch.campaignId = null;
    }
    if (payloadMode === "campaign" && campaignId !== editing.campaign?.id) {
      patch.campaignId = campaignId;
      patch.playlistId = null;
    }
    if (!sameNumbers(chosenDays, editing.daysOfWeek)) {
      patch.daysOfWeek = chosenDays;
    }
    if (startMinute !== editing.startMinute) patch.startMinute = startMinute;
    if (endMinute !== editing.endMinute) patch.endMinute = endMinute;
    const nextFrom = effectiveFrom || null;
    if (nextFrom !== editing.effectiveFrom) patch.effectiveFrom = nextFrom;
    const nextUntil = effectiveUntil || null;
    if (nextUntil !== editing.effectiveUntil) patch.effectiveUntil = nextUntil;

    const targetsChanged =
      !sameStrings(targets.screenIds, editing.screenIds) ||
      !sameStrings(targets.locationIds, editing.locationIds);

    startTransition(async () => {
      if (Object.keys(patch).length > 0) {
        const result = await updateScheduleRule(ruleId, patch);
        if (result && "error" in result) {
          setError(result.error);
          return;
        }
      }
      if (targetsChanged) {
        const result = await setScheduleRuleTargets(ruleId, targets);
        if (result && "error" in result) {
          setError(result.error);
          return;
        }
      }
      finishSuccess();
    });
  }

  function onToggleEnabled(next: boolean) {
    if (!editing) return;
    setEnabled(next);
    setError(null);
    startTransition(async () => {
      const result = await setScheduleRuleEnabled(editing.id, next);
      if (result && "error" in result) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  function onArchiveToggle() {
    if (!editing) return;
    setError(null);
    startTransition(async () => {
      const result = editing.isArchived
        ? await restoreScheduleRule(editing.id)
        : await archiveScheduleRule(editing.id);
      if (result && "error" in result) {
        setError(result.error);
        return;
      }
      finishSuccess();
    });
  }

  function onDelete() {
    if (!editing) return;
    setError(null);
    startTransition(async () => {
      const result = await deleteScheduleRule(editing.id);
      if (result && "error" in result) {
        setError(result.error);
        return;
      }
      finishSuccess();
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {mode === "create" ? "New schedule rule" : "Edit schedule rule"}
          </DialogTitle>
          <DialogDescription>
            A rule plays a playlist or campaign on the chosen weekdays and time
            window.
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
            <label htmlFor="rule-name" className="text-sm font-medium">
              Name
            </label>
            <input
              id="rule-name"
              className={FIELD_CLASS}
              maxLength={120}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>

          <fieldset className="space-y-1.5">
            <legend className="text-sm font-medium">Target</legend>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="rule-target"
                checked={targetMode === "screen"}
                onChange={() => setTargetMode("screen")}
              />
              This screen
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="rule-target"
                checked={targetMode === "location"}
                disabled={locationChoices.length === 0}
                onChange={() => setTargetMode("location")}
              />
              Choose a location
            </label>
            {targetMode === "location" ? (
              <select
                aria-label="Location"
                className={FIELD_CLASS}
                value={locationId}
                onChange={(event) => setLocationId(event.target.value)}
              >
                <option value="">Choose a location</option>
                {locationChoices.map((choice) => (
                  <option key={choice.id} value={choice.id}>
                    {choice.name}
                  </option>
                ))}
              </select>
            ) : null}
          </fieldset>

          <fieldset className="space-y-1.5">
            <legend className="text-sm font-medium">Plays</legend>
            <div className="flex gap-4">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="rule-payload"
                  checked={payloadMode === "playlist"}
                  onChange={() => setPayloadMode("playlist")}
                />
                Use a playlist
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="rule-payload"
                  checked={payloadMode === "campaign"}
                  onChange={() => setPayloadMode("campaign")}
                />
                Use a campaign
              </label>
            </div>
            {payloadMode === "playlist" ? (
              <select
                aria-label="Playlist"
                className={FIELD_CLASS}
                value={playlistId}
                onChange={(event) => setPlaylistId(event.target.value)}
              >
                <option value="">Choose a playlist</option>
                {playlistOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.name}
                  </option>
                ))}
              </select>
            ) : (
              <select
                aria-label="Campaign"
                className={FIELD_CLASS}
                value={campaignId}
                onChange={(event) => setCampaignId(event.target.value)}
              >
                <option value="">Choose a campaign</option>
                {campaignOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.name}
                  </option>
                ))}
              </select>
            )}
          </fieldset>

          <fieldset className="space-y-1.5">
            <legend className="text-sm font-medium">Weekdays</legend>
            <div className="flex flex-wrap gap-3">
              {WEEKDAYS.map((weekday) => (
                <label
                  key={weekday.value}
                  className="flex items-center gap-1.5 text-sm"
                >
                  <input
                    type="checkbox"
                    checked={days.includes(weekday.value)}
                    onChange={(event) =>
                      toggleDay(weekday.value, event.target.checked)
                    }
                  />
                  {weekday.label}
                </label>
              ))}
            </div>
          </fieldset>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor="rule-start" className="text-sm font-medium">
                Start time
              </label>
              <input
                id="rule-start"
                type="time"
                className={FIELD_CLASS}
                value={start}
                onChange={(event) => setStart(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="rule-end" className="text-sm font-medium">
                End time
              </label>
              <select
                id="rule-end"
                className={FIELD_CLASS}
                value={end}
                onChange={(event) => setEnd(event.target.value)}
              >
                {(END_TIME_OPTIONS.includes(end)
                  ? END_TIME_OPTIONS
                  : [end, ...END_TIME_OPTIONS]
                ).map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor="rule-from" className="text-sm font-medium">
                Effective from
              </label>
              <input
                id="rule-from"
                type="date"
                className={FIELD_CLASS}
                value={effectiveFrom}
                onChange={(event) => setEffectiveFrom(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="rule-until" className="text-sm font-medium">
                Effective until
              </label>
              <input
                id="rule-until"
                type="date"
                className={FIELD_CLASS}
                value={effectiveUntil}
                onChange={(event) => setEffectiveUntil(event.target.value)}
              />
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(event) =>
                mode === "create"
                  ? setEnabled(event.target.checked)
                  : onToggleEnabled(event.target.checked)
              }
            />
            Enabled
          </label>

          <div className="flex flex-wrap items-center gap-2 pt-2">
            <Button type="submit" disabled={pending || !canManage}>
              {mode === "create" ? "Create rule" : "Save changes"}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            {mode === "edit" && editing && canManage ? (
              <Button
                type="button"
                variant="outline"
                onClick={onArchiveToggle}
                disabled={pending}
              >
                {editing.isArchived ? "Restore" : "Archive"}
              </Button>
            ) : null}
            {mode === "edit" && editing && canDelete ? (
              <Button
                type="button"
                variant="destructive"
                onClick={onDelete}
                disabled={pending}
              >
                Delete rule
              </Button>
            ) : null}
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
