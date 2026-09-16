/**
 * Display Monkey -> LyneSign migration.
 *
 *   npm run migrate:dm -- --fixture scripts/fixtures/displaymonkey.sample.json
 *   npm run migrate:dm -- --org-name "Acme" --mssql-url "Server=...;Database=DisplayMonkey;..."
 *
 * Reads a Display Monkey dump (JSON fixture, or a live SQL Server via a dynamic
 * `mssql` import), maps it with the pure `mapDump`, upserts everything into one
 * organization inside `withOrgTransaction`, then reconciles source vs.
 * destination row counts and exits non-zero on any mismatch.
 *
 * Idempotent: every insert is a per-row `upsert` keyed on `legacyId` (or a
 * composite/global unique where the model has no `legacyId`), so a re-run
 * updates in place instead of duplicating.
 *
 * SINGLE SOURCE, SINGLE ORG: `legacyId` is globally `@unique` in the LyneSign
 * schema, so one Display Monkey database maps to exactly one target
 * organization. Re-running against the same `--org-name` is idempotent;
 * importing the same dump into a *second* organization is unsupported and fails
 * loud on the first `legacyId` collision.
 */
import { pathToFileURL } from "node:url";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/root";
import { withOrgTransaction } from "@/lib/db/tenant";
import { slugify } from "@/lib/slug";
import { readSource } from "./dm/reader";
import { mapDump, type MappedRows, type MappedTyped } from "./dm/map";
import { reconcile, type ReconcileReport } from "./dm/reconcile";

export interface RunMigrationOptions {
  fixture?: string;
  mssqlUrl?: string;
  orgName?: string;
}

export interface RunMigrationResult {
  organizationId: string;
  slug: string;
  report: ReconcileReport;
  ok: boolean;
}

/** Two minutes to insert the whole dump, and 30s to get a connection. */
const DM_TRANSACTION_OPTIONS = { timeout: 120_000, maxWait: 30_000 } as const;

const TYPED_MODEL: Record<MappedTyped["kind"], string> = {
  clock: "clock",
  picture: "picture",
  video: "video",
  youtube: "youtube",
  html: "html",
  memo: "memo",
  outlook: "outlook",
  report: "report",
  powerbi: "powerbi",
  weather: "weather",
  news: "news",
};

export async function runMigration(opts: RunMigrationOptions): Promise<RunMigrationResult> {
  const orgName = opts.orgName?.trim() || "Imported";
  const mssqlUrl = opts.mssqlUrl || process.env.DISPLAYMONKEY_MSSQL_URL || undefined;

  if (!opts.fixture && !mssqlUrl) {
    throw new Error("runMigration: pass `fixture` or `mssqlUrl` (or set DISPLAYMONKEY_MSSQL_URL)");
  }

  const dump = await readSource({ fixture: opts.fixture, mssqlUrl });

  // --- Organization + subscription (global tables, root client) ------------
  const slug = slugify(orgName);
  const org = await prisma.organization.upsert({
    where: { slug },
    update: { name: orgName },
    create: { name: orgName, slug },
  });

  await prisma.subscription.upsert({
    where: { organizationId: org.id },
    // ENTERPRISE has null limits, so plan enforcement never blocks the import.
    update: { planKey: "ENTERPRISE", status: "ACTIVE" },
    create: { organizationId: org.id, planKey: "ENTERPRISE", status: "ACTIVE" },
  });

  const mapped = mapDump(dump, { organizationId: org.id });

  // --- Users are global: upsert with the root client, before the tenant tx --
  const userIdByUname = new Map<string, string>();
  for (const m of mapped.users) {
    const user = await prisma.user.upsert({
      where: { email: m.user.email },
      update: { name: m.user.name },
      create: {
        email: m.user.email,
        name: m.user.name,
        hashedPassword: m.user.hashedPassword,
        mustResetPassword: m.user.mustResetPassword,
      },
    });
    userIdByUname.set(m.uname, user.id);
  }

  await insertTenantRows(org.id, mapped, userIdByUname);

  // LegacyIntegration is upserted with the ROOT client, not inside the tenant
  // transaction. Its `legacyId` is a global unique and the table has no
  // `organization` relation, so a tenant-scoped upsert cannot see -- let alone
  // reclaim -- a row that a previous import (or a test that wiped organizations)
  // left orphaned under a now-deleted org. The root client (RLS-unscoped) does a
  // clean upsert on `legacyId` and re-points `organizationId` at this org. The
  // row still carries the correct `organizationId`, so tenant reads are unaffected.
  for (const li of mapped.legacyIntegrations) {
    const payload = li.payload as Prisma.InputJsonValue;
    await prisma.legacyIntegration.upsert({
      where: { legacyId: li.legacyId },
      update: { organizationId: li.organizationId, kind: li.kind, payload },
      create: {
        organizationId: li.organizationId,
        legacyId: li.legacyId,
        kind: li.kind,
        payload,
      },
    });
  }

  const report = await reconcile(dump, prisma, org.id);
  return { organizationId: org.id, slug, report, ok: report.every((r) => r.ok) };
}

