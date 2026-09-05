import Link from "next/link";
import { Check, Circle } from "lucide-react";

import { Card } from "@/components/ui/card";
import { Heading } from "@/components/app/heading";

export interface OnboardingState {
  hasLocation: boolean;
  hasScreen: boolean;
  hasPairedScreen: boolean;
  hasTeammate: boolean;
}

const ITEMS: { key: keyof OnboardingState; label: string; href: string }[] = [
  { key: "hasLocation", label: "Add your first location", href: "/locations" },
  { key: "hasScreen", label: "Add your first screen", href: "/screens" },
  { key: "hasPairedScreen", label: "Pair a screen", href: "/screens" },
  { key: "hasTeammate", label: "Invite a teammate", href: "/users" },
];

/**
 * Setup checklist shown on the dashboard while any onboarding step is still
 * incomplete. Each open step links to the page where it gets done.
 */
export function OnboardingChecklist({ onboarding }: { onboarding: OnboardingState }) {
  const done = ITEMS.filter((item) => onboarding[item.key]).length;

  return (
    <Card className="gap-4 px-5">
      <div className="space-y-1">
        <Heading as="h2" lead="Finish" accent="setup" />
        <p className="text-sm text-body">
          {done} of {ITEMS.length} steps done. Complete these to get your network running.
        </p>
      </div>
      <ul className="space-y-2">
        {ITEMS.map((item) => {
          const complete = onboarding[item.key];
          return (
            <li key={item.label} className="flex items-center gap-3 text-sm">
              {complete ? (
                <Check className="size-4 shrink-0 text-tan" aria-hidden />
              ) : (
                <Circle className="size-4 shrink-0 text-body" aria-hidden />
              )}
              {complete ? (
                <span className="text-body line-through">{item.label}</span>
              ) : (
                <Link
                  href={item.href}
                  className="text-ink underline underline-offset-4 hover:text-navy"
                >
                  {item.label}
                </Link>
              )}
              <span className="sr-only">{complete ? "done" : "not done"}</span>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
