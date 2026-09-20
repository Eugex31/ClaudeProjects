import { CampaignWizard } from "@/components/campaign-wizard/campaign-wizard";

export default function CampaignWizardPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">AI Campaign Wizard</h1>
        <p className="text-muted-foreground">
          Describe your campaign, answer a few questions, and let AI draft everything for your review.
        </p>
      </div>
      <CampaignWizard />
    </div>
  );
}
