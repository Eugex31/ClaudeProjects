"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { toast } from "sonner";

import {
  setClockContent,
  setImageContent,
  setTextContent,
  setVideoContent,
  setWebContent,
} from "@/app/(app)/canvas/actions";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type {
  CanvasEditorAsset,
} from "@/components/app/canvas/canvas-editor";
import type { FrameVM } from "@/components/app/canvas/canvas-stage";

type ActionResult = { ok: true } | { error: string };

const IMAGE_MODES = ["cover", "contain", "fill", "none"] as const;
type ImageMode = (typeof IMAGE_MODES)[number];

/** One label per `Clock.type` value, kept to a single clean line each. */
const CLOCK_STYLES = [
  "Digital, large",
  "Digital, compact",
  "Analog face",
  "Text only",
] as const;

/** A short IANA list for the timezone select. The blank value means the screen
 * renders the clock in its own local time. */
const TIME_ZONES = [
  "UTC",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Africa/Johannesburg",
  "Asia/Dubai",
  "Asia/Kolkata",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Australia/Sydney",
] as const;

const WEB_URL_PATTERN = /^https?:\/\//i;

export interface FrameContentEditorProps {
  frame: FrameVM;
  assets: CanvasEditorAsset[];
  canManage: boolean;
}

/**
 * The content form for one selected frame. It switches on `frame.type` and
 * renders exactly one of the five Plan 1 editors, or a read-only note for a
 * legacy frame kind the editor cannot change. Each editor calls its own
 * `set*Content` action and refreshes the route on success so the panel tree is
 * re-read; a failed call is toasted and leaves the field as the user left it.
 * Every mutating control is disabled while a write is in flight or when
 * `canManage` is false.
 */
export function FrameContentEditor({
  frame,
  assets,
  canManage,
}: FrameContentEditorProps) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const disabled = pending || !canManage;

  const run = React.useCallback(
    (action: () => Promise<ActionResult>) => {
      startTransition(async () => {
        const result = await action();
        if ("error" in result) {
          toast.error(result.error);
          return;
        }
        router.refresh();
      });
    },
    [router],
  );

  let body: React.ReactNode;
  switch (frame.type) {
    case "PICTURE":
      body = (
        <PictureEditor
          frame={frame}
          assets={assets}
          disabled={disabled}
          run={run}
        />
      );
      break;
    case "VIDEO":
      body = (
        <VideoEditor
          frame={frame}
          assets={assets}
          disabled={disabled}
          run={run}
        />
      );
      break;
    case "MEMO":
      body = <MemoEditor frame={frame} disabled={disabled} run={run} />;
      break;
    case "CLOCK":
      body = <ClockEditor frame={frame} disabled={disabled} run={run} />;
      break;
    case "WEB":
      body = <WebEditor frame={frame} disabled={disabled} run={run} />;
      break;
    default:
      body = (
        <p className="text-sm text-muted-foreground">
          This frame type is not editable here.
        </p>
      );
  }

  return (
    <div className="rounded-panel border border-hairline bg-surface">
      <div className="border-b border-hairline px-3 py-2">
        <span className="text-sm font-medium text-ink">Frame content</span>
      </div>
      <div className="space-y-3 px-3 py-3">{body}</div>
    </div>
  );
}

interface EditorChildProps {
  frame: FrameVM;
  /** True while a write is in flight or the viewer cannot manage the canvas. */
  disabled: boolean;
  run: (action: () => Promise<ActionResult>) => void;
}

