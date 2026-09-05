import { CustomersTable } from "@/components/admin/customers-table";

export default function AdminCustomersPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Customers</h1>
        <p className="text-sm text-muted-foreground">All registered accounts.</p>
      </div>
      <CustomersTable />
    </div>
  );
}
