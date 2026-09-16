import type { ScreenStatus } from "@prisma/client";

import { cn } from "@/lib/utils";

interface StatusMeta {
  label: string;
  dot: string;
  text: string;
}

const STATUS_META: Record<ScreenStatus, StatusMeta> = {
  ONLINE: { label: "Online", dot: "bg-emerald-500", text: "text-emerald-700 dark:text-emerald-400" },
  OFFLINE: { label: "Offline", dot: "bg-amber-500", text: "text-amber-700 dark:text-amber-400" },
  UNPAIRED: { label: "Unpaired", dot: "bg-slate-400", text: "text-slate-600 dark:text-slate-300" },
  DISABLED: { label: "Disabled", dot: "bg-muted-foreground/50", text: "text-muted-foreground" },
};

export interface StatusDotProps {
  status: ScreenStatus;
  className?: string;
}

/**
 * Screen status indicator. Colour is never the only signal: the matching word
 * ("Online" / "Offline" / "Unpaired" / "Disabled") is always rendered too.
 */
export function StatusDot({ status, className }: StatusDotProps) {
  const meta = STATUS_META[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-sm font-medium",
        meta.text,
        className,
      )}
    >
      <span className={cn("size-2 shrink-0 rounded-full", meta.dot)} aria-hidden />
      {meta.label}
    </span>
  );
}
