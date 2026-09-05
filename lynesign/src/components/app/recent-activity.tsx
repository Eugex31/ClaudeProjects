import { formatDistanceToNow } from "date-fns";
import { Activity } from "lucide-react";

import { Card } from "@/components/ui/card";
import { Heading } from "@/components/app/heading";
import { EmptyState } from "@/components/app/empty-state";
import type { RecentActivityItem } from "@/lib/dashboard";

/**
 * Last audit entries for the active organization, humanized as
 * "{action} {targetType}" with a relative timestamp.
 */
export function RecentActivity({ items }: { items: RecentActivityItem[] }) {
  return (
    <Card className="gap-4 px-5">
      <Heading as="h2" lead="Recent" accent="activity" />
      {items.length === 0 ? (
        <EmptyState
          className="px-4 py-8"
          icon={Activity}
          title="No activity yet"
          description="Actions across your organization will show up here."
        />
      ) : (
        <ul className="divide-y divide-hairline">
          {items.map((item) => (
            <li
              key={item.id}
              className="flex items-center justify-between gap-4 py-2 text-sm"
            >
              <span className="text-ink">
                {item.action} {item.targetType}
              </span>
              <time className="shrink-0 text-xs text-body">
                {formatDistanceToNow(item.createdAt, { addSuffix: true })}
              </time>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
