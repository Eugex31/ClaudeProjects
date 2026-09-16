import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const STATUS_STYLES: Record<string, string> = {
  DRAFT: "bg-muted text-muted-foreground",
  SENDING: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
  PAUSED: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  COMPLETED: "bg-green-500/15 text-green-600 dark:text-green-400",
  STOPPED: "bg-zinc-500/15 text-zinc-600 dark:text-zinc-400",
  FAILED: "bg-red-500/15 text-red-600 dark:text-red-400",
  PENDING: "bg-muted text-muted-foreground",
  SENT: "bg-green-500/15 text-green-600 dark:text-green-400",
  RETRYING: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  SKIPPED: "bg-zinc-500/15 text-zinc-600 dark:text-zinc-400",
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <Badge variant="outline" className={cn("border-transparent capitalize", STATUS_STYLES[status])}>
      {status.toLowerCase()}
    </Badge>
  );
}
