import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import type { Prisma } from "@prisma/client";
import { forOrg, withOrgTransaction, TENANT_MODELS } from "@/lib/db/tenant";
import { prisma } from "@/lib/db/root";

/** Reach past the facade's types to probe what it exposes at runtime. */
const asRecord = (value: unknown) => value as Record<string, unknown>;

const slug = (p: string) => `${p}-${Date.now()}-${Math.random().toString(36).slice(2)}`;

/**
 * A create input with no owner on it. The facade keeps Prisma's generated types,
 * which still ask for `organizationId`; this cast is how the tests reach the
 * runtime injection the guard performs for callers that omit it.
 */
const unowned = (name: string) => ({ name }) as Prisma.LocationUncheckedCreateInput;

async function twoOrgs() {
  const a = await prisma.organization.create({ data: { name: "A", slug: slug("a") } });
  const b = await prisma.organization.create({ data: { name: "B", slug: slug("b") } });
  return { a, b };
}

describe("forOrg", () => {
  it("throws without an org id", () => {
    expect(() => forOrg("")).toThrow(/non-empty organizationId/);
  });

  it("only returns rows for the scoped org", async () => {
    const { a, b } = await twoOrgs();
    await prisma.location.create({ data: { organizationId: a.id, name: "keep" } });
    await prisma.location.create({ data: { organizationId: b.id, name: "hide" } });

    const db = forOrg(a.id);
    const rows = await db.location.findMany();
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.organizationId === a.id)).toBe(true);
    expect(rows.some((r) => r.name === "hide")).toBe(false);
  });

  it("blocks writes for a different org", async () => {
    const { a, b } = await twoOrgs();
    const db = forOrg(a.id);
    await expect(
      db.location.create({ data: { organizationId: b.id, name: "evil" } }),
    ).rejects.toThrow(/cross-tenant/i);
    // ...and nothing was written under either org.
    expect(await prisma.location.count({ where: { name: "evil" } })).toBe(0);
  });

  it("merges the org filter with a caller-supplied filter instead of clobbering it", async () => {
    const { a } = await twoOrgs();
    await prisma.location.create({ data: { organizationId: a.id, name: "wanted" } });
    await prisma.location.create({ data: { organizationId: a.id, name: "unwanted" } });

    const rows = await forOrg(a.id).location.findMany({ where: { name: "wanted" } });
    expect(rows.map((r) => r.name)).toEqual(["wanted"]);
  });

  it("injects organizationId on create so callers need not supply it", async () => {
    const { a } = await twoOrgs();
    const name = slug("implicit");
    const created = await forOrg(a.id).location.create({ data: unowned(name) });
    expect(created.organizationId).toBe(a.id);
    expect(await prisma.location.count({ where: { name } })).toBe(1);
  });

  it("cannot read another org's row by id", async () => {
    const { a, b } = await twoOrgs();
    const bRow = await prisma.location.create({ data: { organizationId: b.id, name: slug("bee") } });
    expect(await forOrg(a.id).location.findUnique({ where: { id: bRow.id } })).toBeNull();
  });

  it("cannot update or delete another org's row", async () => {
    const { a, b } = await twoOrgs();
    const bRow = await prisma.location.create({ data: { organizationId: b.id, name: slug("bee") } });

    expect(await forOrg(a.id).location.updateMany({ where: { id: bRow.id }, data: { name: "hijacked" } }))
      .toMatchObject({ count: 0 });
    expect(await forOrg(a.id).location.deleteMany({ where: { id: bRow.id } })).toMatchObject({ count: 0 });
    expect(await prisma.location.findUnique({ where: { id: bRow.id } })).not.toBeNull();
  });
});

