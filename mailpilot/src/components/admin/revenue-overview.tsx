"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

type Revenue = {
  mrrCents: number;
  activeSubscriptions: number;
  canceledThisMonth: number;
  byTier: { key: string; name: string; activeCount: number }[];
};

function formatCents(cents: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}

export function RevenueOverview() {
  const [revenue, setRevenue] = useState<Revenue | null>(null);

  useEffect(() => {
    fetch("/api/admin/revenue")
      .then((r) => r.json())
      .then(setRevenue);
  }, []);

  if (!revenue) {
    return <Skeleton className="h-48 w-full max-w-3xl" />;
  }

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardHeader>
            <CardDescription>MRR</CardDescription>
            <CardTitle className="text-3xl">{formatCents(revenue.mrrCents)}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Active paid subscriptions</CardDescription>
            <CardTitle className="text-3xl">{revenue.activeSubscriptions}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Canceled this month</CardDescription>
            <CardTitle className="text-3xl">{revenue.canceledThisMonth}</CardTitle>
          </CardHeader>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Active subscriptions by tier</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {revenue.byTier.map((tier) => (
            <div key={tier.key} className="flex items-center justify-between border-b py-2 last:border-0">
              <span>{tier.name}</span>
              <span className="text-muted-foreground">{tier.activeCount}</span>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
