import { ReportsTable } from "@/components/reports/reports-table";

export default function ReportsPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Reports</h1>
        <p className="text-muted-foreground">Open and click performance across your campaigns.</p>
      </div>
      <ReportsTable />
    </div>
  );
}
