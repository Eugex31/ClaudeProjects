import Link from "next/link";
import { Check } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

// "Pro" is picked as the recommended/highlighted tier — the tier just above
// entry-level is the standard SaaS convention, not data-driven; easy to move
// to a different key later.
const HIGHLIGHTED_PLAN_KEY = "pro";

function formatLimit(n: number): string {
  return n === -1 ? "Unlimited" : n.toLocaleString();
}

export async function PricingSection() {
  const plans = await prisma.plan.findMany({ orderBy: { monthlyPriceCents: "asc" } });

  return (
    <section id="pricing" className="mx-auto max-w-6xl px-4 py-20">
      <div className="mx-auto mb-12 max-w-2xl text-center">
        <h2 className="text-3xl font-semibold tracking-tight">Simple, transparent pricing</h2>
        <p className="mt-3 text-muted-foreground">Start free. Upgrade as your list and sending needs grow.</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {plans.map((plan) => {
          const highlighted = plan.key === HIGHLIGHTED_PLAN_KEY;
          const isFree = plan.monthlyPriceCents === 0;
          return (
            <Card key={plan.key} className={cn("relative flex flex-col", highlighted && "border-primary shadow-md")}>
              {highlighted && (
                <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-primary px-3 py-1 text-xs font-medium text-primary-foreground">
                  Most popular
                </span>
              )}
              <CardHeader>
                <CardTitle>{plan.name}</CardTitle>
                <CardDescription>
                  <span className="text-3xl font-semibold text-foreground">${(plan.monthlyPriceCents / 100).toFixed(0)}</span>
                  <span className="text-muted-foreground">/mo</span>
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-1 flex-col gap-4">
                <ul className="flex flex-1 flex-col gap-2 text-sm text-muted-foreground">
                  <li className="flex items-center gap-2">
                    <Check className="size-4 shrink-0 text-primary" />
                    {formatLimit(plan.contactLimit)} contacts
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="size-4 shrink-0 text-primary" />
                    {formatLimit(plan.emailsPerMonthLimit)} emails/month
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="size-4 shrink-0 text-primary" />
                    {formatLimit(plan.activeSequenceLimit)} active sequence{plan.activeSequenceLimit === 1 ? "" : "s"}
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="size-4 shrink-0 text-primary" />
                    {formatLimit(plan.templateLimit)} saved templates
                  </li>
                  {plan.crmEnabled && (
                    <li className="flex items-center gap-2">
                      <Check className="size-4 shrink-0 text-primary" />
                      CRM sync
                    </li>
                  )}
                </ul>
                <Button asChild variant={highlighted ? "default" : "outline"} className="w-full">
                  <Link href={isFree ? "/register" : "/register?callbackUrl=%2Fbilling"}>
                    {isFree ? "Get Started" : "Choose plan"}
                  </Link>
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </section>
  );
}
