/**
 * One-off: give "Costa Signage Co" two campaigns so the Campaigns pages and the
 * player sync resolver have something real to show.
 *
 *   - "Fall Sale": runs an existing playlist from yesterday to three weeks out at
 *     priority 10, targeting one location through a CampaignLocation row.
 *   - "Holiday Preview": runs another playlist (the same one if the org has only
 *     one) from next week to five weeks out at priority 5, targeting two screens
 *     through CampaignScreen rows.
 *
 * The join rows are written straight through the tenant transaction: this is a
 * seed script, not the gated setCampaignTargets action. Creating a campaign does
 * not bump anything, so there is no revision work here.
 *
 * Re-run safe: exits if the org already has a Campaign unless --force is passed
 * (which builds a second pair alongside the existing ones).
 *
 *   npm run db:up
 *   npx tsx scripts/simulate-campaigns.ts [--force]
 */
import { prisma } from "@/lib/db/root";
import { withOrgTransaction } from "@/lib/db/tenant";

const ORG_NAME = "Costa Signage Co";
const FORCE = process.argv.includes("--force");

const now = Date.now();
const days = (n: number) => new Date(now + n * 86_400_000);

async function main() {
  const org = await prisma.organization.findFirst({ where: { name: ORG_NAME } });
  if (!org) {
    throw new Error(
      `No organization named "${ORG_NAME}". Register it first at /register.`,
    );
  }

  const existing = await prisma.campaign.count({
    where: { organizationId: org.id },
  });
  if (existing > 0 && !FORCE) {
    console.log(
      `Org already has ${existing} campaigns. Pass --force to build another pair.`,
    );
    return;
  }

  const playlists = await prisma.playlist.findMany({
    where: { organizationId: org.id, archivedAt: null },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
  if (playlists.length === 0) {
    throw new Error(
      "No non-archived playlists in the org. Run scripts/simulate-playlists.ts first.",
    );
  }
  const fallPlaylist = playlists[0];
  const holidayPlaylist = playlists[1] ?? playlists[0];

  const location = await prisma.location.findFirst({
    where: { organizationId: org.id },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
  if (!location) {
    throw new Error(
      "No locations in the org. Run scripts/simulate-account.ts first.",
    );
  }

  const screens = await prisma.screen.findMany({
    where: { organizationId: org.id },
    orderBy: { name: "asc" },
    take: 2,
    select: { id: true, name: true },
  });
  if (screens.length < 2) {
    throw new Error(
      "Need at least two screens in the org. Run scripts/simulate-account.ts first.",
    );
  }

  const owner = await prisma.membership.findFirst({
    where: { organizationId: org.id, role: "OWNER" },
  });

  await withOrgTransaction(org.id, async (tx) => {
    const fall = await tx.campaign.create({
      data: {
        organizationId: org.id,
        name: "Fall Sale",
        description: "Storewide promo playlist across the front-of-house screens.",
        playlistId: fallPlaylist.id,
        startsAt: days(-1),
        endsAt: days(21),
        priority: 10,
        enabled: true,
        createdByUserId: owner?.userId ?? null,
      },
    });
    await tx.campaignLocation.create({
      data: {
        organizationId: org.id,
        campaignId: fall.id,
        locationId: location.id,
      },
    });

    const holiday = await tx.campaign.create({
      data: {
        organizationId: org.id,
        name: "Holiday Preview",
        description: "Seasonal teaser, scheduled to start next week.",
        playlistId: holidayPlaylist.id,
        startsAt: days(7),
        endsAt: days(35),
        priority: 5,
        enabled: true,
        createdByUserId: owner?.userId ?? null,
      },
    });
    await tx.campaignScreen.createMany({
      data: screens.map((s) => ({
        organizationId: org.id,
        campaignId: holiday.id,
        screenId: s.id,
      })),
      skipDuplicates: true,
    });
  });

  const campaigns = await prisma.campaign.count({
    where: { organizationId: org.id },
  });
  const screenTargets = await prisma.campaignScreen.count({
    where: { organizationId: org.id },
  });
  const locationTargets = await prisma.campaignLocation.count({
    where: { organizationId: org.id },
  });

  console.log(`\nCampaign simulation complete for ${ORG_NAME}`);
  console.table({ campaigns, screenTargets, locationTargets });
  console.log(
    `Fall Sale: playlist "${fallPlaylist.name}", location: ${location.name}`,
  );
  console.log(
    `Holiday Preview: playlist "${holidayPlaylist.name}", screens: ${screens
      .map((s) => s.name)
      .join(", ")}`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
