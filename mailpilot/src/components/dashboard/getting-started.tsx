import Link from "next/link";
import { Check, Mail, Users, Send } from "lucide-react";
import { cn } from "@/lib/utils";

type Step = {
  href: string;
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  done: boolean;
};

// Shown only on a brand-new account (see dashboard/page.tsx) in place of the
// usual wall of zeroed stat cards — a first-time login previously had no
// next step at all beyond noticing buttons elsewhere on other pages.
export function GettingStarted({
  gmailConnected,
  contactCount,
}: {
  gmailConnected: boolean;
  contactCount: number;
}) {
  const steps: Step[] = [
    {
      href: "/settings",
      label: "Connect Gmail",
      description: "Campaigns send through your own Gmail account.",
      icon: Mail,
      done: gmailConnected,
    },
    {
      href: "/contacts",
      label: "Import contacts",
      description: "Add contacts one by one or import a CSV.",
      icon: Users,
      done: contactCount > 0,
    },
    {
      href: "/campaigns",
      label: "Create a campaign",
      description: "Write your first email and start sending.",
      icon: Send,
      done: false,
    },
  ];

  return (
    <div className="rounded-lg border bg-card p-6">
      <h2 className="text-lg font-semibold">Let&apos;s get your first campaign out the door</h2>
      <p className="text-sm text-muted-foreground">Three steps to your first send.</p>
      <div className="mt-4 flex flex-col gap-2">
        {steps.map((step) => (
          <Link
            key={step.href}
            href={step.href}
            className="flex items-center gap-3 rounded-md border p-3 transition-colors hover:bg-accent"
          >
            <div
              className={cn(
                "flex size-8 shrink-0 items-center justify-center rounded-full",
                step.done ? "bg-primary text-primary-foreground" : "bg-accent text-accent-foreground"
              )}
            >
              {step.done ? <Check className="size-4" /> : <step.icon className="size-4" />}
            </div>
            <div className="flex-1">
              <p className="text-sm font-medium">{step.label}</p>
              <p className="text-xs text-muted-foreground">{step.description}</p>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
