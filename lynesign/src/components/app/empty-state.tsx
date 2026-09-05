import * as React from "react";
import Link from "next/link";
import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

export interface EmptyStateAction {
  label: string;
  href: string;
}

export interface EmptyStateProps {
  icon: LucideIcon | React.ReactNode;
  title: string;
  description: string;
  action?: EmptyStateAction | React.ReactNode;
  className?: string;
}

function isActionShape(
  action: EmptyStateProps["action"],
): action is EmptyStateAction {
  return (
    !!action &&
    !React.isValidElement(action) &&
    typeof action === "object" &&
    "label" in action &&
    "href" in action
  );
}

function renderIcon(icon: EmptyStateProps["icon"]): React.ReactNode {
  if (React.isValidElement(icon)) return icon;
  if (typeof icon === "function" || (typeof icon === "object" && icon !== null)) {
    const Icon = icon as LucideIcon;
    return <Icon className="size-6" aria-hidden />;
  }
  return icon;
}

/**
 * Centered empty / zero-data panel: an icon in a muted circle, a display-font
 * title, a body-copy description, and an optional call to action.
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-panel border border-hairline bg-surface px-6 py-12 text-center",
        className,
      )}
    >
      <div className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
        {renderIcon(icon)}
      </div>
      <h3 className="font-display text-lg font-semibold text-ink">{title}</h3>
      <p className="max-w-prose text-sm text-body">{description}</p>
      {isActionShape(action) ? (
        <Button asChild className="mt-2">
          <Link href={action.href}>{action.label}</Link>
        </Button>
      ) : action ? (
        <div className="mt-2">{action as React.ReactNode}</div>
      ) : null}
    </div>
  );
}
