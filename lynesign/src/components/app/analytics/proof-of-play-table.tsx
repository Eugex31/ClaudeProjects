import Link from "next/link";

import type { ProofRow } from "@/lib/analytics/proof-of-play";
import { secondsToHM } from "@/lib/analytics/shape";

function ymd(iso: string): string {
  return new Date(iso).toISOString().slice(0, 10);
}

/**
 * Proof-of-play rollup for one grouping (campaigns or schedule rules). Purely
 * presentational: the rows arrive already ordered by airings desc, so there is
 * no client sort. The `kind` prop decides where each name links, built here so
 * no function has to cross the server boundary: campaigns link to their detail
 * page, schedule rules link to the schedule screen.
 */
export function ProofOfPlayTable({
  title,
  kind,
  rows,
}: {
  title: string;
  kind: "campaign" | "schedule";
  rows: ProofRow[];
}) {
  if (rows.length === 0) {
    const noun = kind === "campaign" ? "campaign" : "schedule";
    return (
      <p className="text-sm text-body">
        No {noun} playback in this range.
      </p>
    );
  }

  const hrefFor = (row: ProofRow): string =>
    kind === "campaign" ? `/campaigns/${row.id}` : "/schedule";

  return (
    <div className="w-full overflow-x-auto rounded-panel border border-hairline bg-surface">
      <table className="w-full text-sm">
        <caption className="px-4 py-2 text-left font-medium text-ink">
          {title}
        </caption>
        <thead>
          <tr className="border-b border-hairline text-left text-body">
            <th scope="col" className="px-4 py-2 font-medium">
              Name
            </th>
            <th scope="col" className="px-4 py-2 text-right font-medium">
              Airings
            </th>
            <th scope="col" className="px-4 py-2 text-right font-medium">
              Duration
            </th>
            <th scope="col" className="px-4 py-2 text-right font-medium">
              Screens
            </th>
            <th scope="col" className="px-4 py-2 text-right font-medium">
              Locations
            </th>
            <th scope="col" className="px-4 py-2 font-medium">
              First aired
            </th>
            <th scope="col" className="px-4 py-2 font-medium">
              Last aired
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.id}
              className="border-b border-hairline last:border-0"
            >
              <td className="px-4 py-2">
                <Link
                  href={hrefFor(row)}
                  className="font-medium text-ink transition-colors hover:text-body"
                >
                  {row.name}
                </Link>
              </td>
              <td className="px-4 py-2 text-right tabular-nums">{row.airings}</td>
              <td className="px-4 py-2 text-right tabular-nums">
                {secondsToHM(row.playSeconds)}
              </td>
              <td className="px-4 py-2 text-right tabular-nums">
                {row.screensReached}
              </td>
              <td className="px-4 py-2 text-right tabular-nums">
                {row.locationsReached}
              </td>
              <td className="px-4 py-2">{ymd(row.firstAiredAt)}</td>
              <td className="px-4 py-2">{ymd(row.lastAiredAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
