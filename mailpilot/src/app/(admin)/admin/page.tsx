import { AdminDashboard } from "@/components/admin/admin-dashboard";

export default function AdminOverviewPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Overview</h1>
        <p className="text-sm text-muted-foreground">Customer, revenue, and subscription health across the platform.</p>
      </div>
      <AdminDashboard />
    </div>
  );
}
