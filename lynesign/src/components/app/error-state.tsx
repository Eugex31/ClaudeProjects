"use client";

import { AlertCircle } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

const SUPPORT_MAILTO = "mailto:support@lynesign.com";

export interface ErrorStateProps {
  title?: string;
  detail: string;
  retry?: () => void;
  className?: string;
}

/**
 * Plain, non-alarming error panel. Shows a "Try again" button only when a
 * `retry` handler is supplied, plus a "Contact support" mail link.
 */
export function ErrorState({
  title = "Something went wrong",
  detail,
  retry,
  className,
}: ErrorStateProps) {
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-panel border border-hairline bg-surface px-6 py-12 text-center",
        className,
      )}
    >
      <div className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <AlertCircle className="size-6" aria-hidden />
      </div>
      <h3 className="font-display text-lg font-semibold text-ink">{title}</h3>
      <p className="max-w-prose text-sm text-body">{detail}</p>
      <div className="mt-2 flex items-center gap-2">
        {retry ? (
          <Button variant="outline" onClick={retry}>
            Try again
          </Button>
        ) : null}
        <Button asChild variant="link">
          <a href={SUPPORT_MAILTO}>Contact support</a>
        </Button>
      </div>
    </div>
  );
}
