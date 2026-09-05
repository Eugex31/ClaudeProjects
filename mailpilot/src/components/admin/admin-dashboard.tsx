"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { TrendBarChart } from "@/components/admin/trend-bar-chart";
import { RevenueOverview } from "@/components/admin/revenue-overview";

type DashboardData = {
  totalCustomers: number;
  activeCustomers: number;
  suspendedCustomers: number;
  signupsByMonth: { month: string; count: number }[];
  revenueByMonth: { month: string; amountCents: number }[];
  churnRate: number;
};

function formatCents(cents: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}

export function AdminDashboard() {
  const [data, setData] = useState<DashboardData | null>(null);

  useEffect(() => {
    fetch("/api/admin/dashboard")
      .then((r) => r.json())
      .then(setData);
  }, []);

  if (!data) {
    return <Skeleton className="h-96 w-full max-w-4xl" />;
  }

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Card>
          <CardHeader>
            <CardDescription>Total customers</CardDescription>
            <CardTitle className="text-3xl">{data.totalCustomers}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Active</CardDescription>
            <CardTitle className="text-3xl">{data.activeCustomers}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Deactivated</CardDescription>
            <CardTitle className="text-3xl">{data.suspendedCustomers}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Churn rate this month</CardDescription>
            <CardTitle className="text-3xl">{data.churnRate}%</CardTitle>
          </CardHeader>
        </Card>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Signups per month</CardTitle>
            <CardDescription>Last 12 months</CardDescription>
          </CardHeader>
          <CardContent>
            <TrendBarChart data={data.signupsByMonth.map((d) => ({ month: d.month, value: d.count }))} formatValue={(v) => `${v} signup${v === 1 ? "" : "s"}`} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Revenue per month</CardTitle>
            <CardDescription>Paid Stripe invoices, last 12 months</CardDescription>
          </CardHeader>
          <CardContent>
            <TrendBarChart
              data={data.revenueByMonth.map((d) => ({ month: d.month, value: d.amountCents }))}
              formatValue={(v) => formatCents(v)}
            />
          </CardContent>
        </Card>
      </div>

      <RevenueOverview />
    </div>
  );
}
