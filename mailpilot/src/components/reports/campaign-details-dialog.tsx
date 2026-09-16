"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";

type CampaignDetail = {
  id: string;
  name: string;
  sent: number;
  uniqueOpens: number;
  totalOpens: number;
  uniqueClicks: number;
  totalClicks: number;
  openRate: number | null;
  clickRate: number | null;
  clickToOpenRate: number | null;
  topLinks: { url: string; totalClicks: number; uniqueClicks: number }[];
};

export function CampaignDetailsDialog({ campaignId, trigger }: { campaignId: string; trigger: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<CampaignDetail | null>(null);
  const [loading, setLoading] = useState(false);

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next) {
      setLoading(true);
      fetch(`/api/reports/campaigns/${campaignId}`)
        .then((r) => r.json())
        .then((d) => setDetail(d.campaign ?? null))
        .finally(() => setLoading(false));
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{detail?.name ?? "Campaign report"}</DialogTitle>
          <DialogDescription>Open and click detail for this campaign.</DialogDescription>
        </DialogHeader>
        {loading || !detail ? (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-6 w-full" />
            <Skeleton className="h-6 w-full" />
            <Skeleton className="h-6 w-full" />
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-3 gap-3 text-sm">
              <div>
                <div className="text-muted-foreground">Sent</div>
                <div className="text-lg font-semibold">{detail.sent}</div>
              </div>
              <div>
                <div className="text-muted-foreground">Opens</div>
                <div className="text-lg font-semibold">
                  {detail.uniqueOpens} <span className="text-xs text-muted-foreground">({detail.totalOpens} total)</span>
                </div>
              </div>
              <div>
                <div className="text-muted-foreground">Clicks</div>
                <div className="text-lg font-semibold">
                  {detail.uniqueClicks} <span className="text-xs text-muted-foreground">({detail.totalClicks} total)</span>
                </div>
              </div>
              <div>
                <div className="text-muted-foreground">Open rate</div>
                <div className="font-medium">{detail.openRate !== null ? `${detail.openRate}%` : "—"}</div>
              </div>
              <div>
                <div className="text-muted-foreground">Click rate</div>
                <div className="font-medium">{detail.clickRate !== null ? `${detail.clickRate}%` : "—"}</div>
              </div>
              <div>
                <div className="text-muted-foreground">CTOR</div>
                <div className="font-medium">{detail.clickToOpenRate !== null ? `${detail.clickToOpenRate}%` : "—"}</div>
              </div>
            </div>

            <div>
              <div className="mb-2 text-sm font-medium">Top links</div>
              {detail.topLinks.length === 0 ? (
                <p className="text-sm text-muted-foreground">No clicks yet.</p>
              ) : (
                <div className="flex flex-col gap-2">
                  {detail.topLinks.map((link) => (
                    <div key={link.url} className="flex items-center justify-between gap-3 text-sm">
                      <span className="truncate text-muted-foreground" title={link.url}>
                        {link.url}
                      </span>
                      <span className="shrink-0 font-medium">
                        {link.uniqueClicks} <span className="text-xs text-muted-foreground">({link.totalClicks} total)</span>
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
