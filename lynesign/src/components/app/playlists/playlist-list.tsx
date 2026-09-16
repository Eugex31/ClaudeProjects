import Link from "next/link";

export interface PlaylistListRow {
  id: string;
  name: string;
  itemCount: number;
  screenCount: number;
  updatedLabel: string;
}

/**
 * Playlists index rendered as a plain list. Each row links to the playlist
 * editor and summarizes its item count, how many screens are playing it, and
 * when it was last changed. No interactivity, so this stays a server component.
 */
export function PlaylistList({ rows }: { rows: PlaylistListRow[] }) {
  return (
    <ul className="divide-y divide-hairline rounded-panel border border-hairline bg-surface">
      {rows.map((row) => (
        <li key={row.id}>
          <Link
            href={`/playlists/${row.id}`}
            className="flex flex-col gap-1 px-4 py-3 transition-colors hover:bg-muted/50 sm:flex-row sm:items-baseline sm:justify-between"
          >
            <span className="font-medium text-ink">{row.name}</span>
            <span className="flex flex-wrap gap-x-3 gap-y-1 text-sm text-body">
              <span>{`${row.itemCount} ${row.itemCount === 1 ? "item" : "items"}`}</span>
              <span>{`on ${row.screenCount} ${row.screenCount === 1 ? "screen" : "screens"}`}</span>
              <span>{`Updated ${row.updatedLabel}`}</span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