async function insertTenantRows(
  organizationId: string,
  mapped: MappedRows,
  userIdByUname: Map<string, string>,
): Promise<void> {
  // Prisma's 5-second interactive-transaction default is far too short for a
  // real dump: this is one transaction covering every tenant row in the import.
  await withOrgTransaction(organizationId, async (tx) => {
    // FK-safe order: Location parents -> children -> Canvas -> Panel -> Frame
    // -> FrameLocation -> Content -> typed -> Screen -> Membership -> Integration.
    const locationIdByLegacy = new Map<number, string>();

    for (const loc of mapped.locations.filter((l) => l.parentLegacyId === null)) {
      const row = await tx.location.upsert({
        where: { legacyId: loc.legacyId },
        update: { name: loc.name, parentId: null },
        create: {
          organizationId,
          legacyId: loc.legacyId,
          name: loc.name,
          parentId: null,
          timeZone: loc.timeZone,
          locale: loc.locale,
        },
      });
      locationIdByLegacy.set(loc.legacyId, row.id);
    }

    for (const loc of mapped.locations.filter((l) => l.parentLegacyId !== null)) {
      const parentId = loc.parentLegacyId != null ? locationIdByLegacy.get(loc.parentLegacyId) ?? null : null;
      const row = await tx.location.upsert({
        where: { legacyId: loc.legacyId },
        update: { name: loc.name, parentId },
        create: {
          organizationId,
          legacyId: loc.legacyId,
          name: loc.name,
          parentId,
          latitude: loc.latitude,
          longitude: loc.longitude,
          timeZone: loc.timeZone,
          locale: loc.locale,
          temperatureUnit: loc.temperatureUnit,
        },
      });
      locationIdByLegacy.set(loc.legacyId, row.id);
    }

    const canvasIdByLegacy = new Map<number, string>();
    for (const c of mapped.canvases) {
      const row = await tx.canvas.upsert({
        where: { legacyId: c.legacyId },
        update: { name: c.name, width: c.width, height: c.height, backgroundColor: c.backgroundColor },
        create: {
          organizationId,
          legacyId: c.legacyId,
          name: c.name,
          width: c.width,
          height: c.height,
          backgroundColor: c.backgroundColor,
        },
      });
      canvasIdByLegacy.set(c.legacyId, row.id);
    }

    const panelIdByLegacy = new Map<number, string>();
    for (const p of mapped.panels) {
      const canvasId = canvasIdByLegacy.get(p.canvasLegacyId);
      if (!canvasId) throw new Error(`panel ${p.legacyId}: unknown canvas legacyId ${p.canvasLegacyId}`);
      const row = await tx.panel.upsert({
        where: { legacyId: p.legacyId },
        update: { name: p.name, x: p.x, y: p.y, width: p.width, height: p.height, zIndex: p.zIndex },
        create: {
          organizationId,
          legacyId: p.legacyId,
          canvasId,
          name: p.name,
          x: p.x,
          y: p.y,
          width: p.width,
          height: p.height,
          zIndex: p.zIndex,
          noScroll: p.noScroll,
        },
      });
      panelIdByLegacy.set(p.legacyId, row.id);
    }

    const frameIdByLegacy = new Map<number, string>();
    for (const f of mapped.frames) {
      const panelId = panelIdByLegacy.get(f.panelLegacyId);
      if (!panelId) throw new Error(`frame ${f.legacyId}: unknown panel legacyId ${f.panelLegacyId}`);
      const row = await tx.frame.upsert({
        where: { legacyId: f.legacyId },
        update: {
          sortOrder: f.sortOrder,
          durationSeconds: f.durationSeconds,
          type: f.type,
          locationScoped: f.locationScoped,
        },
        create: {
          organizationId,
          legacyId: f.legacyId,
          panelId,
          sortOrder: f.sortOrder,
          durationSeconds: f.durationSeconds,
          type: f.type,
          locationScoped: f.locationScoped,
        },
      });
      frameIdByLegacy.set(f.legacyId, row.id);
    }

    for (const fl of mapped.frameLocations) {
      const frameId = frameIdByLegacy.get(fl.frameLegacyId);
      const locationId = locationIdByLegacy.get(fl.locationLegacyId);
      if (!frameId || !locationId) {
        throw new Error(
          `frameLocation: unresolved frame ${fl.frameLegacyId} / location ${fl.locationLegacyId}`,
        );
      }
      await tx.frameLocation.upsert({
        where: { frameId_locationId: { frameId, locationId } },
        update: {},
        create: { organizationId, frameId, locationId },
      });
    }

    const contentIdByFrameLegacy = new Map<number, string>();
    for (const c of mapped.content) {
      const frameId = frameIdByLegacy.get(c.frameLegacyId);
      if (!frameId) throw new Error(`content ${c.legacyId}: unknown frame legacyId ${c.frameLegacyId}`);
      const row = await tx.content.upsert({
        where: { legacyId: c.legacyId },
        update: { name: c.name },
        create: { organizationId, legacyId: c.legacyId, frameId, name: c.name },
      });
      contentIdByFrameLegacy.set(c.frameLegacyId, row.id);
    }

    for (const t of mapped.typed) {
      const contentId = contentIdByFrameLegacy.get(t.frameLegacyId);
      if (!contentId) throw new Error(`typed ${t.kind}: no content for frame ${t.frameLegacyId}`);
      const model = TYPED_MODEL[t.kind];
      const delegate = (tx as unknown as Record<string, {
        upsert(args: {
          where: Record<string, unknown>;
          update: Record<string, unknown>;
          create: Record<string, unknown>;
        }): Promise<unknown>;
      }>)[model];
      await delegate.upsert({
        where: { contentId },
        update: t.data,
        create: { organizationId: t.organizationId, contentId, ...t.data },
      });
    }

    for (const s of mapped.screens) {
      const locationId = locationIdByLegacy.get(s.locationLegacyId);
      if (!locationId) throw new Error(`screen ${s.legacyId}: unknown location legacyId ${s.locationLegacyId}`);
      const canvasId = s.canvasLegacyId != null ? canvasIdByLegacy.get(s.canvasLegacyId) ?? null : null;
      await tx.screen.upsert({
        where: { legacyId: s.legacyId },
        update: {
          name: s.name,
          locationId,
          canvasId,
          status: s.status,
          pollIntervalSeconds: s.pollIntervalSeconds,
        },
        create: {
          organizationId,
          legacyId: s.legacyId,
          name: s.name,
          locationId,
          canvasId,
          status: s.status,
          pollIntervalSeconds: s.pollIntervalSeconds,
          orientation: s.orientation,
          notes: s.notes,
        },
      });
    }

    for (const m of mapped.users) {
      const userId = userIdByUname.get(m.uname);
      if (!userId) throw new Error(`membership: no user id for ${m.uname}`);
      await tx.membership.upsert({
        where: { userId_organizationId: { userId, organizationId } },
        update: { role: m.membership.role },
        create: { organizationId, userId, role: m.membership.role },
      });
    }
  }, DM_TRANSACTION_OPTIONS);
}

