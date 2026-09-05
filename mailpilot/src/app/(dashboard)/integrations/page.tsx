import { Suspense } from "react";
import { IntegrationsView } from "@/components/integrations/integrations-view";

export default function IntegrationsPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Integrations</h1>
        <p className="text-sm text-muted-foreground">Sync your contacts to a CRM.</p>
      </div>
      <Suspense>
        <IntegrationsView />
      </Suspense>
    </div>
  );
}
