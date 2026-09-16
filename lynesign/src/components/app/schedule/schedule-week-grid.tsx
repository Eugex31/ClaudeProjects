"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { restoreScheduleRule } from "@/app/(app)/schedule/actions";
import { minutesToHHMM } from "@/lib/validation/schedule";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  ScheduleRuleDialog,
  type SerializedScheduleRule,
} from "@/components/app/schedule/schedule-rule-dialog";

export interface ScheduleWeekGridProps {
  screenId: string;
  rules: SerializedScheduleRule[];
  campaigns: Array<{
    id: string;
    name: string;
    startsAt: string;
    endsAt: string;
  }>;
  playlistOptions: Array<{ id: string; name: string }>;
  campaignOptions: Array<{ id: string; name: string }>;
  /**
   * Optional. The schedule page does not pass these today; the dialog falls
   * back to a "This screen" target when the list is empty.
   */
  locationOptions?: Array<{ id: string; name: string }>;
  canManage: boolean;
  canDelete: boolean;
}

const WEEKDAYS: Array<{ short: string; long: string; value: number }> = [
  { short: "Mon", long: "Monday", value: 1 },
  { short: "Tue", long: "Tuesday", value: 2 },
  { short: "Wed", long: "Wednesday", value: 3 },
  { short: "Thu", long: "Thursday", value: 4 },
  { short: "Fri", long: "Friday", value: 5 },
  { short: "Sat", long: "Saturday", value: 6 },
  { short: "Sun", long: "Sunday", value: 0 },
];

const PX_PER_MINUTE = 0.8;
const ROW_MINUTES = 30;
const DAY_END = 1440;

type DialogState =
  | { key: number; open: true; mode: "create"; prefill: { daysOfWeek: number[]; startMinute: number } }
  | { key: number; open: true; mode: "edit"; rule: SerializedScheduleRule }
  | { key: number; open: false };

function payloadName(rule: SerializedScheduleRule): string {
  return rule.playlist?.name ?? rule.campaign?.name ?? "Untitled";
}

function effectiveCaption(rule: SerializedScheduleRule): string | null {
  if (rule.effectiveFrom && rule.effectiveUntil) {
    return `${rule.effectiveFrom} to ${rule.effectiveUntil}`;
  }
  if (rule.effectiveFrom) return `from ${rule.effectiveFrom}`;
  if (rule.effectiveUntil) return `until ${rule.effectiveUntil}`;
  return null;
}

/**
 * The week authoring grid for one screen. A fixed time gutter plus seven day
 * columns shown Monday first; weekday `0` (Sunday) is the last column. The
 * vertical axis is minutes of the day at a fixed scale, windowed to 06:00-24:00
 * by default with a full-day toggle. Every non-archived rule paints one
 * absolutely positioned block per weekday it runs, clamped to the window. Active
 * campaigns show as one full-width ribbon above the grid. Clicking an empty cell
 * opens the create dialog seeded with that weekday and half hour; clicking a
 * block opens the edit dialog. Both are gated on `canManage`.
 */
