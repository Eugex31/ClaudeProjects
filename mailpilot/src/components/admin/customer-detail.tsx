"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { CustomerPlanDialog } from "@/components/admin/customer-plan-dialog";

type CustomerDetail = {
  id: string;
  name: string | null;
  email: string;
  status: "ACTIVE" | "SUSPENDED";
  createdAt: string;
  lastLoginAt: string | null;
  hasGoogleAccount: boolean;
  planName: string;
  billingStatus: string;
  currentPeriodEnd: string | null;
  contactCount: number;
  campaignsSentCount: number;
};

export function CustomerDetailView({ customerId }: { customerId: string }) {
  const router = useRouter();
  const [customer, setCustomer] = useState<CustomerDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState<"suspend" | "cancel" | null>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [notifyOpen, setNotifyOpen] = useState(false);
  const [notifySubject, setNotifySubject] = useState("");
  const [notifyMessage, setNotifyMessage] = useState("");

  const load = useCallback(() => {
    setLoading(true);
    fetch(`/api/admin/customers/${customerId}`)
      .then((r) => r.json())
      .then((body) => {
        setCustomer(body.customer ?? null);
        setLoading(false);
      });
  }, [customerId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  async function suspend() {
    setBusy(true);
    const res = await fetch(`/api/admin/customers/${customerId}/suspend`, { method: "POST" });
    setBusy(false);
    setConfirming(null);
    if (!res.ok) {
      toast.error("Failed to deactivate customer");
      return;
    }
    toast.success("Customer deactivated");
    load();
  }

  async function reactivate() {
    setBusy(true);
    const res = await fetch(`/api/admin/customers/${customerId}/reactivate`, { method: "POST" });
    setBusy(false);
    if (!res.ok) {
      toast.error("Failed to activate customer");
      return;
    }
    toast.success("Customer activated");
    load();
  }

  async function cancelSubscription() {
    setBusy(true);
    const res = await fetch(`/api/admin/customers/${customerId}/cancel-subscription`, { method: "POST" });
    setBusy(false);
    setConfirming(null);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      toast.error(body.error ?? "Failed to cancel subscription");
      return;
    }
    toast.success("Subscription canceled");
    load();
  }

  async function sendNotification() {
    if (!notifySubject.trim() || !notifyMessage.trim()) return;
    setBusy(true);
    const res = await fetch(`/api/admin/customers/${customerId}/notify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subject: notifySubject, message: notifyMessage }),
    });
    setBusy(false);
    if (!res.ok) {
      toast.error("Failed to send notification");
      return;
    }
    toast.success("Notification sent");
    setNotifyOpen(false);
    setNotifySubject("");
    setNotifyMessage("");
  }

  async function deleteCustomer() {
    if (!customer || deleteConfirmText.trim().toLowerCase() !== customer.email.toLowerCase()) return;
    setBusy(true);
    const res = await fetch(`/api/admin/customers/${customerId}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirmEmail: deleteConfirmText }),
    });
    setBusy(false);
    setDeleteConfirmOpen(false);
    setDeleteConfirmText("");
    if (!res.ok) {
      toast.error("Failed to delete customer");
      return;
    }
    toast.success("Customer deleted");
    router.push("/admin/customers");
  }

  if (loading || !customer) {
    return <Skeleton className="h-96 w-full max-w-2xl" />;
  }

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      {customer.billingStatus === "PAST_DUE" && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          Payment failed — this customer&apos;s card is past due. They keep access during Stripe&apos;s grace
          period, but follow up before it lapses to a full cancellation.
        </div>
      )}

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>{customer.name ?? customer.email}</CardTitle>
              <CardDescription>{customer.email}</CardDescription>
            </div>
            {customer.status === "SUSPENDED" ? (
              <Badge variant="destructive">Deactivated</Badge>
            ) : (
              <Badge variant="secondary">Active</Badge>
            )}
          </div>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <p className="text-muted-foreground">Signed up</p>
            <p>{new Date(customer.createdAt).toLocaleDateString()}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Last login</p>
            <p>{customer.lastLoginAt ? new Date(customer.lastLoginAt).toLocaleString() : "Never"}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Plan</p>
            <p>
              {customer.planName} ({customer.billingStatus})
            </p>
          </div>
          <div>
            <p className="text-muted-foreground">Gmail connected</p>
            <p>{customer.hasGoogleAccount ? "Yes" : "No"}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Contacts</p>
            <p>{customer.contactCount.toLocaleString()}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Campaigns sent</p>
            <p>{customer.campaignsSentCount.toLocaleString()}</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Actions</CardTitle>
          <CardDescription>
            Activate/Deactivate is access control only — it doesn&apos;t change their Stripe subscription or billing.
            Cancel subscription is the separate action for that.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          {customer.status === "SUSPENDED" ? (
            <Button disabled={busy} onClick={reactivate}>
              Activate
            </Button>
          ) : (
            <Button variant="outline" disabled={busy} onClick={() => setConfirming("suspend")}>
              Deactivate
            </Button>
          )}
          <Button variant="outline" disabled={busy} onClick={() => setConfirming("cancel")}>
            Cancel subscription
          </Button>
          <CustomerPlanDialog customerId={customerId} onAssigned={load} />
          <Button variant="outline" disabled={busy} onClick={() => setNotifyOpen(true)}>
            Notify customer
          </Button>
          <Button variant="destructive" disabled={busy} onClick={() => setDeleteConfirmOpen(true)}>
            Delete customer
          </Button>
        </CardContent>
      </Card>

      <AlertDialog open={confirming === "suspend"} onOpenChange={(o) => !o && setConfirming(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Deactivate this customer?</AlertDialogTitle>
            <AlertDialogDescription>
              They&apos;ll be signed out everywhere immediately, can&apos;t log back in until reactivated, and any
              in-flight campaign, sequence, or newsletter sends stop immediately too. Their Stripe subscription (if
              any) keeps billing — use Cancel subscription separately if that&apos;s also intended.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={busy} onClick={suspend}>
              Deactivate
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirming === "cancel"} onOpenChange={(o) => !o && setConfirming(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel this customer&apos;s subscription?</AlertDialogTitle>
            <AlertDialogDescription>
              This cancels their Stripe subscription immediately (not at period end). Their account stays active —
              use Deactivate separately if you also want to block login.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={busy} onClick={cancelSubscription}>
              Cancel subscription
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={notifyOpen} onOpenChange={setNotifyOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Notify {customer.name ?? customer.email}</DialogTitle>
            <DialogDescription>Sends an email directly to this customer.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="notify-subject">Subject</Label>
              <Input id="notify-subject" value={notifySubject} onChange={(e) => setNotifySubject(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="notify-message">Message</Label>
              <Textarea
                id="notify-message"
                rows={5}
                value={notifyMessage}
                onChange={(e) => setNotifyMessage(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button disabled={busy || !notifySubject.trim() || !notifyMessage.trim()} onClick={sendNotification}>
              Send
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteConfirmOpen} onOpenChange={(o) => { if (!o) { setDeleteConfirmOpen(false); setDeleteConfirmText(""); } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this customer permanently?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes their account and every contact, campaign, and setting they have. This can&apos;t be
              undone. Type <strong>{customer.email}</strong> to confirm.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Input
            value={deleteConfirmText}
            onChange={(e) => setDeleteConfirmText(e.target.value)}
            placeholder={customer.email}
            autoFocus
          />
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy || deleteConfirmText.trim().toLowerCase() !== customer.email.toLowerCase()}
              onClick={deleteCustomer}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
