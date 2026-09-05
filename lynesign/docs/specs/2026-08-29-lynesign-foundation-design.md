# LyneSign Foundation — Design Spec

Date: 2026-08-29
Status: Approved for planning
Author: Eugenio Costa (with Claude)

---

## 1. Context

LyneSign is a modern, multi-tenant digital signage SaaS. It replaces **Display Monkey**
(v1.6.1, last updated January 2019), a legacy on-premise product built on .NET Framework
4.5.1 with two apps:

- **Management (DMM):** ASP.NET MVC 5, C#/Razor, Entity Framework 6 data-first
  (`DMModel.edmx`), Windows authentication (`deny users="?"`).
- **Presentation (DMP):** ASP.NET WebForms (`.aspx` / `.ashx` handlers), Forms auth,
  Prototype.js 1.7 canvas renderer.
- **Database:** SQL Server 2005+, ~27 tables, 4 stored procedures
  (`sp_GetDisplayData`, `sp_GetNextFrame`, `sp_RegisterDisplay`, `sp_GetLocationDetails`).
  No tenancy. `Users` table stores `Pwd varchar(25)` in plaintext.
- **Player protocol:** HTTP polling; screens identified by host IP; `sp_RegisterDisplay`
  auto-registers by IP address.

### What is preserved

Only the **domain model shape**, re-expressed in Prisma:

- `Canvas` -> `Panel` -> `Frame` -> `Content` (+ typed detail tables per content kind).
- Location hierarchy (currently `Level` -> `Location`).
- The player poll protocol concept (a screen asks the server what to show next).

### What is replaced

Framework, both UIs, authentication, and the flat single-tenant schema. Windows auth and
a plaintext-password table cannot be incrementally modernized into SaaS auth; this is a
rebuild, not a refactor.

### Decisions locked before this spec

- **Stack:** Next.js + TypeScript + Postgres + Prisma (matches the existing `mailpilot`
  project in this repo).
- **First increment:** full Foundation vertical slice (schema + migration + auth/RBAC +
  org/location hierarchy + design system + app shell + dashboard), wired and running.

---

## 2. Scope

### In scope for this increment

1. New `lynesign/` Next.js workspace mirroring `mailpilot` conventions.
2. Multi-tenant Postgres schema (Prisma) covering identity, tenancy, hierarchy, a
   lossless content skeleton, and a billing abstraction.
3. Tenant isolation enforcement (Prisma client extension + server-resolved org context +
   Postgres RLS).
4. Authentication (next-auth v5: credentials + email magic link, database sessions).
5. RBAC: 6 human roles + 1 machine `SCREEN` principal, one `can()` policy module.
6. Sign-up / sign-in / invite / org-switch flows.
7. Display Monkey data migration script.
8. LyneSign design system over shadcn/ui, WCAG 2.2 AA adjusted from `design.md`.
9. Responsive app shell (sidebar nav, org switcher, mobile sheet).
10. Dashboard with real metrics from Foundation tables.
11. Error handling, structured logging, audit log.
12. Test suites: unit (Vitest), e2e (Playwright), tenant-isolation.
13. Docker Compose (Postgres), `.env.example`, README, architecture doc.

### Explicitly out of scope (later increments, each its own spec)

- Increment 2: Screens/devices UX + player runtime app + pairing protocol hardening.
- Increment 3: Media library.
- Increment 4: Playlists + Canvas/layout editor.
- Increment 5: Scheduling.
- Increment 6: Campaigns / advertisers.
- Increment 7: Analytics.
- Increment 8: Billing (Stripe integration), platform admin console, notifications.

Content-skeleton tables (`Canvas`, `Panel`, `Frame`, `Content`, typed details) are
created now so the migration runs once, but they get no management UI in this increment.

---

## 3. Architecture

### 3.1 Runtime shape

- **Web app:** Next.js 16 App Router, React 19, server components + server actions for
  mutations, route handlers under `/api` for the player protocol and webhooks.
- **Database:** Postgres 16, accessed only through Prisma 6.
- **Worker:** a `tsx` long-running process (`src/worker/index.ts`) for background jobs
  (invitation emails, screen-offline sweeps, audit-log retention). Same pattern as
  `mailpilot`'s `worker:dev` script.
- **Local infra:** `docker-compose.yml` runs Postgres; app runs on the host in dev.

### 3.2 Directory layout

