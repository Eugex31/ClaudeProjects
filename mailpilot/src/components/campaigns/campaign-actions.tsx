"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Play, Pause, Square, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
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

type Action = "start" | "pause" | "resume" | "stop" | "restart";

export function CampaignActions({
  campaignId,
  status,
  recipientCount,
  onChanged,
}: {
  campaignId: string;
  status: string;
  recipientCount: number;
  onChanged: () => void;
}) {
  const [confirming, setConfirming] = useState<Action | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(action: Action) {
    setBusy(true);
    const res = await fetch(`/api/campaigns/${campaignId}/${action}`, { method: "POST" });
    setBusy(false);
    setConfirming(null);

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      toast.error(body.error ?? `Failed to ${action} campaign`);
      return;
    }
    toast.success(
      action === "start"
        ? "Campaign started"
        : action === "pause"
          ? "Campaign paused"
          : action === "resume"
            ? "Campaign resumed"
            : action === "restart"
              ? "Campaign restarted"
              : "Campaign stopped"
    );
    onChanged();
  }

  return (
    <>
      <div className="flex items-center gap-2">
        {status === "DRAFT" && (
          <Button onClick={() => setConfirming("start")} disabled={busy}>
            <Play className="mr-2 size-4" />
            Start sending
          </Button>
        )}
        {status === "SENDING" && (
          <>
            <Button variant="outline" onClick={() => run("pause")} disabled={busy}>
              <Pause className="mr-2 size-4" />
              Pause
            </Button>
            <Button variant="destructive" onClick={() => setConfirming("stop")} disabled={busy}>
              <Square className="mr-2 size-4" />
              Stop
            </Button>
          </>
        )}
        {status === "PAUSED" && (
          <>
            <Button onClick={() => run("resume")} disabled={busy}>
              <Play className="mr-2 size-4" />
              Resume
            </Button>
            <Button variant="destructive" onClick={() => setConfirming("stop")} disabled={busy}>
              <Square className="mr-2 size-4" />
              Stop
            </Button>
          </>
        )}
        {status === "STOPPED" && (
          <Button onClick={() => setConfirming("restart")} disabled={busy}>
            <RotateCcw className="mr-2 size-4" />
            Restart campaign
          </Button>
        )}
      </div>

      <AlertDialog open={confirming === "start"} onOpenChange={(o) => !o && setConfirming(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Start sending to {recipientCount} recipient{recipientCount === 1 ? "" : "s"}?</AlertDialogTitle>
            <AlertDialogDescription>
              Emails will be sent gradually from your connected Gmail account, one at a time with a
              randomized delay between each. Only send to recipients who have agreed to be contacted —
              you are responsible for complying with CAN-SPAM, GDPR, and Gmail&apos;s sending policies.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={busy} onClick={() => run("start")}>
              Start sending
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirming === "stop"} onOpenChange={(o) => !o && setConfirming(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Stop this campaign?</AlertDialogTitle>
            <AlertDialogDescription>
              Remaining unsent recipients will be marked as skipped. Anyone already sent to won&apos;t be
              affected. You can restart later to resume sending to whoever was skipped.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={busy} onClick={() => run("stop")}>
              Stop campaign
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirming === "restart"} onOpenChange={(o) => !o && setConfirming(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Restart this campaign?</AlertDialogTitle>
            <AlertDialogDescription>
              Sending resumes only for recipients who were skipped when the campaign was stopped —
              anyone who already received this campaign will not be sent to again.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={busy} onClick={() => run("restart")}>
              Restart campaign
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
