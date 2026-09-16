import { auth } from "@/lib/auth";
import { CampaignBuilder } from "@/components/campaigns/campaign-builder";

export default async function CampaignPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();

  return <CampaignBuilder campaignId={id} userEmail={session?.user?.email ?? ""} />;
}
