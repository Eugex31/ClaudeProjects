"use client";

import * as React from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export interface PairScreenDialogProps {
  pairingCode: string | null;
  onOpenChange: (open: boolean) => void;
}

/**
 * Shown right after a screen is created (or its code regenerated): the pairing
 * code in large type plus a one-line instruction for the person standing at the
 * screen. Controlled by the presence of a `pairingCode`.
 */
export function PairScreenDialog({ pairingCode, onOpenChange }: PairScreenDialogProps) {
  return (
    <Dialog open={pairingCode !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Pair this screen</DialogTitle>
          <DialogDescription>
            Open LyneSign on your screen and enter this code. It is single use and
            expires once the screen connects.
          </DialogDescription>
        </DialogHeader>

        <p
          className="rounded-panel border border-hairline bg-muted py-6 text-center font-display text-4xl font-semibold tracking-[0.3em] text-ink"
          aria-label="Pairing code"
        >
          {pairingCode}
        </p>

        <DialogFooter showCloseButton />
      </DialogContent>
    </Dialog>
  );
}
