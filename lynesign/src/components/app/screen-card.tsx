import { formatDistanceToNow } from "date-fns";
import type { ScreenStatus } from "@prisma/client";

import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { StatusDot } from "@/components/app/status-dot";

export interface ScreenCardScreen {
  id: string;
  name: string;
  status: ScreenStatus;
  locationName?: string | null;
  lastSeenAt?: Date | string | null;
}

export interface ScreenCardProps {
  screen: ScreenCardScreen;
  className?: string;
}

function lastSeenLabel(lastSeenAt: Date | string | null | undefined): string {
  if (!lastSeenAt) return "Never";
  const date = typeof lastSeenAt === "string" ? new Date(lastSeenAt) : lastSeenAt;
  if (Number.isNaN(date.getTime())) return "Never";
  return formatDistanceToNow(date, { addSuffix: true });
}

/**
 * Summary card for a single screen: name, {@link StatusDot}, location, and a
 * relative "last seen" line (falls back to "Never").
 */
export function ScreenCard({ screen, className }: ScreenCardProps) {
  return (
    <Card className={cn("gap-2 px-5", className)}>
      <div className="flex items-start justify-between gap-3">
        <h3 className="font-display text-base font-semibold text-ink">
          {screen.name}
        </h3>
        <StatusDot status={screen.status} />
      </div>
      {screen.locationName ? (
        <p className="text-sm text-body">{screen.locationName}</p>
      ) : null}
      <p className="text-xs text-body">Last seen {lastSeenLabel(screen.lastSeenAt)}</p>
    </Card>
  );
}
