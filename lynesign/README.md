# LyneSign

Multi-tenant digital-signage SaaS. Next.js 16, Prisma 6, PostgreSQL, Auth.js v5.

This repository is the Foundation build: schema, multi-tenancy, auth, RBAC, the app shell,
and the Display Monkey migration path. See [`docs/architecture.md`](docs/architecture.md)
for the full picture.

## Prerequisites

- **Node 22** and npm.
- That is all. Local development does **not** need Docker. `npm run db:up` starts a real
  PostgreSQL 18 cluster in-process via `embedded-postgres` (data in `./.pgdata`, port
  5433). Docker is only used for production-parity via `docker-compose.yml`.

## Setup

```bash
cp .env.example .env
npm install
npm run generate-key
```

`npm run generate-key` prints a random 32-byte key. Run it twice (or reuse one value) and
set both `AUTH_SECRET` and `APP_ENCRYPTION_KEY` in `.env`. `APP_ENCRYPTION_KEY` is
required: the device-pairing tests read it from `.env`.

Then bring up the database and start the app:

```bash
npm run db:up        # start the local embedded Postgres cluster
npm run db:migrate   # apply migrations (prisma migrate dev)
npm run db:seed      # seed the 4 plans and the platform super admin
npm run dev          # Next.js on http://localhost:3000
```

In a second terminal, run the background worker (offline-screen sweep, invitation-email
queue):

```bash
npm run worker:dev
```

Stop the database with `npm run db:down` when you are done.

### Working on Media (optional)

The Media library needs an S3-compatible object store. `npm run storage:up` downloads a
MinIO binary on first run and starts it on http://localhost:9000 (data in `./.minio`, no
Docker); `npm run storage:down` stops it. The `STORAGE_*` keys in `.env.example` already
point at it. Skip this unless you are touching media features or running their tests.

## Testing

```bash
npm run test       # Vitest: unit and integration (against the local DB)
npm run test:e2e   # Playwright: core-journey and tenant-isolation suites
```

`npm run test:e2e` provisions a separate `lynesign_test` database, builds the app, and
runs it on port 3100. The unit suite runs against the dev `lynesign` database and resets
data between files.

The media integration tests and `npm run test:e2e` need MinIO running (`npm run
storage:up`); `pretest:e2e` starts it automatically for the e2e run.

Also available: `npm run lint`, `npm run typecheck`.

## Migrating from Display Monkey

```bash
npm run migrate:dm -- --mssql-url "<sql server connection string>"
# or, from a JSON dump:
npm run migrate:dm -- --fixture scripts/fixtures/displaymonkey.sample.json
```

The script maps and upserts one Display Monkey database into one organization, is
idempotent (every insert is keyed on `legacyId`), and prints a reconciliation report of
source versus destination row counts, exiting non-zero on any mismatch.

Before a real-data run, read the "Migration from Display Monkey" section of
[`docs/architecture.md`](docs/architecture.md). In particular: `scripts/dm/map.ts`'s
`FRAME_TYPE_BY_DM_INT` uses the simplified fixture convention and must be swapped for the
real Display Monkey `Template.FrameType` mapping. Imported users land with a synthetic,
undeliverable email address (Display Monkey has no email column), so the operator must
supply real addresses before a password-reset blast reaches anyone. Every screen must be
re-paired, and integration credentials must be re-entered.

## Deploying

See [`docs/architecture.md`](docs/architecture.md) and
[`docker-compose.yml`](docker-compose.yml). The topology is a `postgres` service, a
one-shot `migrate` service, the `web` server (Next.js standalone), and the `worker`
process. Every service connects as `lynesign_app`, the `LOGIN NOSUPERUSER` role that
`docker/postgres-init/01-app-role.sql` provisions on first bring-up: a superuser bypasses
row-level security, so this is load-bearing for tenant isolation, not a formality.
`AUTH_URL` must be the public `https://` origin. In production `db:seed` refuses to create
the platform super admin unless `SEED_SUPERADMIN_PASSWORD` is set.
