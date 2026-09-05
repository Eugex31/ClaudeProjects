import Link from "next/link";
import { CustomerDetailView } from "@/components/admin/customer-detail";
import { CustomerReport } from "@/components/admin/customer-report";
import { CustomerInvoices } from "@/components/admin/customer-invoices";
import { CustomerAuditLog } from "@/components/admin/customer-audit-log";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export default async function AdminCustomerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/admin/customers" className="text-sm text-muted-foreground hover:underline">
          &larr; Customers
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">Customer</h1>
      </div>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="report">Report</TabsTrigger>
          <TabsTrigger value="invoices">Billing</TabsTrigger>
          <TabsTrigger value="audit-log">Audit log</TabsTrigger>
        </TabsList>
        <TabsContent value="overview">
          <CustomerDetailView customerId={id} />
        </TabsContent>
        <TabsContent value="report">
          <CustomerReport customerId={id} />
        </TabsContent>
        <TabsContent value="invoices">
          <CustomerInvoices customerId={id} />
        </TabsContent>
        <TabsContent value="audit-log">
          <CustomerAuditLog customerId={id} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
