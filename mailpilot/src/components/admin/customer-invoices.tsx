"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";

type Invoice = {
  id: string;
  number: string | null;
  status: string | null;
  amountPaidCents: number;
  currency: string;
  created: number;
  hostedInvoiceUrl: string | null;
  invoicePdf: string | null;
};

type InvoicesResponse = {
  invoices: Invoice[];
  paymentMethodStatus: "valid" | "expired" | "none" | "unknown";
  cardBrand: string | null;
  cardLast4: string | null;
};

export function CustomerInvoices({ customerId }: { customerId: string }) {
  const [data, setData] = useState<InvoicesResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    fetch(`/api/admin/customers/${customerId}/invoices`)
      .then((r) => r.json())
      .then((body) => {
        setData(body);
        setLoading(false);
      });
  }, [customerId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  if (loading || !data) {
    return <Skeleton className="h-64 w-full" />;
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Billing history</CardTitle>
            <CardDescription>Pulled live from Stripe — nothing mirrored locally.</CardDescription>
          </div>
          {data.paymentMethodStatus === "valid" && (
            <Badge variant="secondary">
              {data.cardBrand} •••• {data.cardLast4}
            </Badge>
          )}
          {data.paymentMethodStatus === "expired" && (
            <Badge variant="destructive">
              Card expired ({data.cardBrand} •••• {data.cardLast4})
            </Badge>
          )}
          {data.paymentMethodStatus === "none" && <Badge variant="outline">No payment method on file</Badge>}
        </div>
      </CardHeader>
      <CardContent>
        {data.invoices.length === 0 ? (
          <p className="text-sm text-muted-foreground">No invoices yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.invoices.map((inv) => (
                <TableRow key={inv.id}>
                  <TableCell>{new Date(inv.created * 1000).toLocaleDateString()}</TableCell>
                  <TableCell>
                    {(inv.amountPaidCents / 100).toLocaleString(undefined, {
                      style: "currency",
                      currency: inv.currency.toUpperCase(),
                    })}
                  </TableCell>
                  <TableCell className="capitalize">{inv.status}</TableCell>
                  <TableCell>
                    {inv.hostedInvoiceUrl && (
                      <a
                        href={inv.hostedInvoiceUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-sm text-primary hover:underline"
                      >
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
  );
}
