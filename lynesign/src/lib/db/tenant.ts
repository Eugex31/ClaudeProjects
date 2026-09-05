import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db/root";

/**
 * Tenant data access for LyneSign.
 *
 * Two independent layers guard every tenant read and write, and BOTH apply to
 * everything this module exposes -- `forOrg` is built on `withOrgTransaction`:
 *
 *  1. APP LAYER. A Prisma Client `$extends` query extension bound to one
 *     organization rewrites every operation on a tenant-scoped model:
 *     `organizationId` is merged into `where`, injected into `create` data, and
 *     any caller-supplied value naming a *different* organization is rejected
 *     outright rather than silently rewritten. Operations it does not know how
 *     to scope throw instead of running unscoped.
 *
 *  2. DATABASE LAYER. The work runs in one interactive transaction that first
 *     sets the RLS GUC `app.current_org`, so Postgres row-level security
 *     enforces the same boundary independently.
 *
 *     Layer 2 is not a nicety. Layer 1 only sees the top level of an operation's
 *     arguments, so a nested write (`data: { panels: { create: [...] } }`), a raw
 *     foreign key pointing at another org's row, and `connect: { id }` all slip
 *     past it. RLS `USING` / `WITH CHECK` is what actually stops them, which is
 *     why every path here carries the GUC.
 *
 *     The GUC is set transaction-locally and Postgres never restores it to NULL
 *     afterwards -- only to '' -- so the policy has to read '' as "no context".
 *     See migration 20260830032500_rls_empty_guc_is_unscoped; without it, every
 *     pooled connection that had carried tenant scope went permanently blind.
 *
 * `forOrg` is the everyday entry point (one transaction per call).
 * `withOrgTransaction` is for multi-step units of work and raw SQL.
 */

/** Every model carrying `organizationId` -- must match the RLS migration's ARRAY. */
export const TENANT_MODELS = [
  "membership",
  "invitation",
  "auditLog",
  "location",
  "screen",
  "canvas",
  "panel",
  "frame",
  "frameLocation",
  "content",
  "clock",
  "picture",
  "video",
  "youtube",
  "html",
  "web",
  "memo",
  "outlook",
  "report",
  "powerbi",
  "weather",
  "news",
  "subscription",
  "legacyIntegration",
  "mediaFolder",
  "mediaAsset",
  "playlist",
  "playlistItem",
  "campaign",
  "campaignScreen",
  "campaignLocation",
  "scheduleRule",
  "scheduleRuleScreen",
  "scheduleRuleLocation",
  "playbackEvent",
] as const;

export type TenantModel = (typeof TENANT_MODELS)[number];

/**
 * A Prisma client narrowed to the tenant-scoped models and bound to one org.
 * Non-tenant models (organization, user, plan, ...) are deliberately absent.
 *
 * The delegates keep their generated Prisma types verbatim, so `select`,
 * `include` and result inference all behave normally -- which also means create
 * inputs still ask for `organizationId`. Supplying it is redundant but harmless
 * (the guard checks it matches the bound org and rejects it otherwise); the
 * guard injects it at runtime when it is absent.
 */
export type TenantClient = Pick<PrismaClient, TenantModel>;

/** What `withOrgTransaction` hands its callback: the same models, plus raw SQL. */
export type TenantTransactionClient = TenantClient &
  Pick<PrismaClient, "$queryRaw" | "$queryRawUnsafe" | "$executeRaw" | "$executeRawUnsafe">;

/** Thrown when a caller names an organization other than the one it is bound to. */
export class CrossTenantError extends Error {
  constructor(message: string) {
    super(`cross-tenant access denied: ${message}`);
    this.name = "CrossTenantError";
  }
}

type Args = Record<string, unknown>;

/** Operations scoped by narrowing `where`. */
const WHERE_OPERATIONS = new Set([
  "findFirst",
  "findFirstOrThrow",
  "findMany",
  "findUnique",
  "findUniqueOrThrow",
  "count",
  "aggregate",
  "groupBy",
  "delete",
  "deleteMany",
]);

