import { Sparkles } from "lucide-react";

import { EmptyState } from "@/components/app/empty-state";

export interface ComingSoonProps {
  feature: string;
  description: string;
}

/**
 * {@link EmptyState} preset for features that are stubbed but not yet built.
 * The body sentence is assembled from `description` and stays plain: no
 * exclamation points, no emoji.
 */
export function ComingSoon({ feature, description }: ComingSoonProps) {
  return (
    <EmptyState
      icon={Sparkles}
      title={feature}
      description={`This is where you will ${description}. It is coming in a later release.`}
    />
  );
}