/* -------------------------------------------------------------------------- */
/* CLI                                                                         */
/* -------------------------------------------------------------------------- */

export function parseArgs(argv: string[]): RunMigrationOptions {
  const opts: RunMigrationOptions = {};
  // Values are greedy up to the next `--flag`, so `npm run` splitting an
  // unquoted `--org-name My Company` into three tokens still yields "My Company".
  const takeValue = (start: number): { value: string; next: number } => {
    const parts: string[] = [];
    let i = start;
    for (; i < argv.length && !argv[i].startsWith("--"); i++) parts.push(argv[i]);
    return { value: parts.join(" "), next: i - 1 };
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--org-name") {
      const { value, next } = takeValue(i + 1);
      opts.orgName = value;
      i = next;
    } else if (arg === "--fixture") {
      opts.fixture = argv[++i];
    } else if (arg === "--mssql-url") {
      const { value, next } = takeValue(i + 1);
      opts.mssqlUrl = value;
      i = next;
    }
  }
  return opts;
}

export async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  const result = await runMigration(opts);

  console.log(`\nOrganization: ${result.slug} (${result.organizationId})`);
  console.table(result.report);

  if (!result.ok) {
    console.error("\nReconciliation FAILED: destination counts do not match the source.");
    process.exit(1);
  }
  console.log("\nReconciliation OK.");
  process.exit(0);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main()
    .catch((err) => {
      console.error(err);
      process.exit(1);
    })
    .finally(() => prisma.$disconnect());
}
