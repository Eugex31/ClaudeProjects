export interface PlaysByDayDatum {
  date: string;
  plays: number;
}

const CHART_HEIGHT = 100;
const BAR_WIDTH = 12;
const BAR_GAP = 2;
const LABEL_BAND = 16;

/**
 * Hand-rolled bar chart of plays per UTC day. Pure: it takes the already
 * zero-filled `byDay` series and renders a static `<svg>` with one `<rect>` per
 * day, each carrying a `<title>` for a native hover tooltip. Bar heights scale
 * to the busiest day in the range (floored at 1 so a single play still shows).
 * Up to three date labels sit under the axis: first, middle, last. When nothing
 * played in the range it renders a short line of text instead.
 */
export function PlaysByDayChart({ byDay }: { byDay: PlaysByDayDatum[] }) {
  const plays = byDay.map((d) => d.plays);
  const hasPlays = plays.some((p) => p > 0);

  if (!hasPlays) {
    return <p className="text-sm text-body">No plays in this range.</p>;
  }

  const maxPlays = Math.max(...plays, 1);
  const days = byDay.length;
  const width = Math.max(days * BAR_WIDTH, BAR_WIDTH);
  const totalHeight = CHART_HEIGHT + LABEL_BAND;

  const labelIndices =
    days >= 2
      ? Array.from(new Set([0, Math.floor((days - 1) / 2), days - 1]))
      : [0];

  return (
    <svg
      role="img"
      aria-label="Plays per day"
      viewBox={`0 0 ${width} ${totalHeight}`}
      preserveAspectRatio="none"
      className="h-32 w-full text-ink"
    >
      <line
        x1={0}
        y1={CHART_HEIGHT}
        x2={width}
        y2={CHART_HEIGHT}
        stroke="currentColor"
        strokeOpacity={0.25}
      />
      {byDay.map((d, i) => {
        const height = (d.plays / maxPlays) * CHART_HEIGHT;
        return (
          <rect
            key={d.date}
            x={i * BAR_WIDTH}
            y={CHART_HEIGHT - height}
            width={BAR_WIDTH - BAR_GAP}
            height={height}
            fill="currentColor"
          >
            <title>{`${d.date}: ${d.plays} plays`}</title>
          </rect>
        );
      })}
      {labelIndices.map((i) => {
        const isFirst = i === 0;
        const isLast = i === days - 1;
        const anchor = isFirst ? "start" : isLast ? "end" : "middle";
        const x = isFirst
          ? 0
          : isLast
            ? width
            : i * BAR_WIDTH + BAR_WIDTH / 2;
        return (
          <text
            key={byDay[i].date}
            x={x}
            y={totalHeight - 4}
            textAnchor={anchor}
            className="fill-body text-[9px]"
          >
            {byDay[i].date}
          </text>
        );
      })}
    </svg>
  );
}
