import { CampaignsTable } from "@/components/campaigns/campaigns-table";
import { NewCampaignDialog } from "@/components/campaigns/new-campaign-dialog";

export default function CampaignsPage() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Campaigns</h1>
          <p className="text-muted-foreground">Build and manage your outbound email campaigns.</p>
        </div>
        <NewCampaignDialog />
      </div>
      <CampaignsTable />
    </div>
  );
}
