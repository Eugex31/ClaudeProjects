"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { MoreHorizontal, Send } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { StatusBadge } from "@/components/shared/status-badge";
import { NewCampaignDialog } from "@/components/campaigns/new-campaign-dialog";

type Campaign = {
  id: string;
  name: string;
  status: string;
  updatedAt: string;
  _count: { recipients: number };
};

export function CampaignsTable({ refreshSignal }: { refreshSignal?: number } = {}) {
  const router = useRouter();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleteTarget, setDeleteTarget] = useState<Campaign | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/campaigns");
    if (res.ok) {
      const data = await res.json();
      setCampaigns(data.campaigns);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load, refreshSignal]);

  async function handleDuplicate(id: string) {
    const res = await fetch(`/api/campaigns/${id}/duplicate`, { method: "POST" });
    if (!res.ok) {
      toast.error("Failed to duplicate campaign");
      return;
    }
    const { campaign } = await res.json();
    toast.success("Campaign duplicated");
    router.push(`/campaigns/${campaign.id}`);
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    const res = await fetch(`/api/campaigns/${deleteTarget.id}`, { method: "DELETE" });
    if (!res.ok) {
      toast.error("Failed to delete campaign");
    } else {
      toast.success("Campaign deleted");
      load();
    }
    setDeleteTarget(null);
  }

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Recipients</TableHead>
            <TableHead>Last updated</TableHead>
            <TableHead className="w-10" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading ? (
            Array.from({ length: 4 }).map((_, i) => (
              <TableRow key={i}>
                <TableCell colSpan={5}>
                  <Skeleton className="h-6 w-full" />
                </TableCell>
              </TableRow>
            ))
          ) : campaigns.length === 0 ? (
            <TableRow>
              <TableCell colSpan={5} className="p-0">
                <div className="flex flex-col items-center gap-3 py-16 text-center">
                  <div className="flex size-12 items-center justify-center rounded-full bg-accent">
                    <Send className="size-5 text-accent-foreground" />
                  </div>
                  <div className="flex flex-col gap-1">
                    <p className="text-sm font-medium">No campaigns yet</p>
                    <p className="text-sm text-muted-foreground">Create your first campaign to start sending.</p>
                  </div>
                  <NewCampaignDialog trigger={<Button size="sm" className="mt-1">Create your first campaign</Button>} />
                </div>
              </TableCell>
            </TableRow>
          ) : (
            campaigns.map((c) => (
              <TableRow key={c.id}>
                <TableCell>
                  <Link href={`/campaigns/${c.id}`} className="font-medium hover:underline">
                    {c.name}
                  </Link>
                </TableCell>
                <TableCell>
                  <StatusBadge status={c.status} />
                </TableCell>
                <TableCell>{c._count.recipients}</TableCell>
                <TableCell>{new Date(c.updatedAt).toLocaleString()}</TableCell>
                <TableCell>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon">
                        <MoreHorizontal className="size-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onSelect={() => router.push(`/campaigns/${c.id}`)}>
                        Open
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => handleDuplicate(c.id)}>Duplicate</DropdownMenuItem>
                      <DropdownMenuItem className="text-destructive" onSelect={() => setDeleteTarget(c)}>
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>

      <AlertDialog open={Boolean(deleteTarget)} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this campaign?</AlertDialogTitle>
            <AlertDialogDescription>
              &quot;{deleteTarget?.name}&quot; and all of its recipient/send records will be permanently
              removed. This can&apos;t be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
