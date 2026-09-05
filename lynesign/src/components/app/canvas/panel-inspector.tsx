"use client";

import * as React from "react";
import { ArrowDown, ArrowUp, Copy, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { PanelVM } from "@/components/app/canvas/canvas-stage";

/** The numeric geometry fields the inspector edits, in canvas pixels. */
const NUMERIC_FIELDS = [
  { key: "x", label: "X" },
  { key: "y", label: "Y" },
  { key: "width", label: "Width" },
  { key: "height", label: "Height" },
  { key: "zIndex", label: "Layer" },
] as const;

type NumericField = (typeof NUMERIC_FIELDS)[number]["key"];

export interface PanelInspectorProps {
  panel: PanelVM;
  canManage: boolean;
  /** Live local update as the user types. The editor merges the patch into its
   * panel array so the stage moves with the field. */
  onChange: (patch: Partial<PanelVM>) => void;
  /** Blur, Enter or a switch flip. `patch` carries the committed value of the
   * field that changed, so the editor never has to re-read a ref that has not
   * flushed yet. The editor persists the panel through `updatePanels` and
   * reverts to the pre-edit values on `{ error }`. */
  onCommit: (patch: Partial<PanelVM>) => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onZ: (dir: "forward" | "back") => void;
}

/**
 * Right-rail form for the selected panel. Every control is fully controlled from
 * the `panel` prop, so the stage and the inspector never drift: typing fires
 * `onChange` for the optimistic move and blur or Enter fires `onCommit` for the
 * save. The layer buttons call `onZ`, which the editor turns into a `swapZ` pair
 * write. All mutating controls are disabled when `canManage` is false.
 */
export function PanelInspector({
  panel,
  canManage,
  onChange,
  onCommit,
  onDelete,
  onDuplicate,
  onZ,
}: PanelInspectorProps) {
  function numericValue(field: NumericField): number {
    return panel[field];
  }

  function handleNumeric(field: NumericField, raw: string) {
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed)) return;
    onChange({ [field]: parsed } as Partial<PanelVM>);
  }

  function commitOnEnter(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      event.currentTarget.blur();
    }
  }

  /** Commit one field, reading its just-typed value from the controlled
   * `panel` prop (which `onChange` already refreshed) so no ref flush is
   * needed. */
  function commitField(field: "name" | NumericField) {
    onCommit({ [field]: panel[field] } as Partial<PanelVM>);
  }

  return (
    <div className="rounded-panel border border-hairline bg-surface">
      <div className="border-b border-hairline px-3 py-2">
        <span className="text-sm font-medium text-ink">Panel</span>
      </div>

      <div className="space-y-3 px-3 py-3">
        <div className="space-y-1.5">
          <Label htmlFor="panel-inspector-name">Name</Label>
          <Input
            id="panel-inspector-name"
            maxLength={80}
            placeholder="Untitled panel"
            value={panel.name ?? ""}
            disabled={!canManage}
            onChange={(event) => onChange({ name: event.target.value })}
            onBlur={() => commitField("name")}
            onKeyDown={commitOnEnter}
          />
        </div>

        <div className="grid grid-cols-2 gap-2">
          {NUMERIC_FIELDS.map((field) => (
            <div key={field.key} className="space-y-1.5">
              <Label htmlFor={`panel-inspector-${field.key}`}>
                {field.label}
              </Label>
              <Input
                id={`panel-inspector-${field.key}`}
                type="number"
                inputMode="numeric"
                value={numericValue(field.key)}
                disabled={!canManage}
                onChange={(event) =>
                  handleNumeric(field.key, event.target.value)
                }
                onBlur={() => commitField(field.key)}
                onKeyDown={commitOnEnter}
              />
            </div>
          ))}
        </div>

        <label className="flex items-center gap-2 text-sm text-body">
          <Checkbox
            checked={panel.noScroll}
            disabled={!canManage}
            aria-label="Clip content to the panel"
            onCheckedChange={(next) => {
              onChange({ noScroll: next === true });
              onCommit({ noScroll: next === true });
            }}
          />
          <span>Clip content to the panel</span>
        </label>

        <div className="flex flex-wrap gap-2 border-t border-hairline pt-3">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={!canManage}
            onClick={() => onZ("forward")}
          >
            <ArrowUp aria-hidden />
            Bring forward
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={!canManage}
            onClick={() => onZ("back")}
          >
            <ArrowDown aria-hidden />
            Send back
          </Button>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={!canManage}
            onClick={onDuplicate}
          >
            <Copy aria-hidden />
            Duplicate panel
          </Button>
          <Button
            type="button"
            size="sm"
            variant="destructive"
            disabled={!canManage}
            onClick={onDelete}
          >
            <Trash2 aria-hidden />
            Delete panel
          </Button>
        </div>
      </div>
    </div>
  );
}
