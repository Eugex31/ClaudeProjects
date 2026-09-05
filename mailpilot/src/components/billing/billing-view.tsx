"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type Plan = {
  id: string;
  key: string;
  name: string;
  monthlyPriceCents: number;
  contactLimit: number;
  emailsPerMonthLimit: number;
  crmEnabled: boolean;
};

type Summary = {
  subscription: {
    planKey: string;
    planName: string;
    status: string;
    currentPeriodEnd: string | null;
    cancelAtPeriodEnd: boolean;
    hasStripeCustomer: boolean;
  };
  usage: { contacts: number; emailsThisPeriod: number };
  limits: { contactLimit: number; emailsPerMonthLimit: number };
  plans: Plan[];
};

type Invoice = {
  id: string;
  number: string | null;
  status: string | null;
  amountPaidCents: number;
  currency: string;
  created: number;
  hostedInvoiceUrl: string | null;
};

function formatCents(cents: number, currency = "usd"): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: currency.toUpperCase() }).format(
    cents / 100
  );
}

export function BillingView() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyPlanKey, setBusyPlanKey] = useState<string | null>(null);
  const [portalBusy, setPortalBusy] = useState(false);

  useEffect(() => {
    Promise.all([
      fetch("/api/billing/summary").then((r) => r.json()),
      fetch("/api/billing/invoices").then((r) => r.json()),
    ]).then(([summaryBody, invoiceBody]) => {
      setSummary(summaryBody);
      setInvoices(invoiceBody.invoices ?? []);
      setLoading(false);
    });
  }, []);

  async function upgrade(planKey: string) {
    setBusyPlanKey(planKey);
    const res = await fetch("/api/billing/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ planKey }),
    });
    const body = await res.json().catch(() => ({}));
    setBusyPlanKey(null);

    if (!res.ok) {
      toast.error(body.error ?? "Failed to start checkout");
      return;
    }
    window.location.assign(body.url);
  }

  async function manageBilling() {
    setPortalBusy(true);
    const res = await fetch("/api/billing/portal", { method: "POST" });
    const body = await res.json().catch(() => ({}));
    setPortalBusy(false);

    if (!res.ok) {
      toast.error(body.error ?? "Failed to open billing portal");
      return;
    }
    window.location.assign(body.url);
  }

  if (loading || !summary) {
    return <Skeleton className="h-96 w-full max-w-3xl" />;
  }

  const { subscription, usage, limits, plans } = summary;
  const contactsPct = limits.contactLimit > 0 ? Math.min(100, (usage.contacts / limits.contactLimit) * 100) : 0;
  const emailsPct =
    limits.emailsPerMonthLimit > 0 ? Math.min(100, (usage.emailsThisPeriod / limits.emailsPerMonthLimit) * 100) : 0;

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Current plan</CardTitle>
              <CardDescription>{subscription.planName}</CardDescription>
            </div>
            <div className="flex items-center gap-2">
              {subscription.status === "PAST_DUE" && <Badge variant="destructive">Payment failed</Badge>}
              {subscription.cancelAtPeriodEnd && <Badge variant="outline">Cancels at period end</Badge>}
              {subscription.hasStripeCustomer && (
                <Button variant="outline" size="sm" onClick={manageBilling} disabled={portalBusy}>
                  Manage billing
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {subscription.status === "PAST_DUE" && (
            <p className="text-sm text-destructive">
              Your last payment failed. Update your card via &quot;Manage billing&quot; to avoid losing access.
            </p>
          )}
          <div className="flex flex-col gap-1.5">
            <div className="flex justify-between text-sm">
              <span>Contacts</span>
              <span className="text-muted-foreground">
                {usage.contacts.toLocaleString()} / {limits.contactLimit.toLocaleString()}
              </span>
            </div>
            <Progress value={contactsPct} />
          </div>
          <div className="flex flex-col gap-1.5">
            <div className="flex justify-between text-sm">
              <span>Emails this period</span>
              <span className="text-muted-foreground">
                {usage.emailsThisPeriod.toLocaleString()} / {limits.emailsPerMonthLimit.toLocaleString()}
              </span>
            </div>
            <Progress value={emailsPct} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Plans</CardTitle>
          <CardDescription>Upgrade or downgrade any time.</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {plans.map((plan) => {
            const isCurrent = plan.key === subscription.planKey;
            return (
              <div key={plan.id} className="flex flex-col gap-2 rounded-lg border p-4">
                <p className="font-semibold">{plan.name}</p>
                <p className="text-2xl font-bold">
                  {formatCents(plan.monthlyPriceCents)}
                  <span className="text-sm font-normal text-muted-foreground">/mo</span>
                </p>
                <p className="text-xs text-muted-foreground">
                  {plan.contactLimit.toLocaleString()} contacts
                  <br />
                  {plan.emailsPerMonthLimit.toLocaleString()} emails/mo
                  <br />
                  {plan.crmEnabled ? "CRM sync included" : "No CRM sync"}
                </p>
                {isCurrent ? (
                  <Badge className="mt-auto w-fit">Current plan</Badge>
                ) : plan.key === "free" ? (
                  <p className="mt-auto text-xs text-muted-foreground">
                    Downgrade from &quot;Manage billing&quot;
                  </p>
                ) : (
                  <Button
                    size="sm"
                    className="mt-auto"
                    disabled={busyPlanKey === plan.key}
                    onClick={() => upgrade(plan.key)}
                  >
                    Choose {plan.name}
                  </Button>
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Billing history</CardTitle>
        </CardHeader>
        <CardContent>
          {invoices.length === 0 ? (
            <p className="text-sm text-muted-foreground">No invoices yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {invoices.map((inv) => (
                  <TableRow key={inv.id}>
                    <TableCell>{new Date(inv.created * 1000).toLocaleDateString()}</TableCell>
                    <TableCell>{formatCents(inv.amountPaidCents, inv.currency)}</TableCell>
                    <TableCell className="capitalize">{inv.status}</TableCell>
                    <TableCell>
                      {inv.hostedInvoiceUrl && (
                        <a href={inv.hostedInvoiceUrl} target="_blank" rel="noreferrer" className="text-sm underline">
                          View
                        </a>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
