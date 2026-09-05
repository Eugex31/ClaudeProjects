"use client";

import { CheckCircle2, CircleAlert, Loader2, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

export type UploadRowStatus = "uploading" | "finalizing" | "done" | "failed";

export interface UploadRow {
  id: string;
  name: string;
  /** 0-100 while uploading. */
  pct: number;
  status: UploadRowStatus;
  message?: string;
}

export interface UploadQueueProps {
  rows: UploadRow[];
  onDismiss: () => void;
}

const STATUS_LABEL: Record<UploadRowStatus, string> = {
  uploading: "Uploading",
  finalizing: "Finishing",
  done: "Done",
  failed: "Failed",
};

/**
 * Transient panel that tracks in-flight uploads started from {@link MediaLibrary}.
 * Purely presentational: the parent owns the queue array and clears it with
 * `onDismiss` once nothing is still running.
 */
export function UploadQueue({ rows, onDismiss }: UploadQueueProps) {
  if (rows.length === 0) return null;

  const settled = rows.every((row) => row.status === "done" || row.status === "failed");

  return (
    <div className="space-y-2 rounded-panel border border-hairline bg-surface p-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-ink">Uploads</p>
        {settled ? (
          <Button variant="ghost" size="sm" className="h-7 px-2" onClick={onDismiss}>
            <X aria-hidden className="size-3.5" />
            Clear
          </Button>
        ) : null}
      </div>
      <ul className="space-y-1.5">
        {rows.map((row) => (
          <li key={row.id} className="flex items-center gap-3 text-sm">
            <span className="shrink-0">
              {row.status === "failed" ? (
                <CircleAlert aria-hidden className="size-4 text-destructive" />
              ) : row.status === "done" ? (
                <CheckCircle2 aria-hidden className="size-4 text-emerald-600" />
              ) : (
                <Loader2 aria-hidden className="size-4 animate-spin text-muted-foreground" />
              )}
            </span>
            <span className="min-w-0 flex-1 truncate text-body">{row.name}</span>
            <span className="w-24 shrink-0">
              <span className="block h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <span
                  className={cn(
                    "block h-full rounded-full",
                    row.status === "failed" ? "bg-destructive" : "bg-primary",
                  )}
                  style={{ width: `${row.status === "done" ? 100 : Math.min(row.pct, 100)}%` }}
                />
              </span>
            </span>
            <span className="w-16 shrink-0 text-right text-xs text-muted-foreground">
              {row.message ?? STATUS_LABEL[row.status]}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