export function ScheduleWeekGrid({
  screenId,
  rules,
  campaigns,
  playlistOptions,
  campaignOptions,
  locationOptions = [],
  canManage,
  canDelete,
}: ScheduleWeekGridProps) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [fullDay, setFullDay] = React.useState(false);
  const [showArchived, setShowArchived] = React.useState(false);
  const [restoreError, setRestoreError] = React.useState<string | null>(null);
  const [dialog, setDialog] = React.useState<DialogState>({ key: 0, open: false });

  const windowStart = fullDay ? 0 : 360;
  const windowMinutes = DAY_END - windowStart;
  const gridHeight = windowMinutes * PX_PER_MINUTE;

  const rowStarts: number[] = [];
  for (let m = windowStart; m < DAY_END; m += ROW_MINUTES) rowStarts.push(m);

  const visibleRules = rules.filter((rule) => !rule.isArchived);
  const archivedRules = rules.filter((rule) => rule.isArchived);

  function openCreate(daysOfWeek: number[], startMinute: number) {
    setDialog((current) => ({
      key: current.key + 1,
      open: true,
      mode: "create",
      prefill: { daysOfWeek, startMinute },
    }));
  }

  function openEdit(rule: SerializedScheduleRule) {
    setDialog((current) => ({
      key: current.key + 1,
      open: true,
      mode: "edit",
      rule,
    }));
  }

  function closeDialog() {
    setDialog((current) => ({ key: current.key, open: false }));
  }

  function onRestore(id: string) {
    setRestoreError(null);
    startTransition(async () => {
      const result = await restoreScheduleRule(id);
      if (result && "error" in result) {
        setRestoreError(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      {campaigns.length > 0 ? (
        <div
          data-testid="campaign-ribbon"
          className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-panel border border-hairline bg-muted/40 px-4 py-2 text-sm text-body"
        >
          <span className="font-medium">Active campaigns:</span>
          {campaigns.map((campaign, index) => (
            <span key={campaign.id}>
              <Link
                href={`/campaigns/${campaign.id}`}
                className="underline underline-offset-2 hover:text-foreground"
              >
                {campaign.name}
              </Link>
              {index < campaigns.length - 1 ? "," : null}
            </span>
          ))}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2 text-sm text-body">
          <input
            type="checkbox"
            checked={fullDay}
            onChange={(event) => setFullDay(event.target.checked)}
          />
          Show full day
        </label>
        <label className="flex items-center gap-2 text-sm text-body">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(event) => setShowArchived(event.target.checked)}
          />
          Show archived
        </label>
        {canManage ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="ml-auto"
            onClick={() => openCreate([], windowStart)}
          >
            New rule
          </Button>
        ) : null}
      </div>

      <div className="overflow-x-auto rounded-panel border border-hairline bg-surface">
        <div className="min-w-[48rem]">
          <div className="grid grid-cols-[4rem_repeat(7,1fr)] border-b border-hairline text-xs font-medium text-muted-foreground">
            <div className="px-2 py-2">Time</div>
            {WEEKDAYS.map((weekday) => (
              <div key={weekday.value} className="px-2 py-2 text-center">
                {weekday.short}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-[4rem_repeat(7,1fr)]">
            <div className="relative" style={{ height: gridHeight }}>
              {rowStarts.map((minute) => (
                <div
                  key={minute}
                  className="absolute right-2 -translate-y-1/2 text-[10px] text-muted-foreground"
                  style={{ top: (minute - windowStart) * PX_PER_MINUTE }}
                >
                  {minutesToHHMM(minute)}
                </div>
              ))}
            </div>

            {WEEKDAYS.map((weekday) => {
              const dayRules = visibleRules.filter((rule) =>
                rule.daysOfWeek.includes(weekday.value),
              );
              return (
                <div
                  key={weekday.value}
                  className="relative border-l border-hairline"
                  style={{ height: gridHeight }}
                >
                  {rowStarts.map((minute) => (
                    <div
                      key={minute}
                      className="absolute inset-x-0 border-b border-hairline/60"
                      style={{
                        top: (minute - windowStart) * PX_PER_MINUTE,
                        height: ROW_MINUTES * PX_PER_MINUTE,
                      }}
                    >
                      {canManage ? (
                        <button
                          type="button"
                          aria-label={`Add a rule on ${weekday.long} at ${minutesToHHMM(minute)}`}
                          className="size-full"
                          onClick={() =>
                            openCreate([weekday.value], minute)
                          }
                        />
                      ) : null}
                    </div>
                  ))}

                  {dayRules.map((rule) => {
                    const top = Math.max(rule.startMinute, windowStart);
                    const bottom = Math.min(rule.endMinute, DAY_END);
                    if (bottom <= top) return null;
                    const caption = effectiveCaption(rule);
                    return (
                      <button
                        key={`${rule.id}-${weekday.value}`}
                        type="button"
                        data-rule-block={rule.id}
                        onClick={
                          canManage ? () => openEdit(rule) : undefined
                        }
                        className={cn(
                          "absolute inset-x-1 overflow-hidden rounded-md border border-primary/40 bg-primary/10 px-1.5 py-1 text-left text-[11px] leading-tight",
                          rule.enabled === false && "opacity-60",
                          canManage ? "cursor-pointer" : "cursor-default",
                        )}
                        style={{
                          top: (top - windowStart) * PX_PER_MINUTE,
                          height: (bottom - top) * PX_PER_MINUTE,
                        }}
                      >
                        <span className="block font-medium">
                          {payloadName(rule)}
                        </span>
                        <span className="block text-muted-foreground">
                          {`${minutesToHHMM(rule.startMinute)} to ${minutesToHHMM(rule.endMinute)}`}
                        </span>
                        {rule.enabled === false ? (
                          <span className="mt-0.5 inline-block rounded bg-muted px-1 text-[10px] text-muted-foreground">
                            Paused
                          </span>
                        ) : null}
                        {caption ? (
                          <span className="block text-[10px] text-muted-foreground">
                            {caption}
                          </span>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {showArchived ? (
        <div className="space-y-2 rounded-panel border border-hairline bg-surface p-4">
          <p className="text-sm font-medium text-body">Archived rules</p>
          {restoreError ? (
            <p
              role="alert"
              className="rounded-lg border border-destructive/30 bg-destructive/10 p-2 text-sm text-destructive"
            >
              {restoreError}
            </p>
          ) : null}
          {archivedRules.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No archived rules for this screen.
            </p>
          ) : (
            <ul className="space-y-2">
              {archivedRules.map((rule) => (
                <li
                  key={rule.id}
                  className="flex flex-wrap items-center gap-3 text-sm text-body"
                >
                  <span className="font-medium">{payloadName(rule)}</span>
                  <span className="text-muted-foreground">
                    {`${minutesToHHMM(rule.startMinute)} to ${minutesToHHMM(rule.endMinute)}`}
                  </span>
                  {canManage ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="ml-auto"
                      disabled={pending}
                      onClick={() => onRestore(rule.id)}
                    >
                      Restore
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}

      {dialog.open ? (
        <ScheduleRuleDialog
          key={dialog.key}
          open
          onOpenChange={(next) => {
            if (!next) closeDialog();
          }}
          mode={dialog.mode}
          rule={dialog.mode === "edit" ? dialog.rule : null}
          prefill={dialog.mode === "create" ? dialog.prefill : null}
          screenId={screenId}
          playlistOptions={playlistOptions}
          campaignOptions={campaignOptions}
          locationOptions={locationOptions}
          canManage={canManage}
          canDelete={canDelete}
        />
      ) : null}
    </div>
  );
}
