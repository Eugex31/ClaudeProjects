import * as React from "react";

import { cn } from "@/lib/utils";
import { Heading } from "@/components/app/heading";

export interface PageHeaderProps {
  title: string;
  accent?: string;
  description?: string;
  actions?: React.ReactNode;
  className?: string;
}

/**
 * Standard page masthead: two-tone {@link Heading}, an optional description in
 * body colour, and right-aligned action controls.
 */
export function PageHeader({
  title,
  accent,
  description,
  actions,
  className,
}: PageHeaderProps) {
  return (
    <div
      className={cn(
        "flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between",
        className,
      )}
    >
      <div className="space-y-1">
        <Heading as="h1" lead={title} accent={accent} />
        {description ? (
          <p className="max-w-prose text-sm text-body">{description}</p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex shrink-0 items-center gap-2 sm:justify-end">
          {actions}
        </div>
      ) : null}
    </div>
  );
}
