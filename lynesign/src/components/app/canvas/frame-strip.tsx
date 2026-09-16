"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  Clock,
  Globe,
  Image as ImageIcon,
  LayoutGrid,
  Plus,
  Type,
  Video,
} from "lucide-react";
import { toast } from "sonner";

import {
  createFrame,
  deleteFrame,
  reorderFrames,
  setFrameDuration,
} from "@/app/(app)/canvas/actions";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { FrameKind, FrameVM } from "@/components/app/canvas/canvas-stage";

/** Seconds a newly created frame plays until the strip's per-chip field is
 * changed. Ten seconds matches the playlist image default and is long enough to
 * read a clock or a memo. */
export const DEFAULT_FRAME_DURATION_SECONDS = 10;

/** The five frame kinds the Plan 1 editor can create. */
const ADD_MENU: Array<{ type: FrameKind; label: string }> = [
  { type: "PICTURE", label: "Image" },
  { type: "VIDEO", label: "Video" },
  { type: "MEMO", label: "Text" },
  { type: "CLOCK", label: "Clock" },
  { type: "WEB", label: "Web" },
];

const KIND_LABEL: Partial<Record<FrameKind, string>> = {
  CLOCK: "Clock",
  PICTURE: "Image",
  VIDEO: "Video",
  MEMO: "Text",
  WEB: "Web",
};

function KindGlyph({ kind }: { kind: FrameKind }) {
  const Icon =
    kind === "CLOCK"
      ? Clock
      : kind === "PICTURE"
        ? ImageIcon
        : kind === "VIDEO"
          ? Video
          : kind === "MEMO"
            ? Type
            : kind === "WEB"
              ? Globe
              : LayoutGrid;
  return <Icon aria-hidden className="size-4 text-muted-foreground" />;
}

/** True when a frame carries content a delete would throw away, which is when
 * the strip asks for an inline confirm first. */
function hasContent(frame: FrameVM): boolean {
  const content = frame.content;
  if (!content) return false;
  if (content.clock || content.picture || content.video || content.web) {
    return true;
  }
  return content.memo ? content.memo.body.trim().length > 0 : false;
}

export interface FrameStripProps {
  panelId: string;
  frames: FrameVM[];
  selectedFrameId: string | null;
  onSelectFrame: (id: string | null) => void;
  canManage: boolean;
}

/**
 * Horizontal list of the selected panel's frames. Chips select a frame for the
 * content editor and carry their own duration field, which calls
 * {@link setFrameDuration} on blur. Dragging a chip reorders the panel through
 * {@link reorderFrames} with the full new id order, reverting the local order
 * and toasting on `{ error }`. The Add menu creates a frame of the chosen kind
 * with {@link DEFAULT_FRAME_DURATION_SECONDS} and selects it. Every successful
 * mutation refreshes the route so the editor re-reads the panel tree.
 */
