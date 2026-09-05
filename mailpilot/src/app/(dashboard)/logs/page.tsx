import { LogsTable } from "@/components/logs/logs-table";

export default function LogsPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Logs</h1>
        <p className="text-muted-foreground">Every send attempt across all your campaigns.</p>
      </div>
      <LogsTable />
    </div>
  );
}
