import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";

export interface LoadingStateProps {
  label?: string;
  rows?: number;
  className?: string;
}

/**
 * A stack of skeleton rows used as a loading placeholder. The `label` is
 * exposed to assistive tech via a visually hidden status line.
 */
export function LoadingState({
  label = "Loading",
  rows = 3,
  className,
}: LoadingStateProps) {
  const count = Math.max(1, rows);
  return (
    <div
      role="status"
      aria-busy="true"
      className={cn("space-y-3", className)}
    >
      <span className="sr-only">{label}</span>
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i} className="h-10 w-full rounded-card" />
      ))}
    </div>
  );
}
