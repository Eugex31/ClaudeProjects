"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

export function TestSendDialog({ campaignId, defaultEmail }: { campaignId: string; defaultEmail: string }) {
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState(defaultEmail);
  const [sending, setSending] = useState(false);

  async function handleSend() {
    setSending(true);
    const res = await fetch(`/api/campaigns/${campaignId}/test-send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to }),
    });
    setSending(false);

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      toast.error(body.error ?? "Failed to send test email");
      return;
    }
    toast.success(`Test email sent to ${to}`);
    setOpen(false);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <Send className="mr-2 size-4" />
          Send test email
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Send a test email</DialogTitle>
          <DialogDescription>
            Sends via your connected Gmail account using fallback values (no contact selected).
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="test-send-to">Send to</Label>
          <Input id="test-send-to" type="email" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <DialogFooter>
          <Button onClick={handleSend} disabled={sending || !to}>
            Send
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