describe("withOrgTransaction", () => {
  it("throws without an org id", async () => {
    await expect(withOrgTransaction("", async () => null)).rejects.toThrow(/non-empty organizationId/);
  });

  it("persists writes past COMMIT", async () => {
    const { a } = await twoOrgs();
    const name = slug("persisted");

    const created = await withOrgTransaction(a.id, async (tx) => tx.location.create({ data: unowned(name) }));
    expect(created.organizationId).toBe(a.id);

    // Visible afterwards through the unscoped root client -> the transaction committed.
    const found = await prisma.location.findMany({ where: { name } });
    expect(found).toHaveLength(1);
    expect(found[0].organizationId).toBe(a.id);
  });

  it("sets the RLS GUC so Postgres blocks cross-tenant access", async () => {
    const { a, b } = await twoOrgs();
    const bRow = await prisma.location.create({ data: { organizationId: b.id, name: slug("bee") } });

    const seen = await withOrgTransaction(a.id, async (tx) => {
      const guc = await tx.$queryRawUnsafe<{ v: string | null }[]>(
        `SELECT current_setting('app.current_org', true) AS v`,
      );
      // Raw SQL bypasses the app-layer extension entirely; only RLS can hide this row.
      const raw = await tx.$queryRawUnsafe<{ id: string }[]>(`SELECT id FROM "Location"`);
      return { guc: guc[0].v, ids: raw.map((r) => r.id) };
    });

    expect(seen.guc).toBe(a.id);
    expect(seen.ids).not.toContain(bRow.id);
  });

  it("rolls back the whole unit of work when the callback throws", async () => {
    const { a } = await twoOrgs();
    const name = slug("rolledback");

    await expect(
      withOrgTransaction(a.id, async (tx) => {
        await tx.location.create({ data: unowned(name) });
        throw new Error("boom");
      }),
    ).rejects.toThrow(/boom/);

    expect(await prisma.location.count({ where: { name } })).toBe(0);
  });

  it("leaves the root client able to read every org afterwards", async () => {
    const { a, b } = await twoOrgs();
    await withOrgTransaction(a.id, async (tx) => tx.location.create({ data: unowned(slug("a-row")) }));
    const bName = slug("b-row");
    await prisma.location.create({ data: { organizationId: b.id, name: bName } });
    // Regression guard: a leaked `app.current_org` on a pooled connection must
    // not make the unscoped client blind to other orgs.
    expect(await prisma.location.count({ where: { name: bName } })).toBe(1);
  });
});

describe("the facade exposes nothing but tenant models", () => {
  it("refuses non-tenant delegates", () => {
    const db = asRecord(forOrg("org-x"));
    for (const key of ["organization", "user", "plan", "account", "session"]) {
      expect(() => db[key]).toThrow(/not reachable from a tenant client/);
    }
  });

  it("refuses raw SQL and transaction escape hatches", () => {
    const db = asRecord(forOrg("org-x"));
    for (const key of ["$queryRaw", "$queryRawUnsafe", "$executeRaw", "$executeRawUnsafe", "$transaction", "$extends", "$connect"]) {
      expect(() => db[key]).toThrow(/not reachable from a tenant client/);
    }
  });

  it("refuses an operation it cannot tenant-scope, rather than forwarding it", () => {
    const locations = asRecord(asRecord(forOrg("org-x")).location);
    for (const op of ["findRaw", "aggregateRaw", "runCommandRaw"]) {
      expect(() => locations[op]).toThrow(/not a tenant-scoped operation/);
    }
    // The scoped operations are of course still reachable.
    expect(typeof locations.findMany).toBe("function");
  });

  it("survives being awaited and inspected", async () => {
    const db = forOrg("org-x");
    await expect(Promise.resolve(db)).resolves.toBe(db);
    expect(() => String(db)).not.toThrow();
  });

  it("rejects a filter that names another organization", async () => {
    const { a, b } = await twoOrgs();
    await expect(
      forOrg(a.id).location.findMany({ where: { organizationId: b.id } }),
    ).rejects.toThrow(/cross-tenant/i);
  });
});

