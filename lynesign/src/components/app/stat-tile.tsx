import * as React from "react";

import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";

export interface StatTileProps {
  label: string;
  value: React.ReactNode;
  hint?: string;
  tone?: "default" | "warning" | "danger";
  className?: string;
}

const TONE_VALUE: Record<NonNullable<StatTileProps["tone"]>, string> = {
  default: "text-ink",
  warning: "text-amber-600 dark:text-amber-400",
  danger: "text-destructive",
};

/**
 * Compact KPI card: a small body-copy label above a large display-font value,
 * with an optional hint line. `tone` tints the value for warning / danger.
 */
export function StatTile({
  label,
  value,
  hint,
  tone = "default",
  className,
}: StatTileProps) {
  return (
    <Card className={cn("gap-1 px-5", className)}>
      <p className="text-sm text-body">{label}</p>
      <p
        className={cn(
          "font-display text-3xl font-bold tracking-tight",
          TONE_VALUE[tone],
        )}
      >
        {value}
      </p>
      {hint ? <p className="text-xs text-body">{hint}</p> : null}
    </Card>
  );
}
