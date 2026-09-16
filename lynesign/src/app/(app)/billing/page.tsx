import { requireOrg } from "@/lib/auth/context";
import { can } from "@/lib/rbac/can";
import { prisma } from "@/lib/db/root";
import { formatBytes } from "@/lib/format";
import { getUsageSummary } from "@/lib/plan-limits";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/empty-state";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ShieldAlert } from "lucide-react";

export const metadata = { title: "Billing" };

function UsageBar({
  label,
  used,
  limit,
  format = (n: number) => String(n),
}: {
  label: string;
  used: number;
  limit: number | null;
  format?: (n: number) => string;
}) {
  const pct = limit && limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  return (
    <div className="space-y-1.5">
      <div className="flex justify-between text-sm">
        <span className="text-body">{label}</span>
        <span className="font-medium text-ink">
          {format(used)} / {limit === null ? "Unlimited" : format(limit)}
        </span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-navy"
          style={{ width: `${limit === null ? 0 : pct}%` }}
        />
      </div>
    </div>
  );
}

/**
 * Billing overview. Read-only in this release: the current plan and how much of
 * each metered resource the organization is using. Gated on `billing.view`, so a
 * role without it never sees the numbers. Managing the subscription comes later.
 */
export default async function BillingPage() {
  const ctx = await requireOrg();

  if (!can(ctx.actor, "billing.view")) {
    return (
      <div className="space-y-6">
        <PageHeader title="Billing" accent="Plan" />
        <EmptyState
          icon={ShieldAlert}
          title="No access"
          description="Your role does not include billing access. Ask an administrator if you need it."
        />
      </div>
    );
  }

  const [subscription, usage] = await Promise.all([
    prisma.subscription.findUnique({
      where: { organizationId: ctx.organizationId },
      include: { plan: true },
    }),
    getUsageSummary(ctx.organizationId),
  ]);

  const planName = subscription?.plan.name ?? "Trial";

  return (
    <div className="space-y-6">
      <PageHeader
        title="Billing"
        accent="Plan"
        description="Your current plan and usage against its limits."
      />

      <Card>
        <CardHeader>
          <CardTitle>Current plan</CardTitle>
        </CardHeader>
        <CardContent className="flex items-center justify-between gap-4">
          <p className="text-lg font-semibold text-ink">{planName}</p>
          <div className="flex flex-col items-end gap-1">
            <Button variant="outline" size="sm" disabled>
              Manage billing
            </Button>
            <p className="text-xs text-body">Billing management is coming soon.</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Usage</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <UsageBar label="Screens" used={usage.screens.used} limit={usage.screens.limit} />
          <UsageBar label="Users" used={usage.users.used} limit={usage.users.limit} />
          <UsageBar label="Locations" used={usage.locations.used} limit={usage.locations.limit} />
          <UsageBar
            label="Storage"
            used={Number(usage.storage.usedBytes)}
            limit={usage.storage.limitBytes === null ? null : Number(usage.storage.limitBytes)}
            format={(n) => formatBytes(n)}
          />
        </CardContent>
      </Card>
    </div>
  );
}
