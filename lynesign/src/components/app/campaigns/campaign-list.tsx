import Link from "next/link";

import { Badge } from "@/components/ui/badge";

export interface CampaignListRow {
  id: string;
  name: string;
  playlistName: string;
  windowLabel: string;
  status: string;
  targetLabel: string;
  priority: number;
}

const statusVariant: Record<
  string,
  "default" | "secondary" | "outline"
> = {
  Active: "default",
  Scheduled: "secondary",
  Ended: "outline",
  Paused: "outline",
};

/**
 * Campaigns index rendered as a plain list. Each row links to the campaign
 * detail and summarizes its playlist, run window, live status, target reach
 * and priority. No interactivity, so this stays a server component.
 */
export function CampaignList({ rows }: { rows: CampaignListRow[] }) {
  return (
    <ul className="divide-y divide-hairline rounded-panel border border-hairline bg-surface">
      {rows.map((row) => (
        <li key={row.id}>
          <Link
            href={`/campaigns/${row.id}`}
            className="flex flex-col gap-1 px-4 py-3 transition-colors hover:bg-muted/50 sm:flex-row sm:items-baseline sm:justify-between"
          >
            <span className="flex items-center gap-2">
              <span className="font-medium text-ink">{row.name}</span>
              <Badge variant={statusVariant[row.status] ?? "outline"}>
                {row.status}
              </Badge>
            </span>
            <span className="flex flex-wrap gap-x-3 gap-y-1 text-sm text-body">
              <span>{row.playlistName}</span>
              <span>{row.windowLabel}</span>
              <span>{row.targetLabel}</span>
              <span>{`Priority ${row.priority}`}</span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