```
lynesign/
  docs/
    specs/                     # this file and future specs
    architecture.md            # produced by this increment
  prisma/
    schema.prisma
    migrations/
    seed.ts
  scripts/
    generate-encryption-key.ts
    migrate-displaymonkey.ts
  src/
    app/
      (marketing)/             # public: landing redirect, legal
      (auth)/                  # sign-in, sign-up, invite accept, reset
      (app)/                   # authenticated shell
        dashboard/
        screens/
        locations/
        media/                 # EmptyState "coming soon" this increment
        playlists/             # ditto
        campaigns/             # ditto
        schedule/              # ditto
        analytics/             # ditto
        users/
        billing/
        settings/
      api/
        auth/[...nextauth]/
        player/                # device-token protected
        health/
    components/
      ui/                      # shadcn primitives, restyled
      app/                     # EmptyState, ErrorState, ScreenCard, StatTile, Heading...
    lib/
      auth/                    # next-auth config, session helpers
      db/                      # prisma client + tenant extension
      rbac/                    # can(), role tables
      tenancy/                 # org resolution, RLS session GUC helpers
      logging/                 # pino wrapper
      plan-limits/             # PlanLimits service
      errors/                  # typed problem responses
    worker/
      index.ts
      jobs/
    test/
      unit/
      e2e/
      isolation/
```

### 3.3 Multi-tenancy

Single database, single schema, `organizationId` FK on every tenant-scoped table.
Three enforcement layers:

1. **Prisma client extension** (`lib/db`): wraps every model with a tenant guard. Queries
   on tenant-scoped models require an `orgContext` passed via `prisma.$extends` scoping
   or an explicit `where: { organizationId }`. A query that reaches the DB layer without
   a resolved org throws before execution. Fails closed.
2. **Server-resolved org context:** every server action and route handler calls
   `requireOrg()` which reads the active `organizationId` from the session (set at login
   and on org-switch). Client-supplied org IDs are never trusted; they are validated
   against the user's `Membership` rows.
3. **Postgres RLS:** tenant tables get `ENABLE ROW LEVEL SECURITY` plus a policy keyed on
   `current_setting('app.current_org', true)`. The Prisma extension sets that GUC per
   transaction. This is defense-in-depth for raw SQL and mistakes in layer 1.

`SUPER_ADMIN` operations use a separate unscoped Prisma client, only reachable from
`/app/settings` platform routes gated by the role.

### 3.4 Authentication

