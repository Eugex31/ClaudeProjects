"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Pagination } from "@/components/shared/pagination";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type Customer = {
  id: string;
  name: string | null;
  email: string;
  status: "ACTIVE" | "SUSPENDED";
  createdAt: string;
  lastLoginAt: string | null;
  planName: string;
  billingStatus: string;
};

const PAGE_SIZE = 25;

export function CustomersTable() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
    if (q) params.set("q", q);
    fetch(`/api/admin/customers?${params}`)
      .then((r) => r.json())
      .then((body) => {
        setCustomers(body.customers ?? []);
        setTotal(body.total ?? 0);
        setLoading(false);
      });
  }, [page, q]);

  return (
    <div className="flex flex-col gap-4">
      <Input
        placeholder="Search by name or email…"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setPage(1);
        }}
        className="max-w-sm"
      />

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <Skeleton className="m-4 h-64" />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Customer</TableHead>
                  <TableHead>Signed up</TableHead>
                  <TableHead>Last login</TableHead>
                  <TableHead>Plan</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {customers.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell>
                      <Link href={`/admin/customers/${c.id}`} className="hover:underline">
                        <div className="font-medium">{c.name ?? c.email}</div>
                        <div className="text-xs text-muted-foreground">{c.email}</div>
                      </Link>
                    </TableCell>
                    <TableCell>{new Date(c.createdAt).toLocaleDateString()}</TableCell>
                    <TableCell>{c.lastLoginAt ? new Date(c.lastLoginAt).toLocaleDateString() : "Never"}</TableCell>
                    <TableCell>{c.planName}</TableCell>
                    <TableCell>
                      {c.status === "SUSPENDED" ? (
                        <Badge variant="destructive">Suspended</Badge>
                      ) : c.billingStatus === "PAST_DUE" ? (
                        <Badge variant="outline">Payment failed</Badge>
                      ) : (
                        <Badge variant="secondary">Active</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                {customers.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-muted-foreground">
                      No customers found.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPageChange={setPage} />
    </div>
  );
}
