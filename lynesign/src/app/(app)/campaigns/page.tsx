import { format } from "date-fns";
import { Megaphone } from "lucide-react";

import { requireRole } from "@/lib/auth/context";
import { can } from "@/lib/rbac/can";
import { withOrgTransaction } from "@/lib/db/tenant";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/empty-state";
import { NewCampaignDialog } from "@/components/app/campaigns/new-campaign-dialog";
import {
  CampaignList,
  type CampaignListRow,
} from "@/components/app/campaigns/campaign-list";

export const metadata = { title: "Campaigns" };

/**
 * Campaigns index for the active organization. One `withOrgTransaction` loads
 * every live campaign with its playlist name and target counts, plus the org's
 * live playlists for the new-campaign dialog. Everything handed to the client is
 * serializable: the run window and live status are turned into strings here so
 * no `Date` crosses the boundary.
 */
export default async function CampaignsPage() {
  const ctx = await requireRole("campaign.view");
  const canCreate = can(ctx.actor, "campaign.create");

  const now = new Date();

  const { rows, playlists } = await withOrgTransaction(
    ctx.organizationId,
    async (tx) => {
      const campaigns = await tx.campaign.findMany({
        where: { archivedAt: null },
        orderBy: [{ startsAt: "asc" }],
        include: {
          playlist: { select: { name: true } },
          _count: { select: { screens: true, locations: true } },
        },
      });
      const playlists = await tx.playlist.findMany({
        where: { archivedAt: null },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      });

      const rows: CampaignListRow[] = campaigns.map((c) => {
        const startsMs = c.startsAt.getTime();
        const endsMs = c.endsAt.getTime();
        const nowMs = now.getTime();
        const status = !c.enabled
          ? "Paused"
          : nowMs < startsMs
            ? "Scheduled"
            : nowMs >= endsMs
              ? "Ended"
              : "Active";

        const s = c._count.screens;
        const l = c._count.locations;
        let targetLabel = `${s} ${s === 1 ? "screen" : "screens"}`;
        if (l > 0) {
          targetLabel += `, ${l} ${l === 1 ? "location" : "locations"}`;
        }

        return {
          id: c.id,
          name: c.name,
          playlistName: c.playlist.name,
          windowLabel: `${format(c.startsAt, "d MMM")} to ${format(c.endsAt, "d MMM")}`,
          status,
          targetLabel,
          priority: c.priority,
        };
      });

      return { rows, playlists };
    },
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Campaigns"
        description="Run a playlist across a group of screens for a date range."
        actions={canCreate ? <NewCampaignDialog playlists={playlists} /> : null}
      />
      {rows.length === 0 ? (
        <EmptyState
          icon={Megaphone}
          title="No campaigns yet"
          description="Create a campaign to run a playlist across some screens for a while."
          action={canCreate ? <NewCampaignDialog playlists={playlists} /> : null}
        />
      ) : (
        <CampaignList rows={rows} />
      )}
    </div>
  );
}