export function FrameStrip({
  panelId,
  frames,
  selectedFrameId,
  onSelectFrame,
  canManage,
}: FrameStripProps) {
  const router = useRouter();
  const [order, setOrder] = React.useState<FrameVM[]>(frames);
  const [seen, setSeen] = React.useState(frames);
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = React.useState<string | null>(
    null,
  );
  const [pending, startTransition] = React.useTransition();
  const dragIndexRef = React.useRef<number | null>(null);

  // Re-sync the local order when a route refresh brings a new frame list.
  if (seen !== frames) {
    setSeen(frames);
    setOrder(frames);
    setConfirmDeleteId(null);
  }

  function run(action: () => Promise<{ ok: true } | { error: string }>) {
    startTransition(async () => {
      const result = await action();
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      router.refresh();
    });
  }

  function moveChip(from: number, to: number) {
    if (from === to || from < 0 || to < 0) return;
    if (from >= order.length || to >= order.length) return;
    const next = order.slice();
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    const previous = order;
    setOrder(next);
    startTransition(async () => {
      const result = await reorderFrames({
        panelId,
        frameIds: next.map((frame) => frame.id),
      });
      if ("error" in result) {
        setOrder(previous);
        toast.error(result.error);
        return;
      }
      router.refresh();
    });
  }

  function addFrame(type: FrameKind) {
    setMenuOpen(false);
    startTransition(async () => {
      const result = await createFrame({
        panelId,
        type: type as "CLOCK" | "PICTURE" | "VIDEO" | "MEMO" | "WEB",
        durationSeconds: DEFAULT_FRAME_DURATION_SECONDS,
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      onSelectFrame(result.id);
      router.refresh();
    });
  }

  function removeFrame(id: string) {
    setConfirmDeleteId(null);
    if (id === selectedFrameId) onSelectFrame(null);
    run(() => deleteFrame(id));
  }

  function requestRemove(frame: FrameVM) {
    if (hasContent(frame)) {
      setConfirmDeleteId(frame.id);
      return;
    }
    removeFrame(frame.id);
  }

  return (
    <div className="rounded-panel border border-hairline bg-surface">
      <div className="flex items-center justify-between border-b border-hairline px-3 py-2">
        <span className="text-sm font-medium text-ink">Frames</span>
        {canManage ? (
          <div className="relative">
            <Button
              type="button"
              size="sm"
              variant="outline"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              disabled={pending}
              onClick={() => setMenuOpen((open) => !open)}
            >
              <Plus aria-hidden />
              Add frame
            </Button>
            {menuOpen ? (
              <ul
                role="menu"
                className="absolute right-0 z-10 mt-1 w-40 overflow-hidden rounded-panel border border-hairline bg-surface py-1 shadow-md"
              >
                {ADD_MENU.map((entry) => (
                  <li key={entry.type} role="none">
                    <button
                      type="button"
                      role="menuitem"
                      className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-body hover:bg-canvas"
                      onClick={() => addFrame(entry.type)}
                    >
                      <KindGlyph kind={entry.type} />
                      {entry.label}
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </div>

      {order.length === 0 ? (
        <p className="px-3 py-4 text-sm text-muted-foreground">
          No frames yet. Use Add frame to place the first one.
        </p>
      ) : (
        <ul className="flex flex-wrap gap-2 px-3 py-3">
          {order.map((frame, index) => {
            const selected = frame.id === selectedFrameId;
            const kindLabel = KIND_LABEL[frame.type] ?? "Frame";
            return (
              <li
                key={frame.id}
                draggable={canManage}
                onDragStart={() => {
                  dragIndexRef.current = index;
                }}
                onDragOver={(event) => {
                  if (dragIndexRef.current !== null) event.preventDefault();
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  const from = dragIndexRef.current;
                  dragIndexRef.current = null;
                  if (from !== null) moveChip(from, index);
                }}
                className={cn(
                  "flex items-center gap-2 rounded-panel border px-2 py-1.5",
                  selected
                    ? "border-navy bg-canvas"
                    : "border-hairline bg-surface",
                )}
              >
                <button
                  type="button"
                  aria-pressed={selected}
                  aria-label={`Select ${kindLabel} frame ${index + 1}`}
                  className="flex items-center gap-1.5 text-sm text-ink"
                  onClick={() => onSelectFrame(frame.id)}
                >
                  <KindGlyph kind={frame.type} />
                  <span>{kindLabel}</span>
                </button>
                <FrameDurationField
                  frame={frame}
                  canManage={canManage}
                  disabled={pending}
                  onCommit={(durationSeconds) =>
                    run(() =>
                      setFrameDuration({ id: frame.id, durationSeconds }),
                    )
                  }
                />
                {canManage ? (
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="size-7 text-destructive"
                    aria-label={`Remove ${kindLabel} frame ${index + 1}`}
                    disabled={pending}
                    onClick={() => requestRemove(frame)}
                  >
                    <span aria-hidden>x</span>
                  </Button>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {confirmDeleteId ? (
        <div
          role="alertdialog"
          aria-label="Confirm frame delete"
          className="flex flex-wrap items-center gap-3 border-t border-hairline bg-muted/40 px-3 py-2 text-sm text-body"
        >
          <span>This frame has content. Delete it anyway?</span>
          <div className="ml-auto flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="destructive"
              disabled={pending}
              onClick={() => removeFrame(confirmDeleteId)}
            >
              Delete frame
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setConfirmDeleteId(null)}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

interface FrameDurationFieldProps {
  frame: FrameVM;
  canManage: boolean;
  disabled: boolean;
  onCommit: (durationSeconds: number) => void;
}

/** The per-chip seconds input. It keeps its own draft string so a partial edit
 * does not fire a write, and commits a valid changed value on blur or Enter. */
function FrameDurationField({
  frame,
  canManage,
  disabled,
  onCommit,
}: FrameDurationFieldProps) {
  const [value, setValue] = React.useState(frame.durationSeconds.toString());
  const [seen, setSeen] = React.useState(frame.durationSeconds);

  if (seen !== frame.durationSeconds) {
    setSeen(frame.durationSeconds);
    setValue(frame.durationSeconds.toString());
  }

  function commit() {
    const parsed = Number.parseInt(value.trim(), 10);
    if (!Number.isFinite(parsed) || parsed < 1 || parsed > 86400) {
      toast.error("Enter a duration between 1 and 86400 seconds.");
      setValue(frame.durationSeconds.toString());
      return;
    }
    if (parsed === frame.durationSeconds) return;
    onCommit(parsed);
  }

  return (
    <span className="flex items-center gap-1 text-xs text-body">
      <Input
        type="number"
        min={1}
        max={86400}
        inputMode="numeric"
        aria-label="Frame duration in seconds"
        className="h-7 w-16"
        value={value}
        disabled={!canManage || disabled}
        onChange={(event) => setValue(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            event.currentTarget.blur();
          }
        }}
      />
      <span aria-hidden>s</span>
    </span>
  );
}
