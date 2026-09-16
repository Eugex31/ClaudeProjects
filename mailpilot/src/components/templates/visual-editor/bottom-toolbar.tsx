"use client";

import { useState } from "react";
import { useEditor } from "@grapesjs/react";
import { Button } from "@/components/ui/button";
import { Undo2, Redo2, Eye, Monitor, Smartphone } from "lucide-react";
import { cn } from "@/lib/utils";

// Device names come from whatever grapesjs-mjml actually registered
// (its `resetDevices` option replaces GrapesJS's defaults with an
// MJML-appropriate set) rather than a hardcoded guess — read live via
// editor.Devices.getDevices() so this doesn't silently break if the
// plugin's device names ever change.
function findDevice(names: string[], pattern: RegExp): string | undefined {
  return names.find((n) => pattern.test(n));
}

export function BottomToolbar() {
  const editor = useEditor();
  const [previewing, setPreviewing] = useState(false);

  const deviceNames = editor.Devices.getDevices().map((d) => d.get("name") as string);
  const desktopDevice = findDevice(deviceNames, /desktop/i) ?? deviceNames[0];
  const mobileDevice = findDevice(deviceNames, /mobile/i) ?? deviceNames[deviceNames.length - 1];
  const currentDevice = editor.getDevice();

  function togglePreview() {
    if (previewing) {
      editor.stopCommand("core:preview");
    } else {
      editor.runCommand("core:preview");
    }
    setPreviewing((p) => !p);
  }

  return (
    <div className="flex h-11 shrink-0 items-center justify-center gap-1 border-t bg-background px-4">
      <Button type="button" variant="ghost" size="icon" className="size-8" title="Undo" onClick={() => editor.UndoManager.undo()}>
        <Undo2 className="size-4" />
      </Button>
      <Button type="button" variant="ghost" size="icon" className="size-8" title="Redo" onClick={() => editor.UndoManager.redo()}>
        <Redo2 className="size-4" />
      </Button>
      <div className="mx-2 h-5 w-px bg-border" />
      <Button
        type="button"
        variant={previewing ? "secondary" : "ghost"}
        size="icon"
        className="size-8"
        title="Preview"
        onClick={togglePreview}
      >
        <Eye className="size-4" />
      </Button>
      <div className="mx-2 h-5 w-px bg-border" />
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className={cn("size-8", currentDevice === desktopDevice && "bg-secondary")}
        title="Desktop view"
        onClick={() => desktopDevice && editor.setDevice(desktopDevice)}
      >
        <Monitor className="size-4" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className={cn("size-8", currentDevice === mobileDevice && "bg-secondary")}
        title="Mobile view"
        onClick={() => mobileDevice && editor.setDevice(mobileDevice)}
      >
        <Smartphone className="size-4" />
      </Button>
    </div>
  );
}
