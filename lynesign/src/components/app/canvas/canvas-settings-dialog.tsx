"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { updateCanvas } from "@/app/(app)/canvas/actions";
import { Button } from "@/components/ui/button";
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
import type {
  CanvasEditorAsset,
  CanvasTree,
} from "@/components/app/canvas/canvas-editor";

const HEX_PATTERN = /^#[0-9a-fA-F]{6}$/;
const MIN_DIMENSION = 240;
const MAX_DIMENSION = 7680;

export interface CanvasSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canvas: CanvasTree;
  /** IMAGE assets for the background picker. Filtered to `kind === "IMAGE"`
   * before use. Not on the original brief prop list; the picker cannot work
   * without it. */
  assets: CanvasEditorAsset[];
  canManage: boolean;
}

function clampDimension(raw: string, fallback: number): number {
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(MAX_DIMENSION, Math.max(MIN_DIMENSION, parsed));
}

/**
 * Controlled settings dialog for the whole canvas. It edits the name, the pixel
 * size, the background colour and the background image, warns before a shrink
 * that would leave a panel hanging past the new edge, and submits only the
 * fields that changed through {@link updateCanvas}. An explicit `null` clears the
 * background image; an absent key leaves it untouched. Fields reset to the
 * current canvas every time the dialog opens.
 */
export function CanvasSettingsDialog({
  open,
  onOpenChange,
  canvas,
  assets,
  canManage,
}: CanvasSettingsDialogProps) {
  const router = useRouter();
  const images = React.useMemo(
    () => assets.filter((asset) => asset.kind === "IMAGE"),
    [assets],
  );

  const [name, setName] = React.useState(canvas.name);
  const [width, setWidth] = React.useState(canvas.width.toString());
  const [height, setHeight] = React.useState(canvas.height.toString());
  const [color, setColor] = React.useState(canvas.backgroundColor ?? "#000000");
  /** `undefined` keeps the current image, `null` clears it, a string sets it. */
  const [imageChoice, setImageChoice] = React.useState<
    string | null | undefined
  >(undefined);
  const [pickerOpen, setPickerOpen] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [wasOpen, setWasOpen] = React.useState(open);
  const [pending, startTransition] = React.useTransition();

  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setName(canvas.name);
      setWidth(canvas.width.toString());
      setHeight(canvas.height.toString());
      setColor(canvas.backgroundColor ?? "#000000");
      setImageChoice(undefined);
      setPickerOpen(false);
      setError(null);
    }
  }

  const nextWidth = clampDimension(width, canvas.width);
  const nextHeight = clampDimension(height, canvas.height);
  const clippedCount = canvas.panels.filter(
    (panel) =>
      panel.x + panel.width > nextWidth || panel.y + panel.height > nextHeight,
  ).length;

  const colorValid = HEX_PATTERN.test(color);
  const chosenImage =
    typeof imageChoice === "string"
      ? images.find((asset) => asset.id === imageChoice)
      : undefined;

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError("Enter a canvas name.");
      return;
    }
    if (!colorValid) {
      setError("Enter a background colour as a six digit hex value.");
      return;
    }
    setError(null);

    const patch: {
      name?: string;
      width?: number;
      height?: number;
      backgroundColor?: string;
      backgroundImageId?: string | null;
    } = {};
    if (trimmedName !== canvas.name) patch.name = trimmedName;
    if (nextWidth !== canvas.width) patch.width = nextWidth;
    if (nextHeight !== canvas.height) patch.height = nextHeight;
    if (color !== (canvas.backgroundColor ?? "#000000")) {
      patch.backgroundColor = color;
    }
    if (imageChoice === null || typeof imageChoice === "string") {
      patch.backgroundImageId = imageChoice;
    }

    if (Object.keys(patch).length === 0) {
      onOpenChange(false);
      return;
    }

    startTransition(async () => {
      const result = await updateCanvas(canvas.id, patch);
      if ("error" in result) {
        setError(result.error);
        toast.error(result.error);
        return;
      }
      toast.success("Canvas updated.");
      onOpenChange(false);
      router.refresh();
    });
  }

  const backgroundLabel =
    imageChoice === null
      ? "Background image cleared."
      : chosenImage
        ? chosenImage.name
        : canvas.backgroundImageUrl
          ? "Current background image kept."
          : "No background image.";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Canvas settings</DialogTitle>
          <DialogDescription>
            Name the canvas, set its pixel size, and choose the background every
            panel sits on.
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
            <Label htmlFor="canvas-settings-name">Name</Label>
            <Input
              id="canvas-settings-name"
              required
              autoFocus
              maxLength={120}
              value={name}
              disabled={!canManage}
              onChange={(event) => setName(event.target.value)}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="canvas-settings-width">Width</Label>
              <Input
                id="canvas-settings-width"
                type="number"
                min={MIN_DIMENSION}
                max={MAX_DIMENSION}
                value={width}
                disabled={!canManage}
                onChange={(event) => setWidth(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="canvas-settings-height">Height</Label>
              <Input
                id="canvas-settings-height"
                type="number"
                min={MIN_DIMENSION}
                max={MAX_DIMENSION}
                value={height}
                disabled={!canManage}
                onChange={(event) => setHeight(event.target.value)}
              />
            </div>
          </div>

          {clippedCount > 0 ? (
            <p className="text-xs text-destructive">
              {clippedCount === 1
                ? "1 panel would sit past the new edge. It stays in place and you can move it back."
                : `${clippedCount} panels would sit past the new edge. They stay in place and you can move them back.`}
            </p>
          ) : null}

          <div className="space-y-1.5">
            <Label htmlFor="canvas-settings-color">Background colour</Label>
            <div className="flex items-center gap-2">
              <input
                id="canvas-settings-color"
                type="color"
                className="h-8 w-12 rounded border border-input bg-transparent"
                value={colorValid ? color : "#000000"}
                disabled={!canManage}
                onChange={(event) => setColor(event.target.value)}
              />
              <Input
                aria-label="Background colour hex value"
                className="w-32"
                maxLength={7}
                value={color}
                aria-invalid={!colorValid}
                disabled={!canManage}
                onChange={(event) => setColor(event.target.value)}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Background image</Label>
            <p className="text-xs text-muted-foreground">{backgroundLabel}</p>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={!canManage || images.length === 0}
                onClick={() => setPickerOpen((value) => !value)}
              >
                {images.length === 0 ? "No images in library" : "Choose image"}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={!canManage}
                onClick={() => {
                  setImageChoice(null);
                  setPickerOpen(false);
                }}
              >
                Clear
              </Button>
            </div>
            {pickerOpen ? (
              <div className="grid max-h-48 grid-cols-3 gap-2 overflow-y-auto pr-1">
                {images.map((asset) => (
                  <button
                    key={asset.id}
                    type="button"
                    aria-label={`Select ${asset.name}`}
                    className="flex flex-col overflow-hidden rounded-lg bg-card text-left ring-1 ring-foreground/10"
                    onClick={() => {
                      setImageChoice(asset.id);
                      setPickerOpen(false);
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

          <DialogFooter showCloseButton>
            <Button
              type="submit"
              disabled={pending || !canManage || name.trim().length === 0}
            >
              {pending ? "Saving" : "Save settings"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