- **next-auth v5** with `@auth/prisma-adapter`, database session strategy.
- **Providers:** Credentials (email + bcrypt hash, `bcryptjs`), Email (magic link via the
  worker's mailer).
- **Sign-up:** one Prisma transaction creates `User`, `Organization`, and an `OWNER`
  `Membership`. New org gets a `Subscription` on the default `TRIAL` plan.
- **Invite:** `OWNER`/`ADMIN` creates an `Invitation` (email, role, token, expiry). Accept
  flow creates or links the `User` and adds a `Membership`.
- **Org switch:** sets `activeOrganizationId` on the session; re-checked against
  `Membership` on every request.
- **Migrated users:** imported disabled-for-password, `mustResetPassword = true`; first
  login requires the email magic link, then a password set.
- **Secrets:** `.env` only, `.env.example` committed, `AUTH_SECRET` and an app encryption
  key generated by `scripts/generate-encryption-key.ts`.

### 3.5 RBAC

Roles: `SUPER_ADMIN`, `OWNER`, `ADMIN`, `MANAGER`, `CONTENT_MANAGER`, `VIEWER`, and the
non-human `SCREEN` principal (authenticated by device token, not a session).

- One module: `lib/rbac/can.ts` exposing `can(actor, action, resource)`.
- Action/role matrix is a plain table (`lib/rbac/policy.ts`) so it is reviewable in one
  place and unit-testable.
- Server actions call `can()` before any mutation and throw a typed `ForbiddenError`
  otherwise. UI uses the same table to hide controls, but the server is the gate.
- `SCREEN` principal can only reach `/api/player/*` and only read content bound to its
  own `Screen` row.

### 3.6 Player protocol (skeleton only this increment)

- `POST /api/player/pair` — screen submits a pairing code shown in the UI; server returns
  a device token (opaque, hashed at rest) and the `screenId`.
- `GET /api/player/sync` — device-token auth; returns the screen's assigned canvas +
  poll interval + a content manifest. Stub payload this increment (real content
  assembly is increment 2/4).
- `POST /api/player/heartbeat` — updates `Screen.lastSeenAt` and `status`.
- Offline resilience (service worker, cached manifest) is designed in increment 2.

---

## 4. Data model

Prisma models grouped by concern. Field lists are the intended shape; exact column types
and indexes are finalized during implementation.

### 4.1 Identity and tenancy

- **User**: `id`, `email` (unique, citext), `name`, `hashedPassword?`, `emailVerified?`,
  `mustResetPassword` (bool), `isSuperAdmin` (bool), timestamps.
- **Organization**: `id`, `name`, `slug` (unique), `createdAt`, soft-delete `archivedAt?`.
- **Membership**: `id`, `userId`, `organizationId`, `role` (enum), `createdAt`.
  Unique on (`userId`, `organizationId`).
- **Invitation**: `id`, `organizationId`, `email`, `role`, `token` (unique), `expiresAt`,
  `acceptedAt?`, `invitedByUserId`.
- **Account**, **Session**, **VerificationToken**: next-auth adapter tables.
- **AuditLog**: `id`, `organizationId?`, `actorType` (`USER` | `SCREEN` | `SYSTEM`),
  `actorId?`, `action`, `targetType`, `targetId?`, `metadata` (jsonb), `createdAt`.
  Indexed on (`organizationId`, `createdAt`).

### 4.2 Hierarchy

- **Location**: `id`, `organizationId`, `parentId?` (self-ref, replaces flat
  `Level`->`Location`), `name`, `addressLine1?`, `addressLine2?`, `city?`, `region?`,
  `postalCode?`, `countryCode?`, `latitude?`, `longitude?`, `timeZone`, `locale`,
  `temperatureUnit?`, timestamps.
- **Screen** (was `Display`): `id`, `organizationId`, `locationId`, `name`,
  `pairingCode?` (short, unique while pending), `deviceTokenHash?`, `status`
  (`UNPAIRED` | `ONLINE` | `OFFLINE` | `DISABLED`), `lastSeenAt?`, `canvasId?`,
  `pollIntervalSeconds` (default 60), `orientation?`, `notes?`, timestamps.

### 4.3 Content skeleton (carried, no UI this increment)

- **Canvas**: `id`, `organizationId`, `name`, `width`, `height`, `backgroundColor?`,
  `backgroundImageId?`, timestamps.
- **Panel**: `id`, `canvasId`, `name?`, `x`, `y`, `width`, `height`, `zIndex`,
  `noScroll` (bool).
- **Frame**: `id`, `panelId`, `sortOrder`, `durationSeconds`, `type` (enum mirroring the
  Display Monkey content kinds: `CLOCK`, `PICTURE`, `VIDEO`, `YOUTUBE`, `HTML`, `MEMO`,
  `OUTLOOK`, `REPORT`, `POWERBI`, `WEATHER`, `NEWS`), `locationScoped` (bool),
  timestamps.
- **FrameLocation**: `frameId`, `locationId` (join, preserves per-location targeting).
- **Content** and per-type detail tables (`Clock`, `Picture`, `Video`, `Youtube`,
  `Html`, `Memo`, `Outlook`, `Report`, `Powerbi`, `Weather`, `News`): fields copied
  structurally from the Display Monkey schema so migration is lossless. Not surfaced in
  the UI this increment; validated only by the migration script and a round-trip test.

### 4.4 Billing abstraction (shape only, no Stripe calls)

- **Plan**: `id`, `key` (`TRIAL` | `STARTER` | `GROWTH` | `ENTERPRISE`), `name`,
  `maxScreens?`, `maxStorageBytes?`, `maxUsers?`, `maxLocations?`, `features` (jsonb),
  `isPublic` (bool).
- **Subscription**: `id`, `organizationId` (unique), `planId`, `status`
  (`TRIALING` | `ACTIVE` | `PAST_DUE` | `CANCELED`), `trialEndsAt?`,
  `stripeCustomerId?`, `stripeSubscriptionId?`, timestamps.
- **PlanLimits service** (`lib/plan-limits`): `assertCanAddScreen(org)`,
  `assertCanAddUser(org)`, `assertCanAddLocation(org)`, `getStorageUsage(org)`. Throws a
  typed `PlanLimitError` the UI renders as an upgrade prompt.

### 4.5 Tenant-scoped models (carry `organizationId`, covered by RLS)

`Membership`, `Invitation`, `AuditLog` (nullable), `Location`, `Screen`, `Canvas`,
`Subscription` carry `organizationId` directly. `Panel`, `Frame`, `FrameLocation`,
`Content`, and the typed detail tables also carry a denormalized `organizationId`
(copied from their parent `Canvas` on write) so a single RLS policy shape applies to
every tenant table without joins. `User`, `Plan`, and next-auth tables are global.

---

## 5. Migration from Display Monkey

`scripts/migrate-displaymonkey.ts`, run manually by an operator.

### Inputs

- A connection string to a live Display Monkey SQL Server database, or a restored dump.
- Target: the LyneSign Postgres database.
- A `--org-name` flag (default `"Imported"`).

### Behavior

1. Create one `Organization` (or reuse by slug if re-run) and a `Subscription` on
   `ENTERPRISE` (so the import is never blocked by plan limits).
2. Map `Level` + `Location` -> `Location` tree: each `Level` becomes a parent
   `Location`, its child `Location` rows become children.
3. `Display` -> `Screen`: `Host` is dropped (IP-based identity is not carried);
   `status = UNPAIRED`; `pollInterval` carried; each imported screen needs re-pairing.
4. `Canvas` / `Panel` / `Frame` / `FrameLocation` / `Content` + typed tables copied
   field-for-field. Enum values mapped from the old integer `Type` columns.
5. `Users` -> `User` + `Membership`: `userRole` mapped to the nearest LyneSign role
   (`admin`->`ADMIN`, else `VIEWER`), `hashedPassword = null`,
   `mustResetPassword = true`. Old plaintext passwords are discarded.
6. Integration accounts (`AzureAccount`, `ExchangeAccount`, `OauthAccount`,
   `ReportServer`): copied into a `LegacyIntegration` holding table (jsonb blob) for a
   later increment; secrets re-encrypted with the new app key, not left in plaintext.
7. Write an `AuditLog` entry per table with source and destination row counts;
   print a reconciliation report; exit non-zero on any mismatch.

### Idempotency

Keyed on a `legacyId` column added to each migrated table. Re-running updates rather than
duplicates.

### Manual follow-up (documented in `docs/architecture.md`)

- Operator triggers a password-reset email blast to imported users.
- Operator re-pairs each physical screen (new pairing code per screen).
- Integration credentials reviewed and re-entered when increments 4/6 land.

---

## 6. Design system

Source: `design.md`. Adjusted for application use and WCAG 2.2 AA.

### 6.1 Tokens

| Token | Value | Role |
|---|---|---|
| `--ls-navy` | `#1B2A45` | Primary action fill, headings, dark surfaces |
| `--ls-navy-dark` | `#16223A` | Deep surfaces, sidebar |
| `--ls-tan` | `#D9A468` | Accent, focus ring, data-viz, highlight only |
| `--ls-tan-hover` | `#C68A4A` | Tan hover state |
| `--ls-gray-body` | `#6B7280` | Body copy |
| `--ls-gray-border` | `#E5E7EB` | Borders, dividers |
| `--ls-white` | `#FFFFFF` | Page/card background (light) |

**Contrast decision:** `design.md` specifies white text on tan (`#D9A468`) for primary
buttons. That is ~1.9:1 and fails AA. In-app, **primary action = navy** (white on navy
is ~13:1). Tan is used for accents, focus rings, chart series, and status highlights, and
only ever paired with navy text when used as a fill. The marketing site is unchanged.

Dark mode: navy-dark surfaces, off-white text, tan accent unchanged; every token gets a
dark value. Managed by `next-themes`.

### 6.2 Typography

- Display: Poppins (600/700), loaded via `next/font/google`.
- Body: Inter (400/500/600).
- `<Heading>` component renders the brand two-tone pattern: a navy lead phrase plus one
  tan accent word, with an accessible single accessible name.

### 6.3 Shape and spacing

- 8px grid.
- Radius: buttons 6px (soft rectangle, not pill), cards 8px, inputs 6px, large panels
  16px.
- Container max-width 1200px for marketing-style pages; app content is fluid with a
  1440px cap.

### 6.4 Components

Restyled over shadcn/ui (Radix under the hood, so keyboard + ARIA come for free):
Button, Input, Textarea, Select, Checkbox, RadioGroup, Switch, Dialog, Sheet,
DropdownMenu, Tabs, Tooltip, Table, Card, Badge, Alert, Toast (sonner), Skeleton.

App-specific (in `components/app`): `Heading`, `EmptyState`, `LoadingState`,
`ErrorState`, `StatusDot` (screen health), `ScreenCard`, `StatTile`, `PageHeader`,
`OrgSwitcher`, `NavSidebar`, `DataTable` (sortable + paginated wrapper).

No one-off components: a new visual element is added to the system first.

### 6.5 Accessibility baseline

Keyboard reachable for every interactive element, visible focus ring (tan, 2px offset),
semantic landmarks, form labels + `aria-describedby` error text, dialogs trap focus and
restore it, color is never the only signal (status uses dot + label). Target WCAG 2.2 AA.

---

## 7. App shell and dashboard

### 7.1 Shell

- Left sidebar (desktop) / top bar + slide-in `Sheet` (mobile).
- Nav items: Dashboard, Screens, Locations, Media, Playlists, Campaigns, Schedule,
  Analytics, Users, Billing, Settings.
- Items the active role cannot access are hidden (checked via the RBAC table).
- Header: org switcher, notifications bell (static this increment), user menu.
- Later-increment routes (Media, Playlists, Campaigns, Schedule, Analytics) render an
  `EmptyState` that says what the section will do and when, never a 404 or blank page.

### 7.2 Dashboard

Cards, each reading real data from Foundation tables:

- Screens: total / online / offline (from `Screen.status`, `lastSeenAt`).
- Locations count.
- Users count (active memberships).
- Storage used vs. plan limit (`PlanLimits.getStorageUsage`, 0 until media lands).
- Recent activity: last 10 `AuditLog` rows for the org.
- Quick actions: Add Screen, Add Location, Invite User (the three things that work now).

Empty org: a guided onboarding checklist (create location -> add screen -> invite team)
instead of zeroed cards.

---

## 8. Error handling and observability

- **Typed errors** (`lib/errors`): `ValidationError`, `ForbiddenError`, `NotFoundError`,
  `PlanLimitError`, `ConflictError`. Route handlers serialize them as RFC-7807-style
  problem JSON; server actions throw and a shared boundary maps them.
- **Client:** an `ErrorState` component with a plain-language message and Try Again /
  Contact Support actions. No raw status codes or stack traces shown to users.
- **Logging:** `pino` wrapper (`lib/logging`) with a per-request id; logs mutations,
  auth events, player sync/heartbeat, and job runs.
- **Audit:** every mutation writes an `AuditLog` row (actor, action, target, org).
- **Error boundaries:** one per route segment under `(app)`.
- **Health:** `GET /api/health` checks DB connectivity for infra probes.

---

## 9. Testing

| Layer | Tool | Coverage |
|---|---|---|
| Unit | Vitest | `can()` policy matrix, `PlanLimits`, Prisma tenant extension (rejects unscoped queries), error serialization, migration mappers |
| Integration | Vitest + disposable Postgres | sign-up transaction, invite/accept, org-switch re-check, RLS policy behavior |
| E2E | Playwright | sign up -> create org -> add location -> add screen -> see it on the dashboard; invite a user; switch orgs |
| Isolation | Vitest + Playwright | org A cannot read/write org B via server action, route handler, or raw query; `SCREEN` token scoped to its own screen |
| CI | GitHub Actions | lint + typecheck + unit + integration + e2e against a service Postgres |

Definition of done for the increment: all suites green, `docker compose up` +
`npm run dev` yields a working app, migration script runs against a sample Display Monkey
dump with a clean reconciliation report.

---

## 10. Deliverables

1. `lynesign/` Next.js workspace, running locally.
2. `prisma/schema.prisma` + initial migration + `seed.ts` (plans, a demo org, a
   super-admin).
3. `scripts/migrate-displaymonkey.ts` + `scripts/generate-encryption-key.ts`.
4. Design system components in `src/components`.
5. Auth flows, app shell, dashboard.
6. Test suites + CI workflow.
7. `docs/architecture.md`: architecture overview, data model, auth model, authorization
   model, multi-tenancy model, env vars, deployment requirements, migration instructions
   (what was preserved / changed / migrated / needs manual action).
8. `README.md`: local setup.

---

## 11. Environment variables

| Var | Purpose |
|---|---|
| `DATABASE_URL` | Postgres connection |
| `AUTH_SECRET` | next-auth session signing |
| `AUTH_URL` | canonical app URL |
| `APP_ENCRYPTION_KEY` | at-rest encryption for integration secrets and device tokens |
| `EMAIL_SERVER` / `EMAIL_FROM` | magic-link + invitation mail |
| `DISPLAYMONKEY_MSSQL_URL` | migration script source (operator-supplied, not in app runtime) |

`.env.example` committed with every key present and empty or safe-default values.

---

## 12. Risks and open questions

- **Exact brand hex values:** `design.md` values are estimated from screenshots.
  `lynesign-landing_OLD.html` and lynesign.com should be sampled to confirm before the
  design system is frozen. Non-blocking; tokens live in one file.
- **Display Monkey source access:** the migration script is written against the
  documented schema. It needs a real dump or live DB to validate the reconciliation
  report. If none is available this session, the script ships with a synthetic fixture
  and is marked "validated against fixture, pending real-data run".
- **Player protocol depth:** only the pairing + heartbeat + stub-sync endpoints land now.
  Full content assembly and offline caching are increment 2/4 and may reshape
  `/api/player/sync`.
- **next-auth v5 is beta** (as in `mailpilot`). Acceptable for consistency across this
  repo; pinned to the same version `mailpilot` uses.
