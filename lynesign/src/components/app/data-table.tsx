"use client";

import * as React from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, Inbox } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EmptyState } from "@/components/app/empty-state";

export interface DataTableColumn<T> {
  key: string;
  header: string;
  sortable?: boolean;
  render?: (row: T) => React.ReactNode;
}

export interface DataTableProps<T> {
  columns: DataTableColumn<T>[];
  rows: T[];
  emptyState?: React.ReactNode;
  pageSize?: number;
}

type SortDir = "asc" | "desc";

function rawValue<T>(row: T, key: string): unknown {
  return (row as Record<string, unknown>)[key];
}

function compareValues(a: unknown, b: unknown): number {
  if (a == null && b == null) return 0;
  if (a == null) return -1;
  if (b == null) return 1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "boolean" && typeof b === "boolean")
    return Number(a) - Number(b);
  if (a instanceof Date && b instanceof Date) return a.getTime() - b.getTime();
  return String(a).localeCompare(String(b));
}

/**
 * Small generic data table: optional per-column sorting (compares raw row
 * values, not rendered nodes) and simple prev / next pagination once the row
 * count exceeds `pageSize` (default 10).
 */
export function DataTable<T>({
  columns,
  rows,
  emptyState,
  pageSize = 10,
}: DataTableProps<T>) {
  const [sortKey, setSortKey] = React.useState<string | null>(null);
  const [sortDir, setSortDir] = React.useState<SortDir>("asc");
  const [page, setPage] = React.useState(0);

  const sortedRows = React.useMemo(() => {
    if (!sortKey) return rows;
    const dir = sortDir === "asc" ? 1 : -1;
    return [...rows].sort(
      (a, b) => compareValues(rawValue(a, sortKey), rawValue(b, sortKey)) * dir,
    );
  }, [rows, sortKey, sortDir]);

  const paginated = rows.length > pageSize;
  const pageCount = paginated ? Math.ceil(sortedRows.length / pageSize) : 1;
  const safePage = Math.min(page, pageCount - 1);
  const visibleRows = paginated
    ? sortedRows.slice(safePage * pageSize, safePage * pageSize + pageSize)
    : sortedRows;

  function toggleSort(key: string) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
    setPage(0);
  }

  if (rows.length === 0) {
    return (
      <>
        {emptyState ?? (
          <EmptyState
            icon={Inbox}
            title="Nothing here yet"
            description="There are no rows to show."
          />
        )}
      </>
    );
  }

  return (
    <div className="space-y-3">
      <Table>
        <TableHeader>
          <TableRow>
            {columns.map((col) => {
              const active = sortKey === col.key;
              const SortIcon = !active
                ? ArrowUpDown
                : sortDir === "asc"
                  ? ArrowUp
                  : ArrowDown;
              return (
                <TableHead
                  key={col.key}
                  aria-sort={
                    col.sortable
                      ? active
                        ? sortDir === "asc"
                          ? "ascending"
                          : "descending"
                        : "none"
                      : undefined
                  }
                >
                  {col.sortable ? (
                    <button
                      type="button"
                      onClick={() => toggleSort(col.key)}
                      className={cn(
                        "inline-flex items-center gap-1 font-medium text-foreground transition-colors hover:text-ink",
                        active && "text-ink",
                      )}
                    >
                      {col.header}
                      <SortIcon className="size-3.5 opacity-60" aria-hidden />
                    </button>
                  ) : (
                    col.header
                  )}
                </TableHead>
              );
            })}
          </TableRow>
        </TableHeader>
        <TableBody>
          {visibleRows.map((row, i) => (
            <TableRow key={(row as { id?: string }).id ?? i}>
              {columns.map((col) => (
                <TableCell key={col.key}>
                  {col.render
                    ? col.render(row)
                    : String(rawValue(row, col.key) ?? "")}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {paginated ? (
        <div className="flex items-center justify-between text-sm text-body">
          <span>
            Page {safePage + 1} of {pageCount}
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={safePage === 0}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
              disabled={safePage >= pageCount - 1}
            >
              Next
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
