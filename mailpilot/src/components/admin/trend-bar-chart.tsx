"use client";

import { useState } from "react";

type Point = { month: string; value: number };

function formatMonthLabel(monthKey: string): string {
  const [year, month] = monthKey.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString(undefined, { month: "short" });
}

// Single-series magnitude-over-time — one hue (the app's own --primary token,
// already theme-aware), no categorical palette to validate since there's
// only one series to distinguish. Rounded bar tops, a hover tooltip per bar
// rather than a label on every bar, recessive axis line.
export function TrendBarChart({
  data,
  formatValue,
  height = 160,
}: {
  data: Point[];
  formatValue: (value: number) => string;
  height?: number;
}) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const max = Math.max(1, ...data.map((d) => d.value));
  const barWidth = 100 / data.length;

  return (
    <div className="relative">
      <svg viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" className="h-40 w-full overflow-visible">
        <line x1="0" y1={height - 20} x2="100" y2={height - 20} className="stroke-border" strokeWidth="0.5" />
        {data.map((d, i) => {
          const barHeight = (d.value / max) * (height - 28);
          const x = i * barWidth + barWidth * 0.15;
          const w = barWidth * 0.7;
          const y = height - 20 - barHeight;
          return (
            <g key={d.month}>
              <rect
                x={x}
                y={y}
                width={w}
                height={Math.max(barHeight, 1)}
                rx={Math.min(2, w / 2)}
                className={hoverIndex === i ? "fill-primary" : "fill-primary/70"}
                onMouseEnter={() => setHoverIndex(i)}
                onMouseLeave={() => setHoverIndex(null)}
              />
            </g>
          );
        })}
      </svg>
      <div className="flex text-[10px] text-muted-foreground">
        {data.map((d, i) => (
          <span key={d.month} className="flex-1 text-center" style={{ opacity: i % 2 === 0 ? 1 : 0.5 }}>
            {formatMonthLabel(d.month)}
          </span>
        ))}
      </div>
      {hoverIndex !== null && (
        <div
          className="pointer-events-none absolute top-0 -translate-x-1/2 rounded-md border bg-popover px-2 py-1 text-xs text-popover-foreground shadow-md"
          style={{ left: `${hoverIndex * barWidth + barWidth / 2}%` }}
        >
          <p className="font-medium">{formatMonthLabel(data[hoverIndex].month)}</p>
          <p>{formatValue(data[hoverIndex].value)}</p>
        </div>
      )}
    </div>
  );
}
