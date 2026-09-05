import * as React from "react";

import { cn } from "@/lib/utils";

export interface HeadingProps extends React.ComponentProps<"h2"> {
  lead: string;
  accent?: string;
  as?: "h1" | "h2";
}

/**
 * Two-tone LyneSign headline: a navy lead word (or phrase) followed by one tan
 * accent word, rendered inside a single heading element so it exposes exactly
 * one accessible name equal to `"{lead} {accent}"`.
 */
export function Heading({
  lead,
  accent,
  as: Tag = "h2",
  className,
  ...props
}: HeadingProps) {
  return (
    <Tag
      className={cn(
        "font-display font-bold tracking-tight text-ink",
        Tag === "h1" ? "text-3xl" : "text-2xl",
        className,
      )}
      {...props}
    >
      <span className="text-ink">{lead}</span>
      {accent ? (
        <>
          {" "}
          <span className="text-tan">{accent}</span>
        </>
      ) : null}
    </Tag>
  );
}
