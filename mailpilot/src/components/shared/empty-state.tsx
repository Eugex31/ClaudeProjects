import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

// A real empty state — icon, heading, description, and the actual next
// step baked in — replacing bare "No X found." text that left a first-time
// user with no path forward beyond noticing a button elsewhere on the page.
export function EmptyState({
  icon: Icon,
  title,
  description,
  actionLabel,
  onAction,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-3 py-16 text-center">
      <div className="flex size-12 items-center justify-center rounded-full bg-accent">
        <Icon className="size-5 text-accent-foreground" />
      </div>
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium">{title}</p>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      {actionLabel && onAction && (
        <Button type="button" size="sm" onClick={onAction} className="mt-1">
          {actionLabel}
        </Button>
      )}
    </div>
  );
}
