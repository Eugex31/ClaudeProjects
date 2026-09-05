import Link from "next/link";

import { cn } from "@/lib/utils";
import { formatBytes } from "@/lib/format";

export interface StorageBarProps {
  /** Bytes used, as a base-10 string (bigint is not serializable across RSC). */
  used: string;
  /** Byte ceiling as a string, or null for an unlimited plan. */
  limit: string | null;
  className?: string;
}

/**
 * Storage meter for the media library masthead. `used` / `limit` arrive as
 * strings because the page reads them as bigints and bigint cannot cross the
 * server/client boundary. The percentage is computed in the bigint domain so a
 * petabyte-scale ceiling never overflows a double. At or above 80 percent the
 * fill turns amber; at or above 100 percent it turns red and an "over" marker
 * appears. An unlimited plan shows the used total and no track.
 */
export function StorageBar({ used, limit, className }: StorageBarProps) {
  const usedBytes = BigInt(used);
  const usedLabel = formatBytes(usedBytes);

  if (limit === null) {
    return (
      <div
        className={cn(
          "flex flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-panel border border-hairline bg-surface px-4 py-3 text-sm",
          className,
        )}
      >
        <div className="text-body">
          <span className="font-medium text-ink">{usedLabel}</span> used
        </div>
        <div className="flex items-center gap-3">
          <span className="text-body">Unlimited</span>
          <Link href="/billing" className="text-sm font-medium text-primary hover:underline">
            Manage storage
          </Link>
        </div>
      </div>
    );
  }

  const limitBytes = BigInt(limit);
  const pct =
    limitBytes > BigInt(0)
      ? Number((usedBytes * BigInt(100)) / limitBytes)
      : 0;
  const over = pct >= 100;
  const fillClass = over ? "bg-red-500" : pct >= 80 ? "bg-amber-500" : "bg-primary";

  return (
    <div
      className={cn(
        "space-y-2 rounded-panel border border-hairline bg-surface px-4 py-3",
        className,
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-sm">
        <div className="text-body">
          <span className="font-medium text-ink">{usedLabel}</span> of{" "}
          {formatBytes(limitBytes)} used
        </div>
        <div className="flex items-center gap-3">
          <span className={cn("tabular-nums", over ? "text-red-600" : "text-body")}>
            {pct}%
          </span>
          {over ? (
            <span className="rounded bg-red-500/10 px-1.5 py-0.5 text-xs font-medium text-red-600">
              over
            </span>
          ) : null}
          <Link href="/billing" className="text-sm font-medium text-primary hover:underline">
            Manage storage
          </Link>
        </div>
      </div>
      <div
        data-slot="storage-bar-track"
        className="h-2 w-full overflow-hidden rounded-full bg-muted"
      >
        <div
          className={cn("h-full rounded-full transition-all", fillClass)}
          style={{ width: `${Math.min(pct, 100)}%` }}
        />
      </div>
    </div>
  );
}
