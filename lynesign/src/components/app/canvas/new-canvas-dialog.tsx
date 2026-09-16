"use client";

import * as React from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";

import { createCanvas } from "@/app/(app)/canvas/actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Preset = "landscape" | "portrait" | "uhd" | "custom";

const PRESETS: Array<{ value: Exclude<Preset, "custom">; label: string; width: number; height: number }> = [
  { value: "landscape", label: "Landscape 1920 x 1080", width: 1920, height: 1080 },
  { value: "portrait", label: "Portrait 1080 x 1920", width: 1080, height: 1920 },
  { value: "uhd", label: "4K 3840 x 2160", width: 3840, height: 2160 },
];

/**
 * "New canvas" trigger and dialog. Collects a name and a size, either one of the
 * three preset resolutions or a custom width and height, and submits to
 * {@link createCanvas}. A returned `{ error }` is shown inline and as a toast and
 * the dialog stays open; on success the action redirects to the new canvas, so
 * there is nothing more to do here.
 */
export function NewCanvasDialog() {
  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState("");
  const [preset, setPreset] = React.useState<Preset>("landscape");
  const [customWidth, setCustomWidth] = React.useState("");
  const [customHeight, setCustomHeight] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  function reset() {
    setName("");
    setPreset("landscape");
    setCustomWidth("");
    setCustomHeight("");
    setError(null);
  }

  function resolveSize(): { width: number; height: number } | null {
    if (preset !== "custom") {
      const match = PRESETS.find((p) => p.value === preset);
      return match ? { width: match.width, height: match.height } : null;
    }
    const width = Number(customWidth);
    const height = Number(customHeight);
    if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
    if (width <= 0 || height <= 0) return null;
    return { width, height };
  }

  const size = resolveSize();
  const missingRequired = name.trim().length === 0 || size === null;

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (missingRequired || size === null) return;
    setError(null);
    startTransition(async () => {
      const result = await createCanvas({
        name: name.trim(),
        width: size.width,
        height: size.height,
      });
      if ("error" in result) {
        setError(result.error);
        toast.error(result.error);
        return;
      }
      // The action redirects on success; this only runs when that is stubbed.
      setOpen(false);
      reset();
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Plus aria-hidden />
          New canvas
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New canvas</DialogTitle>
          <DialogDescription>
            Give the canvas a name and a size. You can add panels once it exists.
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
            <Label htmlFor="canvas-name">Name</Label>
            <Input
              id="canvas-name"
              name="name"
              required
              autoFocus
              maxLength={120}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <fieldset className="space-y-1.5">
            <legend className="text-sm font-medium">Size</legend>
            {PRESETS.map((option) => (
              <label
                key={option.value}
                className="flex items-center gap-2 text-sm"
              >
                <input
                  type="radio"
                  name="canvas-size"
                  checked={preset === option.value}
                  onChange={() => setPreset(option.value)}
                />
                {option.label}
              </label>
            ))}
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="canvas-size"
                checked={preset === "custom"}
                onChange={() => setPreset("custom")}
              />
              Custom
            </label>
          </fieldset>
          {preset === "custom" ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="canvas-width">Width</Label>
                <Input
                  id="canvas-width"
                  name="width"
                  type="number"
                  min={1}
                  max={8192}
                  value={customWidth}
                  onChange={(event) => setCustomWidth(event.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="canvas-height">Height</Label>
                <Input
                  id="canvas-height"
                  name="height"
                  type="number"
                  min={1}
                  max={8192}
                  value={customHeight}
                  onChange={(event) => setCustomHeight(event.target.value)}
                />
              </div>
            </div>
          ) : null}
          <DialogFooter showCloseButton>
            <Button type="submit" disabled={pending || missingRequired}>
              {pending ? "Creating" : "Create canvas"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
