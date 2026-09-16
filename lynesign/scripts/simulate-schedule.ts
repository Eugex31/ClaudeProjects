/**
 * One-off: give "Costa Signage Co" three recurring weekly schedule rules so the
 * /schedule week grid and the player sync schedule tier have something real to
 * resolve.
 *
 *   - "Business hours": Monday to Friday, 08:00 to 18:00, plays "Storefront
 *     Loop" on the storefront screens (the screens that playlist is already
 *     assigned to) through ScheduleRuleScreen rows.
 *   - "After hours": every day, 18:00 to 23:00, plays "Menu Rotation" on the same
 *     screen set. Its window starts exactly where "Business hours" ends, and
 *     minute windows are half-open, so the two never overlap even on weekdays.
 *   - "Weekend": Saturday and Sunday, 10:00 to 16:00, plays "Storefront Loop",
 *     targeting one location through a ScheduleRuleLocation row. Its Sat/Sun days
 *     clear the Monday-to-Friday "Business hours" rule, and its 10:00 to 16:00
 *     window clears the 18:00 to 23:00 "After hours" rule, so all three rules are
 *     mutually non-overlapping.
 *
 * The join rows are written straight through the tenant transaction: this is a
 * seed script, not the gated setScheduleRuleTargets action. A new rule is born
 * at revision 1, so there is no revision work here. As a safety net the script
 * runs the same assertNoScheduleOverlap guard the CRUD actions use, inside the
 * transaction, so a bad edit to the windows or targets above fails loudly and
 * rolls back rather than seeding an overlapping set.
 *
 * Re-run safe: exits if the org already has a ScheduleRule unless --force is
 * passed (which builds another set alongside the existing ones).
 *
 *   npm run db:up
 *   npx tsx scripts/simulate-schedule.ts [--force]
 */
import { prisma } from "@/lib/db/root";
import { withOrgTransaction } from "@/lib/db/tenant";
import { assertNoScheduleOverlap } from "@/lib/schedule/overlap";
import { minutesToHHMM } from "@/lib/validation/schedule";

const ORG_NAME = "Costa Signage Co";
const FORCE = process.argv.includes("--force");

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const fmtDays = (days: number[]) =>
  [...days].sort((a, b) => a - b).map((d) => DAY_NAMES[d]).join(" ");
const fmtWindow = (start: number, end: number) =>
  `${minutesToHHMM(start)} to ${minutesToHHMM(end)}`;

