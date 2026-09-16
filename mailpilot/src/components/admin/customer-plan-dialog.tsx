"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

type Plan = { key: string; name: string };

export function CustomerPlanDialog({ customerId, onAssigned }: { customerId: string; onAssigned: () => void }) {
  const [open, setOpen] = useState(false);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [planKey, setPlanKey] = useState("");
  const [trialEndsAt, setTrialEndsAt] = useState("");
  const [submitting, setSubmitting] = useState(false);

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next) {
      setTrialEndsAt("");
      fetch("/api/admin/plans")
        .then((r) => r.json())
        .then((d) => {
          setPlans(d.plans ?? []);
          setPlanKey(d.plans?.[0]?.key ?? "");
        });
    }
  }

  async function handleSubmit() {
    if (!planKey) return;
    setSubmitting(true);
    const res = await fetch(`/api/admin/customers/${customerId}/subscription`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        planKey,
        trialEndsAt: trialEndsAt ? new Date(trialEndsAt).toISOString() : null,
      }),
    });
    setSubmitting(false);

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      toast.error(body.error ?? "Failed to assign plan");
      return;
    }
    toast.success("Plan assigned");
    setOpen(false);
    onAssigned();
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline">Assign plan</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Manually assign a plan</DialogTitle>
          <DialogDescription>
            If this customer is actively paying via Stripe, their real Stripe subscription is updated to match —
            not just this app&apos;s local record. If they have no live subscription, this comps them directly.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label>Plan</Label>
            <Select value={planKey} onValueChange={setPlanKey}>
              <SelectTrigger>
                <SelectValue placeholder="Choose a plan" />
              </SelectTrigger>
              <SelectContent>
                {plans.map((p) => (
                  <SelectItem key={p.key} value={p.key}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="trial-ends-at">Trial ends (optional)</Label>
            <Input
              id="trial-ends-at"
              type="date"
              value={trialEndsAt}
              onChange={(e) => setTrialEndsAt(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Leave blank for a normal active assignment. Set a date to mark this as a trial ending then.
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button onClick={handleSubmit} disabled={submitting || !planKey}>
            Assign
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
