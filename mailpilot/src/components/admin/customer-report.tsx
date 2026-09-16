"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

type Report = {
  accountAgeDays: number;
  lastLoginAt: string | null;
  contactCount: number;
  campaignsSentCount: number;
  activeSequenceCount: number;
  uniqueOpens: number;
  uniqueClicks: number;
  openRate: number | null;
  clickRate: number | null;
};

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="text-xl font-semibold">{value}</p>
    </div>
  );
}

export function CustomerReport({ customerId }: { customerId: string }) {
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    fetch(`/api/admin/customers/${customerId}/report`)
      .then((r) => r.json())
      .then((body) => {
        setReport(body.report ?? null);
        setLoading(false);
      });
  }, [customerId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  if (loading || !report) {
    return <Skeleton className="h-64 w-full" />;
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Report</CardTitle>
            <CardDescription>Usage and engagement for this customer.</CardDescription>
          </div>
          <Button asChild variant="outline" size="sm">
            <a href={`/api/admin/customers/${customerId}/report?format=csv`} download>
              Download CSV
            </a>
          </Button>
        </div>
      </CardHeader>
      <CardContent className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <Stat label="Account age" value={`${report.accountAgeDays} days`} />
        <Stat label="Last login" value={report.lastLoginAt ? new Date(report.lastLoginAt).toLocaleString() : "Never"} />
        <Stat label="Contacts" value={report.contactCount.toLocaleString()} />
        <Stat label="Campaigns sent" value={report.campaignsSentCount.toLocaleString()} />
        <Stat label="Active sequences" value={report.activeSequenceCount} />
        <Stat label="Unique opens" value={report.uniqueOpens.toLocaleString()} />
        <Stat label="Unique clicks" value={report.uniqueClicks.toLocaleString()} />
        <Stat label="Open rate" value={report.openRate !== null ? `${report.openRate}%` : "N/A"} />
        <Stat label="Click rate" value={report.clickRate !== null ? `${report.clickRate}%` : "N/A"} />
        <Stat label="Unsubscribe rate" value="Not tracked yet" />
      </CardContent>
    </Card>
  );
}