async function main() {
  const org = await prisma.organization.findFirst({ where: { name: ORG_NAME } });
  if (!org) {
    throw new Error(
      `No organization named "${ORG_NAME}". Register it first at /register.`,
    );
  }

  const existing = await prisma.scheduleRule.count({
    where: { organizationId: org.id },
  });
  if (existing > 0 && !FORCE) {
    console.log(
      `Org already has ${existing} schedule rules. Pass --force to build another set.`,
    );
    return;
  }

  const playlists = await prisma.playlist.findMany({
    where: { organizationId: org.id, archivedAt: null },
    select: { id: true, name: true },
  });
  const storefront = playlists.find((p) => p.name === "Storefront Loop");
  const menu = playlists.find((p) => p.name === "Menu Rotation");
  if (!storefront || !menu) {
    throw new Error(
      'Need the "Storefront Loop" and "Menu Rotation" playlists. Run scripts/simulate-playlists.ts first.',
    );
  }

  // The storefront screens are exactly the ones "Storefront Loop" is assigned to.
  const storefrontScreens = await prisma.screen.findMany({
    where: { organizationId: org.id, playlistId: storefront.id },
    orderBy: { name: "asc" },
    select: { id: true, name: true, locationId: true },
  });
  if (storefrontScreens.length === 0) {
    throw new Error(
      'No screens are assigned to "Storefront Loop". Run scripts/simulate-playlists.ts first.',
    );
  }
  const screenIds = storefrontScreens.map((s) => s.id);

  // "Weekend" targets one location: the one holding the most storefront screens.
  const perLocation = new Map<string, number>();
  for (const s of storefrontScreens) {
    perLocation.set(s.locationId, (perLocation.get(s.locationId) ?? 0) + 1);
  }
  const weekendLocationId = [...perLocation.entries()].sort(
    (a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1),
  )[0][0];
  const weekendLocation = await prisma.location.findFirst({
    where: { id: weekendLocationId },
    select: { name: true },
  });

  const owner = await prisma.membership.findFirst({
    where: { organizationId: org.id, role: "OWNER" },
  });
  const createdByUserId = owner?.userId ?? null;

  const rules = [
    {
      name: "Business hours",
      playlistId: storefront.id,
      daysOfWeek: [1, 2, 3, 4, 5],
      startMinute: 480,
      endMinute: 1080,
      screenIds,
      locationIds: [] as string[],
      playlistName: storefront.name,
      targetLabel: `${screenIds.length} screens`,
    },
    {
      name: "After hours",
      playlistId: menu.id,
      daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
      startMinute: 1080,
      endMinute: 1380,
      screenIds,
      locationIds: [] as string[],
      playlistName: menu.name,
      targetLabel: `${screenIds.length} screens`,
    },
    {
      name: "Weekend",
      playlistId: storefront.id,
      daysOfWeek: [0, 6],
      startMinute: 600,
      endMinute: 960,
      screenIds: [] as string[],
      locationIds: [weekendLocationId],
      playlistName: storefront.name,
      targetLabel: `1 location (${weekendLocation?.name ?? weekendLocationId})`,
    },
  ];

  await withOrgTransaction(org.id, async (tx) => {
    for (const rule of rules) {
      const created = await tx.scheduleRule.create({
        data: {
          organizationId: org.id,
          name: rule.name,
          playlistId: rule.playlistId,
          daysOfWeek: rule.daysOfWeek,
          startMinute: rule.startMinute,
          endMinute: rule.endMinute,
          enabled: true,
          createdByUserId,
        },
      });
      if (rule.screenIds.length) {
        await tx.scheduleRuleScreen.createMany({
          data: rule.screenIds.map((screenId) => ({
            organizationId: org.id,
            scheduleRuleId: created.id,
            screenId,
          })),
          skipDuplicates: true,
        });
      }
      if (rule.locationIds.length) {
        await tx.scheduleRuleLocation.createMany({
          data: rule.locationIds.map((locationId) => ({
            organizationId: org.id,
            scheduleRuleId: created.id,
            locationId,
          })),
          skipDuplicates: true,
        });
      }
      await assertNoScheduleOverlap(tx, org.id, {
        id: created.id,
        screenIds: rule.screenIds,
        locationIds: rule.locationIds,
        daysOfWeek: rule.daysOfWeek,
        startMinute: rule.startMinute,
        endMinute: rule.endMinute,
        effectiveFrom: null,
        effectiveUntil: null,
      });
    }
  });

  const ruleCount = await prisma.scheduleRule.count({
    where: { organizationId: org.id },
  });
  const screenTargets = await prisma.scheduleRuleScreen.count({
    where: { organizationId: org.id },
  });
  const locationTargets = await prisma.scheduleRuleLocation.count({
    where: { organizationId: org.id },
  });

  console.log(`\nSchedule simulation complete for ${ORG_NAME}`);
  console.table(
    rules.map((rule) => ({
      rule: rule.name,
      days: fmtDays(rule.daysOfWeek),
      window: fmtWindow(rule.startMinute, rule.endMinute),
      playlist: rule.playlistName,
      targets: rule.targetLabel,
    })),
  );
  console.table({ ruleCount, screenTargets, locationTargets });
  console.log(
    `Storefront screens: ${storefrontScreens.map((s) => s.name).join(", ")}`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
