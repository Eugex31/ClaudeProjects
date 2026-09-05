"use client";

import { useEffect, useState } from "react";
import { Progress } from "@/components/ui/progress";
import { Card, CardContent } from "@/components/ui/card";

type ProgressData = {
  status: string;
  total: number;
  counts: Record<"PENDING" | "SENDING" | "SENT" | "FAILED" | "RETRYING" | "SKIPPED", number>;
};

export function CampaignProgress({ campaignId, active }: { campaignId: string; active: boolean }) {
  const [data, setData] = useState<ProgressData | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const res = await fetch(`/api/campaigns/${campaignId}/progress`);
      if (res.ok && !cancelled) setData(await res.json());
    }
    load();
    const interval = active ? setInterval(load, 3000) : undefined;
    return () => {
      cancelled = true;
      if (interval) clearInterval(interval);
    };
  }, [campaignId, active]);

  if (!data || data.total === 0) return null;

  const done = data.counts.SENT + data.counts.FAILED + data.counts.SKIPPED;
  const pct = data.total > 0 ? Math.round((done / data.total) * 100) : 0;

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 pt-6">
        <div className="flex items-center justify-between text-sm">
          <span className="font-medium">
            {done} / {data.total} processed
          </span>
          <span className="text-muted-foreground">{pct}%</span>
        </div>
        <Progress value={pct} />
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span>Sent: {data.counts.SENT}</span>
          <span>Pending: {data.counts.PENDING}</span>
          <span>Retrying: {data.counts.RETRYING}</span>
          <span>Failed: {data.counts.FAILED}</span>
          <span>Skipped: {data.counts.SKIPPED}</span>
        </div>
      </CardContent>
    </Card>
  );
}
