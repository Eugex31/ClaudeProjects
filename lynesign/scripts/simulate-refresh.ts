/** Refresh the demo screens' heartbeats so the network reads as live. One-off. */
import { prisma } from "@/lib/db/root";

async function main() {
  const org = await prisma.organization.findFirst({ where: { name: "Costa Signage Co" } });
  if (!org) throw new Error("no org");
  const screens = await prisma.screen.findMany({
    where: { organizationId: org.id },
    orderBy: { name: "asc" },
  });
  // Keep the two named ...deliberately offline; keep UNPAIRED as-is; everything
  // else gets a fresh heartbeat and a long poll interval so it stays green.
  const keepOffline = new Set(["Cafe Menu Board", "Fitting Room Hallway"]);
  let online = 0, offline = 0, unpaired = 0;
  for (const s of screens) {
    if (s.status === "UNPAIRED" || !s.deviceTokenHash) { unpaired++; continue; }
    if (keepOffline.has(s.name)) {
      await prisma.screen.update({
        where: { id: s.id },
        data: { status: "OFFLINE", lastSeenAt: new Date(Date.now() - 3 * 3600_000) },
      });
      offline++;
    } else {
      await prisma.screen.update({
        where: { id: s.id },
        data: { status: "ONLINE", lastSeenAt: new Date(), pollIntervalSeconds: 300 },
      });
      online++;
    }
  }
  console.log(`online=${online} offline=${offline} unpaired=${unpaired} total=${screens.length}`);
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