/** Grid of library thumbnails used by the image and video editors. */
function AssetPicker({
  assets,
  label,
  onPick,
  disabled,
}: {
  assets: CanvasEditorAsset[];
  label: string;
  onPick: (assetId: string) => void;
  disabled: boolean;
}) {
  const [open, setOpen] = React.useState(false);

  if (assets.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No ready media of this kind in your library yet.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
      >
        {label}
      </Button>
      {open ? (
        <div className="grid max-h-56 grid-cols-3 gap-2 overflow-y-auto pr-1">
          {assets.map((asset) => (
            <button
              key={asset.id}
              type="button"
              aria-label={`Select ${asset.name}`}
              disabled={disabled}
              className="flex flex-col overflow-hidden rounded-lg bg-card text-left ring-1 ring-foreground/10"
              onClick={() => {
                setOpen(false);
                onPick(asset.id);
              }}
            >
              <span className="flex aspect-video w-full items-center justify-center bg-muted">
                {asset.thumbnailUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={asset.thumbnailUrl}
                    alt={asset.name}
                    className="size-full object-cover"
                  />
                ) : null}
              </span>
              <span
                className="truncate p-1.5 text-xs font-medium text-ink"
                title={asset.name}
              >
                {asset.name}
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function CurrentAsset({
  asset,
  emptyText,
}: {
  asset: CanvasEditorAsset | undefined;
  emptyText: string;
}) {
  if (!asset) {
    return <p className="text-sm text-muted-foreground">{emptyText}</p>;
  }
  return (
    <div className="flex items-center gap-2">
      <span className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted">
        {asset.thumbnailUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={asset.thumbnailUrl}
            alt={asset.name}
            className="size-full object-cover"
          />
        ) : null}
      </span>
      <span className="truncate text-sm text-ink" title={asset.name}>
        {asset.name}
      </span>
    </div>
  );
}

function PictureEditor({
  frame,
  assets,
  disabled,
  run,
}: EditorChildProps & { assets: CanvasEditorAsset[] }) {
  const images = assets.filter((asset) => asset.kind === "IMAGE");
  const currentId = frame.content?.picture?.mediaAssetId ?? null;
  const current = images.find((asset) => asset.id === currentId);
  const rawMode = frame.content?.picture?.mode;
  const mode: ImageMode =
    rawMode && (IMAGE_MODES as readonly string[]).includes(rawMode)
      ? (rawMode as ImageMode)
      : "cover";

  return (
    <div className="space-y-3">
      <CurrentAsset asset={current} emptyText="No image chosen yet." />
      <AssetPicker
        assets={images}
        label="Choose image"
        disabled={disabled}
        onPick={(mediaAssetId) =>
          run(() => setImageContent({ frameId: frame.id, mediaAssetId, mode }))
        }
      />
      <div className="space-y-1.5">
        <Label htmlFor={`frame-${frame.id}-image-mode`}>Fit</Label>
        <select
          id={`frame-${frame.id}-image-mode`}
          className="h-8 w-full rounded-lg border border-input bg-transparent px-2 text-sm"
          value={mode}
          disabled={disabled || !currentId}
          onChange={(event) => {
            if (!currentId) return;
            run(() =>
              setImageContent({
                frameId: frame.id,
                mediaAssetId: currentId,
                mode: event.target.value as ImageMode,
              }),
            );
          }}
        >
          {IMAGE_MODES.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

function VideoEditor({
  frame,
  assets,
  disabled,
  run,
}: EditorChildProps & { assets: CanvasEditorAsset[] }) {
  const videos = assets.filter((asset) => asset.kind === "VIDEO");
  const currentId = frame.content?.video?.mediaAssetId ?? null;
  const current = videos.find((asset) => asset.id === currentId);

  return (
    <div className="space-y-3">
      <CurrentAsset asset={current} emptyText="No video chosen yet." />
      <AssetPicker
        assets={videos}
        label="Choose video"
        disabled={disabled}
        onPick={(mediaAssetId) =>
          run(() => setVideoContent({ frameId: frame.id, mediaAssetId }))
        }
      />
    </div>
  );
}

function MemoEditor({ frame, disabled, run }: EditorChildProps) {
  const saved = frame.content?.memo?.body ?? "";
  const [value, setValue] = React.useState(saved);
  const [seen, setSeen] = React.useState(saved);

  if (seen !== saved) {
    setSeen(saved);
    setValue(saved);
  }

  function commit() {
    if (value === saved) return;
    run(() => setTextContent({ frameId: frame.id, body: value }));
  }

  return (
    <div className="space-y-1.5">
      <Label htmlFor={`frame-${frame.id}-memo`}>Text</Label>
      <Textarea
        id={`frame-${frame.id}-memo`}
        maxLength={5000}
        rows={5}
        value={value}
        disabled={disabled}
        onChange={(event) => setValue(event.target.value)}
        onBlur={commit}
      />
      <p className="text-xs text-muted-foreground">
        Enter the text to display. A frame with no text is skipped.
      </p>
    </div>
  );
}

interface ClockState {
  style: number;
  showDate: boolean;
  showTime: boolean;
  showSeconds: boolean;
  label: string;
  timeZone: string;
}

function readClock(frame: FrameVM): ClockState {
  const clock = frame.content?.clock;
  return {
    style: clock?.type ?? 0,
    showDate: clock?.showDate ?? false,
    showTime: clock?.showTime ?? true,
    showSeconds: clock?.showSeconds ?? false,
    label: clock?.label ?? "",
    timeZone: clock?.timeZone ?? "",
  };
}

/** A static "now" shifted into `timeZone`, formatted with date-fns for the
 * shape and `Intl` for the zone. It does not tick; the preview is a shape check,
 * not a running clock. */
function clockPreview(state: ClockState): string {
  const now = new Date();
  let zoned = now;
  if (state.timeZone) {
    try {
      zoned = new Date(now.toLocaleString("en-US", { timeZone: state.timeZone }));
      if (Number.isNaN(zoned.getTime())) zoned = now;
    } catch {
      zoned = now;
    }
  }
  const parts: string[] = [];
  if (state.label.trim()) parts.push(state.label.trim());
  if (state.showDate) parts.push(format(zoned, "EEEE, d MMMM yyyy"));
  if (state.showTime) {
    parts.push(format(zoned, state.showSeconds ? "HH:mm:ss" : "HH:mm"));
  }
  if (parts.length === 0) return "Nothing selected to show.";
  return parts.join("  |  ");
}

function ClockEditor({ frame, disabled, run }: EditorChildProps) {
  const saved = readClock(frame);
  const [state, setState] = React.useState<ClockState>(saved);
  const savedKey = JSON.stringify(saved);
  const [seenKey, setSeenKey] = React.useState(savedKey);

  if (seenKey !== savedKey) {
    setSeenKey(savedKey);
    setState(saved);
  }

  function commit(next: ClockState) {
    setState(next);
    run(() =>
      setClockContent({
        frameId: frame.id,
        style: next.style,
        showDate: next.showDate,
        showTime: next.showTime,
        showSeconds: next.showSeconds,
        // Explicit null, not undefined: an emptied caption or a switch back to
        // screen local time has to clear the saved column.
        label: next.label.trim() ? next.label.trim() : null,
        timeZone: next.timeZone ? next.timeZone : null,
      }),
    );
  }

  const toggles: Array<{ key: keyof ClockState; label: string }> = [
    { key: "showDate", label: "Show date" },
    { key: "showTime", label: "Show time" },
    { key: "showSeconds", label: "Show seconds" },
  ];

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor={`frame-${frame.id}-clock-style`}>Style</Label>
        <select
          id={`frame-${frame.id}-clock-style`}
          className="h-8 w-full rounded-lg border border-input bg-transparent px-2 text-sm"
          value={state.style}
          disabled={disabled}
          onChange={(event) =>
            commit({ ...state, style: Number.parseInt(event.target.value, 10) })
          }
        >
          {CLOCK_STYLES.map((styleLabel, index) => (
            <option key={styleLabel} value={index}>
              {styleLabel}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-1.5">
        {toggles.map((toggle) => (
          <label
            key={toggle.key}
            className="flex items-center gap-2 text-sm text-body"
          >
            <input
              type="checkbox"
              role="switch"
              aria-label={toggle.label}
              checked={state[toggle.key] as boolean}
              disabled={disabled}
              onChange={(event) =>
                commit({ ...state, [toggle.key]: event.target.checked })
              }
            />
            <span>{toggle.label}</span>
          </label>
        ))}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={`frame-${frame.id}-clock-label`}>Label</Label>
        <Input
          id={`frame-${frame.id}-clock-label`}
          maxLength={40}
          placeholder="Optional caption"
          value={state.label}
          disabled={disabled}
          onChange={(event) => setState({ ...state, label: event.target.value })}
          onBlur={() => {
            if (state.label !== saved.label) commit(state);
          }}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={`frame-${frame.id}-clock-zone`}>Time zone</Label>
        <select
          id={`frame-${frame.id}-clock-zone`}
          className="h-8 w-full rounded-lg border border-input bg-transparent px-2 text-sm"
          value={state.timeZone}
          disabled={disabled}
          onChange={(event) =>
            commit({ ...state, timeZone: event.target.value })
          }
        >
          <option value="">Screen local time</option>
          {TIME_ZONES.map((zone) => (
            <option key={zone} value={zone}>
              {zone}
            </option>
          ))}
        </select>
      </div>

      <p className="rounded-md bg-muted/50 px-2 py-1.5 text-sm text-body">
        {clockPreview(state)}
      </p>
    </div>
  );
}

function WebEditor({ frame, disabled, run }: EditorChildProps) {
  const saved = frame.content?.web?.url ?? "";
  const [value, setValue] = React.useState(saved);
  const [seen, setSeen] = React.useState(saved);
  const [showPreview, setShowPreview] = React.useState(false);

  if (seen !== saved) {
    setSeen(saved);
    setValue(saved);
  }

  const trimmed = value.trim();
  const invalid = trimmed.length > 0 && !WEB_URL_PATTERN.test(trimmed);

  function commit() {
    if (trimmed.length === 0 || invalid) return;
    if (trimmed === saved) return;
    run(() => setWebContent({ frameId: frame.id, url: trimmed }));
  }

  return (
    <div className="space-y-2">
      <div className="space-y-1.5">
        <Label htmlFor={`frame-${frame.id}-web-url`}>Web address</Label>
        <Input
          id={`frame-${frame.id}-web-url`}
          type="url"
          inputMode="url"
          placeholder="https://example.com"
          aria-invalid={invalid}
          value={value}
          disabled={disabled}
          onChange={(event) => setValue(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              event.currentTarget.blur();
            }
          }}
        />
        {invalid ? (
          <p role="alert" className="text-xs text-destructive">
            Enter a URL that starts with http or https.
          </p>
        ) : null}
      </div>

      <Button
        type="button"
        size="sm"
        variant="outline"
        aria-pressed={showPreview}
        disabled={invalid || trimmed.length === 0}
        onClick={() => setShowPreview((value) => !value)}
      >
        {showPreview ? "Hide preview" : "Preview"}
      </Button>

      {showPreview && !invalid && trimmed.length > 0 ? (
        <iframe
          title="Web frame preview"
          src={trimmed}
          sandbox="allow-scripts allow-same-origin"
          className={cn("h-64 w-full rounded-md border border-hairline")}
        />
      ) : null}
    </div>
  );
}
