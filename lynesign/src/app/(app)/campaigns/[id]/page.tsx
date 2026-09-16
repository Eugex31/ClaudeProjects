import { notFound } from "next/navigation";

import { requireRole } from "@/lib/auth/context";
import { can } from "@/lib/rbac/can";
import { withOrgTransaction } from "@/lib/db/tenant";
import { PageHeader } from "@/components/app/page-header";
import { CampaignEditor } from "@/components/app/campaigns/campaign-editor";

export const metadata = { title: "Campaign" };

/**
 * Campaign editor for one campaign in the active organization. A single
 * `withOrgTransaction` loads the campaign with its playlist, its screen and
 * location targets, and the org's playlists, screens and locations for the
 * pickers. `affectedScreenCount` is resolved here as the size of the union of
 * the directly-targeted screens and every screen sitting under a targeted
 * location, so the client never re-derives it. Everything crossing the boundary
 * is serializable: the run window becomes ISO strings and archived state becomes
 * booleans, and no closures are passed.
 */
export default async function CampaignEditorPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await requireRole("campaign.view");

  const data = await withOrgTransaction(ctx.organizationId, async (tx) => {
    const campaign = await tx.campaign.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        description: true,
        playlistId: true,
        startsAt: true,
        endsAt: true,
        priority: true,
        enabled: true,
        archivedAt: true,
        playlist: { select: { id: true, name: true, archivedAt: true } },
      },
    });
    if (!campaign) return null;

    const targetScreens = await tx.campaignScreen.findMany({
      where: { campaignId: id },
      select: { screenId: true },
    });
    const targetLocations = await tx.campaignLocation.findMany({
      where: { campaignId: id },
      select: { locationId: true },
    });

    const playlists = await tx.playlist.findMany({
      where: { archivedAt: null },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    });
    const screens = await tx.screen.findMany({
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        locationId: true,
        location: { select: { name: true } },
      },
    });
    const locations = await tx.location.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    });

    return {
      campaign,
      targetScreens,
      targetLocations,
      playlists,
      screens,
      locations,
    };
  });

  if (!data) notFound();
  const { campaign, targetScreens, targetLocations, playlists, screens, locations } =
    data;

  const targetedLocSet = new Set(targetLocations.map((l) => l.locationId));
  const directSet = new Set(targetScreens.map((s) => s.screenId));
  const affected = new Set<string>([
    ...directSet,
    ...screens
      .filter((s) => targetedLocSet.has(s.locationId))
      .map((s) => s.id),
  ]);
  const affectedScreenCount = affected.size;

  return (
    <div className="space-y-6">
      <PageHeader
        title={campaign.name}
        description="Set the playlist, the date range, priority, and which screens it runs on."
      />
      <CampaignEditor
        campaign={{
          id: campaign.id,
          name: campaign.name,
          description: campaign.description,
          playlistId: campaign.playlistId,
          startsAt: campaign.startsAt.toISOString(),
          endsAt: campaign.endsAt.toISOString(),
          priority: campaign.priority,
          enabled: campaign.enabled,
          isArchived: campaign.archivedAt !== null,
          playlist: {
            id: campaign.playlist.id,
            name: campaign.playlist.name,
            isArchived: campaign.playlist.archivedAt !== null,
          },
        }}
        playlists={playlists}
        screens={screens.map((s) => ({
          id: s.id,
          name: s.name,
          locationId: s.locationId,
          locationName: s.location.name,
        }))}
        locations={locations}
        targetedScreenIds={targetScreens.map((s) => s.screenId)}
        targetedLocationIds={targetLocations.map((l) => l.locationId)}
        affectedScreenCount={affectedScreenCount}
        canUpdate={can(ctx.actor, "campaign.update")}
        canDelete={can(ctx.actor, "campaign.delete")}
      />
    </div>
  );
}
