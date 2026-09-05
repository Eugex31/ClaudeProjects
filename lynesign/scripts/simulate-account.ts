/**
 * One-off: populate the "Costa Signage Co" demo org with a realistic network.
 * Writes through the tenant facade (Layer 1 + RLS), same path the app uses.
 * Re-run safe: exits if the org already has locations unless --force is passed.
 *
 *   npx tsx scripts/simulate-account.ts [--force]
 */
import { prisma } from "@/lib/db/root";
import { withOrgTransaction } from "@/lib/db/tenant";
import { writeAudit } from "@/lib/audit";
import { generatePairingCode, newDeviceToken } from "@/lib/pairing";

const ORG_NAME = "Costa Signage Co";
const FORCE = process.argv.includes("--force");

const now = Date.now();
const minutesAgo = (m: number) => new Date(now - m * 60_000);
const daysAgo = (d: number) => new Date(now - d * 86_400_000);

async function main() {
  const org = await prisma.organization.findFirst({ where: { name: ORG_NAME } });
  if (!org) throw new Error(`No organization named "${ORG_NAME}". Register it first at /register.`);

  const owner = await prisma.membership.findFirst({
    where: { organizationId: org.id, role: "OWNER" },
    include: { user: true },
  });
  const ownerUserId = owner?.userId;

  const existingLocations = await prisma.location.count({ where: { organizationId: org.id } });
  if (existingLocations > 0 && !FORCE) {
    console.log(`Org already has ${existingLocations} locations. Pass --force to add more anyway.`);
    return;
  }

  // Give the trial org room to hold the simulated network.
  await prisma.subscription.update({
    where: { organizationId: org.id },
    data: { planKey: "GROWTH", status: "ACTIVE", trialEndsAt: null },
  });
  console.log("Subscription -> GROWTH / ACTIVE");

  const summary = await withOrgTransaction(
    org.id,
    async (tx) => {
      // ---- Locations: one region parent + five sites --------------------
      const usa = await tx.location.create({
        data: { name: "United States", timeZone: "America/New_York", locale: "en-US" },
      });

      const site = async (data: {
        name: string;
        city: string;
        region: string;
        postalCode: string;
        timeZone: string;
        latitude: number;
        longitude: number;
      }) =>
        tx.location.create({
          data: {
            parentId: usa.id,
            countryCode: "US",
            locale: "en-US",
            addressLine1: `${100 + Math.floor(Math.random() * 899)} Market St`,
            ...data,
          },
        });

      const downtown = await site({
        name: "Downtown Flagship",
        city: "New York",
        region: "NY",
        postalCode: "10013",
        timeZone: "America/New_York",
        latitude: 40.7208,
        longitude: -74.0059,
      });
      const airport = await site({
        name: "Airport Kiosk T2",
        city: "Newark",
        region: "NJ",
        postalCode: "07114",
        timeZone: "America/New_York",
        latitude: 40.6895,
        longitude: -74.1745,
      });
      const mall = await site({
        name: "Westfield Mall Unit 118",
        city: "Los Angeles",
        region: "CA",
        postalCode: "90067",
        timeZone: "America/Los_Angeles",
        latitude: 34.0575,
        longitude: -118.4187,
      });
      const warehouse = await site({
        name: "Warehouse Breakroom",
        city: "Chicago",
        region: "IL",
        postalCode: "60607",
        timeZone: "America/Chicago",
        latitude: 41.8721,
        longitude: -87.6598,
      });
      const popup = await site({
        name: "Brooklyn Popup",
        city: "Brooklyn",
        region: "NY",
        postalCode: "11201",
        timeZone: "America/New_York",
        latitude: 40.6955,
        longitude: -73.9895,
      });

      // ---- Screens -----------------------------------------------------
      type Plan = {
        loc: { id: string };
        name: string;
        state: "online" | "offline" | "unpaired";
        seenMin?: number; // minutes since last heartbeat (online/offline)
        orientation?: "landscape" | "portrait";
        poll?: number;
      };

      const plans: Plan[] = [
        { loc: downtown, name: "Window Display North", state: "online", seenMin: 1, orientation: "portrait" },
        { loc: downtown, name: "Window Display South", state: "online", seenMin: 2, orientation: "portrait" },
        { loc: downtown, name: "Checkout Overhead", state: "online", seenMin: 3, orientation: "landscape" },
        { loc: downtown, name: "Cafe Menu Board", state: "offline", seenMin: 55, orientation: "landscape" },
        { loc: airport, name: "Kiosk Portrait A", state: "online", seenMin: 1, orientation: "portrait" },
        { loc: airport, name: "Kiosk Portrait B", state: "unpaired", orientation: "portrait" },
        { loc: mall, name: "Storefront LED Wall", state: "online", seenMin: 4, orientation: "landscape", poll: 30 },
        { loc: mall, name: "Fitting Room Hallway", state: "offline", seenMin: 1440, orientation: "landscape" },
        { loc: warehouse, name: "Breakroom TV", state: "online", seenMin: 6, orientation: "landscape" },
        { loc: popup, name: "Popup Entrance", state: "online", seenMin: 2, orientation: "portrait" },
        { loc: popup, name: "Popup Back Wall", state: "unpaired", orientation: "landscape" },
        { loc: warehouse, name: "Loading Dock Notice", state: "unpaired", orientation: "landscape" },
      ];

      const screens: { name: string; status: string; pairingCode?: string }[] = [];
      for (const p of plans) {
        const base = {
          locationId: p.loc.id,
          name: p.name,
          orientation: p.orientation ?? "landscape",
          pollIntervalSeconds: p.poll ?? 60,
        };
        if (p.state === "unpaired") {
          const pairingCode = generatePairingCode();
          await tx.screen.create({ data: { ...base, status: "UNPAIRED", pairingCode } });
          screens.push({ name: p.name, status: "UNPAIRED", pairingCode });
        } else {
          const { hash } = newDeviceToken();
          await tx.screen.create({
            data: {
              ...base,
              status: p.state === "online" ? "ONLINE" : "OFFLINE",
              deviceTokenHash: hash,
              lastSeenAt: minutesAgo(p.seenMin ?? 5),
            },
          });
          screens.push({ name: p.name, status: p.state.toUpperCase() });
        }
      }

      // ---- A pending teammate invitation -----------------------------
      await tx.invitation.create({
        data: {
          email: "maria@costasignage.test",
          role: "MANAGER",
          token: newDeviceToken().raw,
          expiresAt: new Date(now + 7 * 86_400_000),
          invitedByUserId: ownerUserId ?? undefined,
        },
      });

      return {
        locations: 6,
        screens: screens.length,
        online: screens.filter((s) => s.status === "ONLINE").length,
        offline: screens.filter((s) => s.status === "OFFLINE").length,
        unpaired: screens.filter((s) => s.status === "UNPAIRED").length,
        pairingCodes: screens.filter((s) => s.pairingCode).map((s) => `${s.name}: ${s.pairingCode}`),
      };
    },
    { timeout: 60_000, maxWait: 15_000 },
  );

  // ---- Backdated activity feed --------------------------------------
  const feed: { action: string; targetType: string; when: Date }[] = [
    { action: "location.create", targetType: "Location", when: daysAgo(9) },
    { action: "location.create", targetType: "Location", when: daysAgo(9) },
    { action: "screen.create", targetType: "Screen", when: daysAgo(8) },
    { action: "screen.pair", targetType: "Screen", when: daysAgo(8) },
    { action: "screen.create", targetType: "Screen", when: daysAgo(6) },
    { action: "member.invite", targetType: "Invitation", when: daysAgo(3) },
    { action: "screen.pair", targetType: "Screen", when: daysAgo(2) },
    { action: "screen.create", targetType: "Screen", when: minutesAgo(40) },
  ];
  for (const f of feed) {
    await writeAudit({
      organizationId: org.id,
      actorType: "USER",
      actorId: ownerUserId ?? undefined,
      action: f.action,
      targetType: f.targetType,
      metadata: { simulated: true },
    });
  }
  // Nudge the timestamps so the feed reads as a history, not one burst.
  const rows = await prisma.auditLog.findMany({
    where: { organizationId: org.id },
    orderBy: { createdAt: "asc" },
  });
  for (let i = 0; i < Math.min(rows.length, feed.length); i++) {
    await prisma.auditLog.update({ where: { id: rows[i].id }, data: { createdAt: feed[i].when } });
  }

  console.log("\nSimulation complete for", ORG_NAME);
  console.table(summary);
  if (summary.pairingCodes.length) {
    console.log("\nUnpaired screens (codes to enter on a player):");
    for (const c of summary.pairingCodes) console.log("  " + c);
  }
  console.log("\nPending invite: maria@costasignage.test (Manager)");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