/** Operations scoped by narrowing `where` and vetting `data`. */
const WHERE_AND_DATA_OPERATIONS = new Set(["update", "updateMany", "updateManyAndReturn"]);

/** Operations scoped by injecting `organizationId` into `data`. */
const DATA_OPERATIONS = new Set(["create", "createMany", "createManyAndReturn"]);

function isPlainObject(value: unknown): value is Args {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Merge the org filter into a caller-supplied `where`. The caller's own
 * conditions survive -- `organizationId` is ANDed on top of them, never
 * substituted for them.
 */
function mergeWhere(where: unknown, organizationId: string, at: string): Args {
  if (where === undefined || where === null) return { organizationId };
  if (!isPlainObject(where)) throw new CrossTenantError(`${at}: "where" must be an object`);

  const supplied = where.organizationId;
  if (supplied !== undefined && supplied !== null && supplied !== organizationId) {
    throw new CrossTenantError(`${at}: filter names another organization`);
  }
  return { ...where, organizationId };
}

/** Reject a row that reaches for another org, then stamp it with the bound one. */
function injectRow(row: unknown, organizationId: string, at: string): Args {
  if (row !== undefined && row !== null && !isPlainObject(row)) {
    throw new CrossTenantError(`${at}: "data" must be an object`);
  }
  const data: Args = isPlainObject(row) ? row : {};

  if ("organization" in data) {
    // A nested relation write would set the owner behind the guard's back.
    throw new CrossTenantError(`${at}: set the owner via organizationId, not the "organization" relation`);
  }
  const supplied = data.organizationId;
  if (supplied !== undefined && supplied !== null && supplied !== organizationId) {
    throw new CrossTenantError(`${at}: writes another organization's row`);
  }
  return { ...data, organizationId };
}

function injectData(data: unknown, organizationId: string, at: string): unknown {
  if (Array.isArray(data)) return data.map((row) => injectRow(row, organizationId, at));
  return injectRow(data, organizationId, at);
}

/** An update may not move a row to another org (the `where` already scopes it). */
function guardUpdateData(data: unknown, organizationId: string, at: string): unknown {
  if (!isPlainObject(data)) return data;

  if ("organization" in data) {
    throw new CrossTenantError(`${at}: cannot reassign the "organization" relation`);
  }
  if ("organizationId" in data && data.organizationId !== undefined && data.organizationId !== null) {
    const value = data.organizationId;
    const next = isPlainObject(value) && "set" in value ? value.set : value;
    if (next !== organizationId) throw new CrossTenantError(`${at}: cannot move a row to another organization`);
  }
  return data;
}

/**
 * Rewrite one operation's arguments so it can only ever touch `organizationId`.
 * Unknown operations throw: an unrecognised Prisma operation must not slip
 * through unscoped.
 */
function scopeArgs(organizationId: string, model: string, operation: string, rawArgs: unknown): unknown {
  const at = `${model}.${operation}`;
  const args: Args = isPlainObject(rawArgs) ? rawArgs : {};

  if (operation === "upsert") {
    return {
      ...args,
      where: mergeWhere(args.where, organizationId, at),
      create: injectData(args.create, organizationId, at),
      update: guardUpdateData(args.update, organizationId, at),
    };
  }
  if (WHERE_OPERATIONS.has(operation)) {
    return { ...args, where: mergeWhere(args.where, organizationId, at) };
  }
  if (WHERE_AND_DATA_OPERATIONS.has(operation)) {
    return {
      ...args,
      where: mergeWhere(args.where, organizationId, at),
      data: guardUpdateData(args.data, organizationId, at),
    };
  }
  if (DATA_OPERATIONS.has(operation)) {
    return { ...args, data: injectData(args.data, organizationId, at) };
  }
  throw new CrossTenantError(`${at}: operation cannot be tenant-scoped; use withOrgTransaction with raw SQL`);
}

type OperationHook = (params: {
  model?: string;
  operation: string;
  args: unknown;
  query: (args: unknown) => Promise<unknown>;
}) => Promise<unknown>;

/** Build the `$extends` query extension that binds a client to one organization. */
function tenantScopeExtension(organizationId: string) {
  const query: Record<string, { $allOperations: OperationHook }> = {};
  for (const model of TENANT_MODELS) {
    query[model] = {
      $allOperations: ({ model: name, operation, args, query: run }) =>
        run(scopeArgs(organizationId, name ?? model, operation, args)),
    };
  }
  return { name: "tenantScope", query };
}

/** Every operation the guard knows how to scope. The facade refuses the rest. */
const SCOPED_OPERATIONS: ReadonlySet<string> = new Set([
  ...WHERE_OPERATIONS,
  ...WHERE_AND_DATA_OPERATIONS,
  ...DATA_OPERATIONS,
  "upsert",
]);

const TENANT_MODEL_NAMES: ReadonlySet<string> = new Set<string>(TENANT_MODELS);

// The extension only rewrites arguments; it adds and removes nothing, so the
// extended client is structurally the client it was built from.
type ScopedClient = PrismaClient;

function buildScopedClient(organizationId: string): ScopedClient {
  // Called as a method: `$extends` relies on its receiver, so it must not be detached.
  const client = prisma as unknown as { $extends(ext: unknown): ScopedClient };
  return client.$extends(tenantScopeExtension(organizationId));
}

/**
 * Keys the JavaScript runtime itself probes on any object -- `then` when a value
 * is awaited, `toString`/`constructor` when it is inspected. These must answer
 * normally instead of throwing, or the facade explodes on `await` and in logs.
 */
function isRuntimeProtocolKey(key: string): boolean {
  return key === "then" || key === "catch" || key === "finally" || key in Object.prototype;
}

type ModelOperations = Record<string, Record<string, (args: unknown) => Promise<unknown>>>;

/**
 * One model's operations, each running as its own tenant-scoped transaction.
 * Unknown operation names are refused rather than forwarded blind.
 */
function buildModelFacade(organizationId: string, model: TenantModel): unknown {
  const operations = new Map<string, unknown>();

  // A plain `{}` target on purpose: `toString`/`valueOf` must resolve through
  // Object.prototype, or inspecting the facade throws instead of printing.
  return new Proxy({} as Record<string, unknown>, {
    get(target, key) {
      if (typeof key === "symbol") return Reflect.get(target, key);
      if (isRuntimeProtocolKey(key)) return Reflect.get(target, key);
      if (!SCOPED_OPERATIONS.has(key)) {
        throw new CrossTenantError(
          `${model}.${key} is not a tenant-scoped operation; use withOrgTransaction for anything else`,
        );
      }

      const cached = operations.get(key);
      if (cached) return cached;

      const call = (args: unknown) =>
        withOrgTransaction(organizationId, (tx) => (tx as unknown as ModelOperations)[model][key](args));
      operations.set(key, call);
      return call;
    },
  });
}

/**
 * The object `forOrg` hands back: the tenant-scoped models and nothing else.
 *
 * This is an allow-list, not a cast over the real client. `$queryRawUnsafe`,
 * `$transaction`, `$extends` and every non-tenant delegate (`organization`,
 * `user`, `plan`) are unreachable -- asking for one throws rather than quietly
 * handing over an unscoped escape hatch.
 */
function buildFacade(organizationId: string): TenantClient {
  const models = new Map<string, unknown>();

  return new Proxy({} as Record<string, unknown>, {
    get(target, key) {
      if (typeof key === "symbol") return Reflect.get(target, key);
      if (isRuntimeProtocolKey(key)) return Reflect.get(target, key);
      if (!TENANT_MODEL_NAMES.has(key)) {
        throw new CrossTenantError(
          `"${key}" is not reachable from a tenant client: it exposes only the tenant-scoped models. ` +
            `Raw SQL, transactions and non-tenant models must go through withOrgTransaction or the root client.`,
        );
      }

      const cached = models.get(key);
      if (cached) return cached;

      const facade = buildModelFacade(organizationId, key as TenantModel);
      models.set(key, facade);
      return facade;
    },
    has: (_target, key) => typeof key === "string" && TENANT_MODEL_NAMES.has(key),
  }) as unknown as TenantClient;
}

type OrgBinding = { client: ScopedClient; facade: TenantClient };

// `$extends` allocates a client, so bind once per organization rather than once
// per request. Capped so a long-lived process cannot grow without bound.
const MAX_CACHED_BINDINGS = 256;
const bindings = new Map<string, OrgBinding>();

function bindingFor(organizationId: string): OrgBinding {
  const cached = bindings.get(organizationId);
  if (cached) return cached;

  const binding: OrgBinding = {
    client: buildScopedClient(organizationId),
    facade: buildFacade(organizationId),
  };
  if (bindings.size >= MAX_CACHED_BINDINGS) {
    const oldest = bindings.keys().next();
    if (!oldest.done) bindings.delete(oldest.value);
  }
  bindings.set(organizationId, binding);
  return binding;
}

/**
 * A Prisma-shaped facade bound to one organization, guarded by both layers.
 *
 * Every call runs as its own `withOrgTransaction`, so the argument rewriting of
 * layer 1 and the Postgres RLS of layer 2 both apply. The database backstop is
 * what makes this safe against payloads layer 1 cannot see into: nested writes
 * (`data: { panels: { create: [...] } }`), raw foreign keys pointing at another
 * org's row, and `connect` by id are all rewritten-past by the extension but
 * still caught by RLS `USING` / `WITH CHECK`.
 *
 * Two consequences of the per-call transaction, both deliberate:
 *
 *  - One connection checkout per call. For a multi-step unit of work call
 *    `withOrgTransaction` once instead of making several calls through here --
 *    that is both cheaper and atomic.
 *  - No fluent relation chaining (`.location(...)` off a result). The
 *    transaction has closed by the time you hold the value; use `include` or
 *    `select`, which run inside it.
 */
export function forOrg(organizationId: string): TenantClient {
  if (!organizationId) throw new Error("forOrg requires a non-empty organizationId");
  return bindingFor(organizationId).facade;
}

/**
 * Runs `fn` as one transaction with guard layer 1 applied *and* the RLS GUC
 * `app.current_org` set to `organizationId` for its lifetime, so Postgres
 * enforces the boundary too. Rolls back if `fn` throws.
 *
 * Unlike `forOrg`, the `tx` handed to `fn` exposes raw SQL -- legitimate here
 * precisely because RLS is active on that connection.
 *
 * WARNING: do not call `withOrgTransaction` (or `forOrg`, which is built on it)
 * from inside an enclosing `fn`. The inner call checks out a *second* pooled
 * connection and opens a *separate* transaction: it can block waiting on a pool
 * the outer transaction is holding, and its writes commit independently of the
 * outer one, so a later outer rollback leaves them behind. Pass `tx` down
 * instead.
 *
 * `options` is passed straight to Prisma's interactive-transaction options.
 * Omitted, Prisma's defaults apply (5s `timeout`, 2s `maxWait`); a bulk unit of
 * work such as the Display Monkey import raises `timeout` explicitly.
 */
export interface OrgTransactionOptions {
  /** Milliseconds the transaction may run before Prisma rolls it back. */
  timeout?: number;
  /** Milliseconds to wait for a connection before giving up. */
  maxWait?: number;
}

export async function withOrgTransaction<T>(
  organizationId: string,
  fn: (tx: TenantTransactionClient) => Promise<T>,
  options?: OrgTransactionOptions,
): Promise<T> {
  if (!organizationId) throw new Error("withOrgTransaction requires a non-empty organizationId");

  return bindingFor(organizationId).client.$transaction(async (tx) => {
    // Transaction-local (`is_local = true`): reverts when this transaction ends.
    await tx.$executeRawUnsafe(`SELECT set_config('app.current_org', $1, true)`, organizationId);
    return fn(tx as unknown as TenantTransactionClient);
  }, options);
}
