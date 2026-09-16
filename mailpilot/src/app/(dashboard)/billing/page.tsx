import { BillingView } from "@/components/billing/billing-view";

export default function BillingPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Billing</h1>
        <p className="text-sm text-muted-foreground">Your plan, usage, and invoices.</p>
      </div>
      <BillingView />
    </div>
  );
}
