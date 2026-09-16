"use client";

import * as React from "react";

import type { ContentRow } from "@/lib/analytics/content";
import { playHours } from "@/lib/analytics/shape";
import { cn } from "@/lib/utils";

type SortKey =
  | "assetName"
  | "kind"
  | "plays"
  | "playSeconds"
  | "screensReached"
  | "lastAiredAt";

type SortDir = "asc" | "desc";

const NUMERIC_KEYS: readonly SortKey[] = ["plays", "playSeconds", "screensReached"];

const COLUMNS: ReadonlyArray<{ key: SortKey; label: string; numeric: boolean }> = [
  { key: "assetName", label: "Asset", numeric: false },
  { key: "kind", label: "Kind", numeric: false },
  { key: "plays", label: "Plays", numeric: true },
  { key: "playSeconds", label: "Play hours", numeric: true },
  { key: "screensReached", label: "Screens", numeric: true },
  { key: "lastAiredAt", label: "Last aired", numeric: false },
];

function isNumeric(key: SortKey): boolean {
  return NUMERIC_KEYS.includes(key);
}

function ymd(iso: string): string {
  return new Date(iso).toISOString().slice(0, 10);
}

/**
 * Compare two rows on one column. Numeric columns subtract; text columns
 * (including `kind`, which folds null to "-") use `<` / `>` so the order is
 * deterministic and locale-independent. `lastAiredAt` is an ISO string, so a
 * plain string compare is already chronological.
 */
function compareRows(a: ContentRow, b: ContentRow, key: SortKey): number {
  if (key === "plays" || key === "playSeconds" || key === "screensReached") {
    return a[key] - b[key];
  }
  const av = key === "kind" ? a.kind ?? "-" : a[key];
  const bv = key === "kind" ? b.kind ?? "-" : b[key];
  if (av < bv) return -1;
  if (av > bv) return 1;
  return 0;
}

/**
 * The per-asset content performance table. Client-only: the rows arrive from the
 * server already sorted by plays desc, and this component re-sorts in place when
 * a column header is clicked. Clicking a new column sorts by it (numeric columns
 * start descending, text columns ascending); clicking the active column flips
 * the direction. No refetch and no router involvement.
 */
export function ContentPerformanceTable({ rows }: { rows: ContentRow[] }) {
  const [sortKey, setSortKey] = React.useState<SortKey>("plays");
  const [sortDir, setSortDir] = React.useState<SortDir>("desc");

  const sortedRows = React.useMemo(() => {
    const dir = sortDir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => compareRows(a, b, sortKey) * dir);
  }, [rows, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(key);
    setSortDir(isNumeric(key) ? "desc" : "asc");
  }

  return (
    <div className="w-full overflow-x-auto rounded-panel border border-hairline bg-surface">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-hairline text-left text-body">
            {COLUMNS.map((col) => {
              const active = col.key === sortKey;
              return (
                <th
                  key={col.key}
                  scope="col"
                  aria-sort={
                    active
                      ? sortDir === "asc"
                        ? "ascending"
                        : "descending"
                      : "none"
                  }
                  className={cn(
                    "px-4 py-2 font-medium",
                    col.numeric && "text-right",
                  )}
                >
                  <button
                    type="button"
                    onClick={() => toggleSort(col.key)}
                    className={cn(
                      "inline-flex items-center gap-1 transition-colors hover:text-ink",
                      active && "text-ink",
                      col.numeric && "flex-row-reverse",
                    )}
                  >
                    <span>{col.label}</span>
                    <span aria-hidden className="text-[10px] opacity-60">
                      {active ? (sortDir === "asc" ? "up" : "down") : ""}
                    </span>
                  </button>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sortedRows.map((row) => (
            <tr
              key={row.mediaAssetId || "unattributed"}
              className="border-b border-hairline last:border-0"
            >
              <td className="px-4 py-2 text-ink">{row.assetName}</td>
              <td className="px-4 py-2">{row.kind ?? "-"}</td>
              <td className="px-4 py-2 text-right tabular-nums">{row.plays}</td>
              <td className="px-4 py-2 text-right tabular-nums">
                {playHours(row.playSeconds)}
              </td>
              <td className="px-4 py-2 text-right tabular-nums">
                {row.screensReached}
              </td>
              <td className="px-4 py-2">{ymd(row.lastAiredAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