describe("nested payloads and foreign keys cannot cross tenants", () => {
  it("(a) blocks a nested create that plants a row in another org", async () => {
    const { a, b } = await twoOrgs();

    // The extension only rewrites the top level, so `panels.create[].organizationId`
    // reaches Postgres untouched. RLS WITH CHECK is what refuses it.
    await expect(
      forOrg(a.id).canvas.create({
        data: {
          organizationId: a.id,
          name: slug("canvas"),
          width: 1920,
          height: 1080,
          panels: { create: [{ organizationId: b.id, x: 0, y: 0, width: 1, height: 1 }] },
        },
      }),
    ).rejects.toThrow();

    expect(await prisma.panel.count({ where: { organizationId: b.id } })).toBe(0);
    // The whole transaction rolled back, so the parent Canvas is gone too.
    expect(await prisma.canvas.count({ where: { organizationId: a.id } })).toBe(0);
  });

  it("(b) never leaks another org's location through a raw foreign key", async () => {
    const { a, b } = await twoOrgs();
    const bLocation = await prisma.location.create({ data: { organizationId: b.id, name: slug("b-loc") } });
    const db = forOrg(a.id);
    const name = slug("screen");

    let created = true;
    try {
      await db.screen.create({ data: { organizationId: a.id, name, locationId: bLocation.id } });
    } catch {
      created = false; // refused outright -- the stronger outcome
    }

    if (!created) {
      expect(await prisma.screen.count({ where: { name } })).toBe(0);
      return;
    }

    // Postgres lets referential-integrity checks bypass RLS, so the FK itself can
    // land. What must never happen is the other org's row coming back out.
    let leakedId: string | undefined;
    try {
      const rows = await db.screen.findMany({ where: { name }, include: { location: true } });
      leakedId = rows.map((r) => asRecord(r).location as { id?: string } | null).find((l) => l?.id)?.id;
    } catch {
      leakedId = undefined; // an inconsistent-result error is a refusal, not a leak
    }
    expect(leakedId).toBeUndefined();
  });

  it("(c) blocks connecting to another org's canvas", async () => {
    const { a, b } = await twoOrgs();
    const aLocation = await prisma.location.create({ data: { organizationId: a.id, name: slug("a-loc") } });
    const aScreen = await prisma.screen.create({
      data: { organizationId: a.id, name: slug("a-screen"), locationId: aLocation.id },
    });
    const bCanvas = await prisma.canvas.create({
      data: { organizationId: b.id, name: slug("b-canvas"), width: 1, height: 1 },
    });

    await expect(
      forOrg(a.id).screen.update({ where: { id: aScreen.id }, data: { canvas: { connect: { id: bCanvas.id } } } }),
    ).rejects.toThrow();

    const after = await prisma.screen.findUnique({ where: { id: aScreen.id } });
    expect(after?.canvasId).toBeNull();
  });
});

describe("every scoped operation is org-bound", () => {
  it("createMany stamps each row with the bound org", async () => {
    const { a } = await twoOrgs();
    const names = [slug("many-1"), slug("many-2")];

    await forOrg(a.id).location.createMany({ data: names.map(unowned) });

    expect(await prisma.location.count({ where: { organizationId: a.id, name: { in: names } } })).toBe(2);
  });

  it("groupBy only ever sees the bound org", async () => {
    const { a, b } = await twoOrgs();
    await prisma.location.create({ data: { organizationId: a.id, name: slug("a-row") } });
    await prisma.location.create({ data: { organizationId: b.id, name: slug("b-row") } });

    const groups = await forOrg(a.id).location.groupBy({ by: ["organizationId"], _count: { _all: true } });

    expect(groups.map((g) => g.organizationId)).toEqual([a.id]);
  });

  it("upsert cannot reach another org's row", async () => {
    const { a, b } = await twoOrgs();
    const bName = slug("b-row");
    const bRow = await prisma.location.create({ data: { organizationId: b.id, name: bName } });

    // Scoped to a, b's row is invisible, so this must insert for a rather than
    // update b's row.
    const result = await forOrg(a.id).location.upsert({
      where: { id: bRow.id },
      create: unowned(slug("upserted")),
      update: { name: "hijacked" },
    });

    expect(result.organizationId).toBe(a.id);
    expect((await prisma.location.findUnique({ where: { id: bRow.id } }))?.name).toBe(bName);
  });
});

describe("TENANT_MODELS", () => {
  it("is exactly the set of schema models carrying organizationId", () => {
    const schema = readFileSync("prisma/schema.prisma", "utf8");
    const declared = [...schema.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm)]
      .filter(([, , body]) => /^\s*organizationId\s+String/m.test(body))
      .map(([, name]) => name[0].toLowerCase() + name.slice(1));

    expect(declared.length).toBeGreaterThan(0);
    expect([...TENANT_MODELS].sort()).toEqual(declared.sort());
  });
});
