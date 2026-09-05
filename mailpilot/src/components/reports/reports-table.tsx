"use client";

import { useCallback, useEffect, useState } from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/shared/status-badge";
import { CampaignDetailsDialog } from "@/components/reports/campaign-details-dialog";

type CampaignReport = {
  id: string;
  name: string;
  status: string;
  sent: number;
  uniqueOpens: number;
  uniqueClicks: number;
  openRate: number | null;
  clickRate: number | null;
  clickToOpenRate: number | null;
};

export function ReportsTable() {
  const [campaigns, setCampaigns] = useState<CampaignReport[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/reports/campaigns");
    if (res.ok) {
      const data = await res.json();
      setCampaigns(data.campaigns);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Campaign</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Sent</TableHead>
            <TableHead>Opens</TableHead>
            <TableHead>Open rate</TableHead>
            <TableHead>Clicks</TableHead>
            <TableHead>Click rate</TableHead>
            <TableHead>CTOR</TableHead>
            <TableHead className="w-10" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading ? (
            Array.from({ length: 3 }).map((_, i) => (
              <TableRow key={i}>
                <TableCell colSpan={9}>
                  <Skeleton className="h-6 w-full" />
                </TableCell>
              </TableRow>
            ))
          ) : campaigns.length === 0 ? (
            <TableRow>
              <TableCell colSpan={9} className="h-24 text-center text-muted-foreground">
                No campaigns yet.
              </TableCell>
            </TableRow>
          ) : (
            campaigns.map((c) => (
              <TableRow key={c.id}>
                <TableCell className="font-medium">{c.name}</TableCell>
                <TableCell>
                  <StatusBadge status={c.status} />
                </TableCell>
                <TableCell className="text-muted-foreground">{c.sent}</TableCell>
                <TableCell className="text-muted-foreground">{c.uniqueOpens}</TableCell>
                <TableCell className="text-muted-foreground">{c.openRate !== null ? `${c.openRate}%` : "—"}</TableCell>
                <TableCell className="text-muted-foreground">{c.uniqueClicks}</TableCell>
                <TableCell className="text-muted-foreground">{c.clickRate !== null ? `${c.clickRate}%` : "—"}</TableCell>
                <TableCell className="text-muted-foreground">
                  {c.clickToOpenRate !== null ? `${c.clickToOpenRate}%` : "—"}
                </TableCell>
                <TableCell>
                  <CampaignDetailsDialog
                    campaignId={c.id}
                    trigger={
                      <Button variant="ghost" size="sm">
                        View
                      </Button>
                    }
                  />
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}
