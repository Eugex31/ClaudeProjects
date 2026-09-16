/**
 * Post-migration reconciliation: source row counts vs. what actually landed in
 * LyneSign for the target organization. The migration script exits non-zero if
 * any row reports `ok: false`.
 */
import { normalizeDump, type DmDump } from "./map";

export interface ReconcileRow {
  table: string;
  source: number;
  destination: number;
  ok: boolean;
}

export type ReconcileReport = ReconcileRow[];

interface Counter {
  count(args: { where: Record<string, unknown> }): Promise<number>;
}

/** The subset of the Prisma client `reconcile` needs (root client or tx both fit). */
export interface ReconcileDb {
  location: Counter;
  screen: Counter;
  canvas: Counter;
  panel: Counter;
  frame: Counter;
  frameLocation: Counter;
  content: Counter;
  membership: Counter;
  legacyIntegration: Counter;
}

export async function reconcile(
  rawDump: DmDump,
  db: ReconcileDb,
  organizationId: string,
): Promise<ReconcileReport> {
  const dump = normalizeDump(rawDump);
  const withLegacy = { organizationId, legacyId: { not: null } };
  const scoped = { organizationId };

  const checks: Array<{ table: string; source: number; destination: Promise<number> }> = [
    {
      // Level rows become parent Locations, DM Locations become children.
      table: "locations",
      source: dump.levels.length + dump.locations.length,
      destination: db.location.count({ where: withLegacy }),
    },
    { table: "screens", source: dump.displays.length, destination: db.screen.count({ where: withLegacy }) },
    { table: "canvases", source: dump.canvases.length, destination: db.canvas.count({ where: withLegacy }) },
    { table: "panels", source: dump.panels.length, destination: db.panel.count({ where: withLegacy }) },
    { table: "frames", source: dump.frames.length, destination: db.frame.count({ where: withLegacy }) },
    {
      table: "frameLocations",
      source: dump.frameLocations.length,
      destination: db.frameLocation.count({ where: scoped }),
    },
    {
      // One Content wrapper per Frame.
      table: "content",
      source: dump.frames.length,
      destination: db.content.count({ where: withLegacy }),
    },
    {
      table: "memberships",
      source: dump.users.length,
      destination: db.membership.count({ where: scoped }),
    },
    {
      table: "legacyIntegrations",
      source:
        dump.azureAccounts.length +
        dump.exchangeAccounts.length +
        dump.oauthAccounts.length +
        dump.reportServers.length,
      destination: db.legacyIntegration.count({ where: withLegacy }),
    },
  ];

  const rows: ReconcileReport = [];
  for (const c of checks) {
    const destination = await c.destination;
    rows.push({ table: c.table, source: c.source, destination, ok: c.source === destination });
  }
  return rows;
}
