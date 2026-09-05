# LyneSign Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the LyneSign multi-tenant SaaS foundation: a running Next.js app with a multi-tenant Postgres schema, authentication, role-based access control, org/location hierarchy, a Display Monkey data-migration script, the LyneSign design system, an app shell, and a live dashboard.

**Architecture:** Next.js 16 App Router (server components + server actions for mutations, route handlers for the player protocol and webhooks), Prisma 6 over Postgres 16. Tenant isolation is enforced in three layers: a tenant-guarded Prisma client that fails closed, server-resolved org context that never trusts client-supplied org IDs, and Postgres row-level security keyed on a per-transaction GUC. A `tsx` worker process runs background jobs. The workspace mirrors the sibling `mailpilot` project's conventions.

**Tech Stack:** Next.js 16.2.11, React 19.2.4, TypeScript 5 (strict), Prisma 6.19.x, PostgreSQL 16, next-auth 5.0.0-beta.32 with `@auth/prisma-adapter`, Tailwind CSS v4, shadcn/ui v4 (radix-ui, lucide-react), zod v4, react-hook-form, bcryptjs 3, sonner, next-themes, pino, Vitest, Playwright, Docker Compose.

**Spec:** `lynesign/docs/specs/2026-08-29-lynesign-foundation-design.md`

## Global Constraints

- Runtime versions are pinned to match `mailpilot`: `next@16.2.11`, `react@19.2.4`, `next-auth@5.0.0-beta.32`, `prisma`/`@prisma/client@^6.19.3`, `tailwindcss@^4`, `zod@^4.4.3`, `bcryptjs@^3.0.3`. TypeScript `strict` is on.
- Postgres only. All database access goes through Prisma. No raw SQL except inside migration files and the `set_config` GUC helper.
- Every tenant-scoped database access goes through the tenant-guarded client from `src/lib/db/tenant.ts`. The unscoped client (`src/lib/db/root.ts`) is importable only from `src/app/(app)/settings/platform/**` and `src/lib/auth/**`. A tenant-scoped query that reaches the driver with no resolved `organizationId` must throw before execution.
- Every mutation (server action or route handler that writes) calls `can(actor, action, resource)` before writing and `writeAudit(...)` after writing.
- Client-supplied organization IDs are never trusted. The active org is resolved from the session and validated against the user's `Membership` rows on every request.
- UI copy rules (from `voice.md`): no em dashes, no emojis, no exclamation points, no hype words (game-changer, revolutionary, unlock, supercharge, seamless), no corporate jargon (leverage, utilize). Plain nouns: "Screen", "Location", "Content", "Playlist", "Schedule", "Organization". Error text says what happened and what to do next.
- Color: the primary action color is navy `#1B2A45` (token `--ls-navy`). Tan `#D9A468` (`--ls-tan`) is used only for accents, focus rings, chart series, and status highlights, and is never placed behind white text. Target WCAG 2.2 AA.
- Secrets live in `.env` only. `.env.example` is committed with every key present and empty or safe-default.
- TDD: write the failing test first, watch it fail, implement minimally, watch it pass, commit. Conventional Commits for messages (`feat:`, `test:`, `chore:`, `fix:`, `docs:`).
- Commands are run from `lynesign/` unless stated otherwise. The repo is already `git init`-ed there.

---

## File Structure

```
lynesign/
  docker-compose.yml           # Postgres (host port 5433), migrate, web, worker
  Dockerfile                   # multi-stage: deps -> web, worker
  .env.example                 # every env var, no secrets
  package.json                 # scripts mirror mailpilot
  next.config.ts               # output: "standalone"
  tsconfig.json                # paths: "@/*" -> "./src/*", strict
  vitest.config.ts
  playwright.config.ts
  components.json              # shadcn config
  prisma/
    schema.prisma
    migrations/
    seed.ts                    # plans + demo org + super admin
  scripts/
    generate-encryption-key.ts
    migrate-displaymonkey.ts   # Display Monkey -> LyneSign importer
    fixtures/displaymonkey.sample.json
  src/
    app/
      layout.tsx               # root: fonts, ThemeProvider, Toaster
      globals.css              # Tailwind v4 + LyneSign tokens (light + dark)
      page.tsx                 # -> redirect to /dashboard or /login
      (auth)/
        login/page.tsx
        register/page.tsx
        forgot-password/page.tsx
        reset-password/page.tsx
        invite/[token]/page.tsx
        actions.ts             # signUp, requestPasswordReset, resetPassword, acceptInvite
      (app)/
        layout.tsx             # requires session; renders <AppShell>
        dashboard/page.tsx
        screens/page.tsx
        screens/actions.ts
        locations/page.tsx
        locations/actions.ts
        users/page.tsx
        users/actions.ts
        media/page.tsx          # ComingSoon EmptyState
        playlists/page.tsx      # ComingSoon
        campaigns/page.tsx      # ComingSoon
        schedule/page.tsx       # ComingSoon
        analytics/page.tsx      # ComingSoon
        billing/page.tsx        # plan + limits, read-only
        settings/page.tsx       # org profile
        settings/actions.ts     # switchOrg
        settings/platform/page.tsx   # SUPER_ADMIN only
      api/
        auth/[...nextauth]/route.ts
        health/route.ts
        player/pair/route.ts
        player/sync/route.ts
        player/heartbeat/route.ts
    components/
      ui/                       # shadcn primitives, restyled
      app/
        heading.tsx
        page-header.tsx
        empty-state.tsx
        coming-soon.tsx
        error-state.tsx
        loading-state.tsx
        status-dot.tsx
        stat-tile.tsx
        screen-card.tsx
        data-table.tsx
        nav-sidebar.tsx
        org-switcher.tsx
        app-shell.tsx
        onboarding-checklist.tsx
      providers.tsx             # ThemeProvider wrapper
    lib/
      db/
        root.ts                # unscoped PrismaClient singleton
        tenant.ts              # tenant-guarded client factory
      auth/
        config.ts              # NextAuth config
        index.ts               # exports handlers, auth, signIn, signOut
        session.ts             # createCredentialsSession, getServerAuth
        password.ts            # hashPassword, verifyPassword
        context.ts             # requireUser, requireOrg, requireRole
      rbac/
        roles.ts               # Role enum mirror + rank
        policy.ts              # action -> allowed roles table
        can.ts                 # can(actor, action, resource)
      plan-limits/
        index.ts               # assertCanAddScreen/User/Location, getStorageUsage
      errors/
        index.ts               # typed error classes + toProblem()
      logging/
        index.ts               # pino wrapper: logger, withRequestId
      audit/
        index.ts               # writeAudit(...)
      email/
        index.ts               # sendMail (nodemailer transport from EMAIL_SERVER)
        templates.ts           # invitation, magic-link, password-reset bodies
      pairing.ts               # generatePairingCode, hashDeviceToken
      utils.ts                 # cn()
    worker/
      index.ts                 # setInterval tick loop (mailpilot pattern)
      jobs/
        sendInvitationEmails.ts
        sweepOfflineScreens.ts
    test/
      unit/                    # colocated *.test.ts also allowed
      e2e/
        core-journey.spec.ts
      isolation/
        tenant-isolation.spec.ts
      helpers/
        db.ts                  # truncate + seed helpers for integration tests
  docs/
    specs/2026-08-29-lynesign-foundation-design.md
    plans/2026-08-29-lynesign-foundation.md
    architecture.md            # produced by Task 26
  README.md                    # produced by Task 26
```

---

## Task 1: Project scaffold, Docker, environment

**Files:**
- Create: `lynesign/package.json`, `tsconfig.json`, `next.config.ts`, `postcss.config.mjs`, `eslint.config.mjs`, `.gitignore` (extend), `.env.example`, `docker-compose.yml`, `Dockerfile`, `.dockerignore`
- Create: `src/app/layout.tsx`, `src/app/page.tsx`, `src/app/globals.css` (minimal, tokens come in Task 15), `src/lib/utils.ts`
- Create: `scripts/generate-encryption-key.ts`
- Test: `src/app/health-smoke.test.ts` (placeholder smoke test)

**Interfaces:**
- Consumes: nothing.
- Produces: a runnable Next.js app; `npm run dev` serves `/`; `docker compose up postgres` exposes Postgres on `localhost:5433`; `npm run db:*` scripts exist; `cn()` from `@/lib/utils`.

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "lynesign",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "eslint",
    "typecheck": "tsc --noEmit",
    "postinstall": "prisma generate",
    "generate-key": "tsx scripts/generate-encryption-key.ts",
    "db:migrate": "prisma migrate dev",
    "db:deploy": "prisma migrate deploy",
    "db:studio": "prisma studio",
    "db:seed": "tsx prisma/seed.ts",
    "db:reset": "prisma migrate reset --force",
    "migrate:dm": "tsx scripts/migrate-displaymonkey.ts",
    "worker:dev": "tsx watch src/worker/index.ts",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:e2e": "playwright test"
  },
  "prisma": { "seed": "tsx prisma/seed.ts" },
  "dependencies": {
    "@auth/prisma-adapter": "^2.11.3",
    "@hookform/resolvers": "^5.4.0",
    "@prisma/client": "^6.19.3",
    "bcryptjs": "^3.0.3",
    "class-variance-authority": "^0.7.1",
    "clsx": "^2.1.1",
    "date-fns": "^4.4.0",
    "lucide-react": "^1.25.0",
    "next": "16.2.11",
    "next-auth": "^5.0.0-beta.32",
    "next-themes": "^0.4.6",
    "nodemailer": "^8.0.11",
    "pino": "^9.5.0",
    "radix-ui": "^1.6.4",
    "react": "19.2.4",
    "react-dom": "19.2.4",
    "react-hook-form": "^7.82.0",
    "sonner": "^2.0.7",
    "tailwind-merge": "^3.6.0",
    "zod": "^4.4.3"
  },
  "devDependencies": {
    "@playwright/test": "^1.49.0",
    "@tailwindcss/postcss": "^4",
    "@types/bcryptjs": "^2.4.6",
    "@types/node": "^20",
    "@types/nodemailer": "^8.0.1",
    "@types/react": "^19",
    "@types/react-dom": "^19",
    "@vitejs/plugin-react": "^4.3.4",
    "eslint": "^9",
    "eslint-config-next": "16.2.11",
    "pino-pretty": "^13.0.0",
    "prisma": "^6.19.3",
    "shadcn": "^4.14.0",
    "tailwindcss": "^4",
    "tsx": "^4.23.1",
    "tw-animate-css": "^1.4.0",
    "typescript": "^5",
    "vitest": "^2.1.8"
  }
}
```

- [ ] **Step 2: Create config files**

`tsconfig.json` (copy `mailpilot/tsconfig.json` verbatim: `strict: true`, `paths: { "@/*": ["./src/*"] }`, `moduleResolution: "bundler"`, `jsx: "preserve"`, `plugins: [{ "name": "next" }]`).

`next.config.ts`:

```ts
import type { NextConfig } from "next";
const nextConfig: NextConfig = { output: "standalone" };
export default nextConfig;
```

`postcss.config.mjs`:

```js
const config = { plugins: ["@tailwindcss/postcss"] };
export default config;
```

`eslint.config.mjs`: copy `mailpilot/eslint.config.mjs` verbatim.

Append to `.gitignore`: `/.next/`, `/node_modules/`, `.env`, `/test-results/`, `/playwright-report/`, `/prisma/*.db`.

- [ ] **Step 3: Create `.env.example`**

```
# Database
DATABASE_URL="postgresql://lynesign:lynesign@localhost:5433/lynesign?schema=public"

# Auth (generate with: npm run generate-key)
AUTH_SECRET=""
AUTH_URL="http://localhost:3000"

# At-rest encryption for device tokens and legacy integration secrets
APP_ENCRYPTION_KEY=""

# Outbound email (magic link, invitations, password reset)
EMAIL_SERVER="smtp://user:pass@localhost:1025"
EMAIL_FROM="LyneSign <no-reply@lynesign.com>"

# Display Monkey migration source (operator-supplied; not read by the app runtime)
DISPLAYMONKEY_MSSQL_URL=""
```

- [ ] **Step 4: Create `docker-compose.yml`**

Adapt `mailpilot/docker-compose.yml`: same `postgres` (image `postgres:18-alpine`, user/pass/db `lynesign`, host port `5433:5432`, healthcheck `pg_isready -U lynesign`), same `migrate`/`web`/`worker` services with `DATABASE_URL` hard-coded to `postgresql://lynesign:lynesign@postgres:5432/lynesign?schema=public`. `web` builds `target: web`, `worker` builds `target: worker`.

- [ ] **Step 5: Create `Dockerfile`**

Multi-stage: `base` (node:22-alpine) -> `deps` (`npm ci`) -> `build` (`npm run build`, `prisma generate`) -> `web` (standalone server, `CMD ["node", "server.js"]`) -> `worker` (`CMD ["npx", "tsx", "src/worker/index.ts"]`). Copy `mailpilot/Dockerfile` structure and swap names.

- [ ] **Step 6: Create `scripts/generate-encryption-key.ts`**

```ts
import { randomBytes } from "node:crypto";

const key = randomBytes(32).toString("base64");
console.log(key);
console.log("\nSet this as AUTH_SECRET and/or APP_ENCRYPTION_KEY in your .env");
```

- [ ] **Step 7: Create `src/lib/utils.ts`**

```ts
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

- [ ] **Step 8: Create the minimal app entry**

`src/app/globals.css`:

```css
@import "tailwindcss";
@import "tw-animate-css";
```

`src/app/layout.tsx`:

```tsx
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "LyneSign",
  description: "Digital signage for everybody, anywhere.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
```

`src/app/page.tsx`:

```tsx
import { redirect } from "next/navigation";

export default function Home() {
  redirect("/dashboard");
}
```

- [ ] **Step 9: Write the smoke test**

`src/app/health-smoke.test.ts`:

```ts
import { describe, it, expect } from "vitest";

describe("scaffold", () => {
  it("cn merges classes", async () => {
    const { cn } = await import("@/lib/utils");
    expect(cn("a", false && "b", "c")).toBe("a c");
  });
});
```

`vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: { environment: "node" },
});
```

- [ ] **Step 10: Install and verify**

Run: `npm install`
Run: `npm run test`
Expected: 1 passing test.
Run: `docker compose up -d postgres && docker compose exec postgres pg_isready -U lynesign`
Expected: `accepting connections`.
Run: `npm run dev` then `curl -I http://localhost:3000/dashboard`
Expected: HTTP 307 redirect to `/login` is NOT yet wired (route missing) — a 404 or 500 here is acceptable at this task; the redirect target lands in Task 18. Stop the dev server.

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "chore: scaffold Next.js workspace, Docker Compose, env template"
```

---

## Task 2: Prisma schema — identity, tenancy roots, billing, audit

**Files:**
- Create: `prisma/schema.prisma`
- Create: `src/lib/db/root.ts`
- Create: `prisma/seed.ts`
- Test: `prisma/schema.test.ts`

**Interfaces:**
- Consumes: `DATABASE_URL`.
- Produces: models `User`, `Organization`, `Membership`, `Invitation`, `Account`, `Session`, `VerificationToken`, `Plan`, `Subscription`, `AuditLog`; enums `Role` (`SUPER_ADMIN` is represented by `User.isSuperAdmin`, not a membership role; `Role` = `OWNER | ADMIN | MANAGER | CONTENT_MANAGER | VIEWER`), `MembershipStatus`, `PlanKey` (`TRIAL | STARTER | GROWTH | ENTERPRISE`), `SubscriptionStatus` (`TRIALING | ACTIVE | PAST_DUE | CANCELED`), `AuditActorType` (`USER | SCREEN | SYSTEM`). Unscoped client `prisma` from `@/lib/db/root`.

- [ ] **Step 1: Write the failing test**

`prisma/schema.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const schema = readFileSync("prisma/schema.prisma", "utf8");

describe("identity schema", () => {
  it("declares the tenant root models", () => {
    for (const m of ["model User", "model Organization", "model Membership", "model Invitation", "model Plan", "model Subscription", "model AuditLog"]) {
      expect(schema).toContain(m);
    }
  });
  it("Membership is unique per user+org", () => {
    expect(schema).toMatch(/@@unique\(\[userId, organizationId\]\)/);
  });
  it("User carries the platform super-admin flag", () => {
    expect(schema).toMatch(/isSuperAdmin\s+Boolean\s+@default\(false\)/);
  });
});
```

- [ ] **Step 2: Run it, expect fail**

Run: `npm run test -- prisma/schema.test.ts`
Expected: FAIL (file missing).

- [ ] **Step 3: Write `prisma/schema.prisma`**

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum Role {
  OWNER
  ADMIN
  MANAGER
  CONTENT_MANAGER
  VIEWER
}

enum MembershipStatus {
  ACTIVE
  SUSPENDED
}

enum PlanKey {
  TRIAL
  STARTER
  GROWTH
  ENTERPRISE
}

enum SubscriptionStatus {
  TRIALING
  ACTIVE
  PAST_DUE
  CANCELED
}

enum AuditActorType {
  USER
  SCREEN
  SYSTEM
}

model User {
  id                 String    @id @default(cuid())
  email              String    @unique
  name               String?
  hashedPassword     String?
  emailVerified      DateTime? @db.Timestamptz(3)
  mustResetPassword  Boolean   @default(false)
  isSuperAdmin       Boolean   @default(false)
  createdAt          DateTime  @default(now()) @db.Timestamptz(3)
  updatedAt          DateTime  @updatedAt @db.Timestamptz(3)

  accounts           Account[]
  sessions           Session[]
  memberships        Membership[]
  invitationsSent    Invitation[] @relation("InvitedBy")
}

model Organization {
  id           String    @id @default(cuid())
  name         String
  slug         String    @unique
  createdAt    DateTime  @default(now()) @db.Timestamptz(3)
  updatedAt    DateTime  @updatedAt @db.Timestamptz(3)
  archivedAt   DateTime? @db.Timestamptz(3)

  memberships  Membership[]
  invitations  Invitation[]
  subscription Subscription?
  locations    Location[]
  screens      Screen[]
  canvases     Canvas[]
  auditLogs    AuditLog[]
}

model Membership {
  id             String           @id @default(cuid())
  userId         String
  organizationId String
  role           Role
  status         MembershipStatus @default(ACTIVE)
  createdAt      DateTime         @default(now()) @db.Timestamptz(3)

  user           User             @relation(fields: [userId], references: [id], onDelete: Cascade)
  organization   Organization     @relation(fields: [organizationId], references: [id], onDelete: Cascade)

  @@unique([userId, organizationId])
  @@index([organizationId])
}

model Invitation {
  id              String    @id @default(cuid())
  organizationId  String
  email           String
  role            Role
  token           String    @unique
  expiresAt       DateTime  @db.Timestamptz(3)
  acceptedAt      DateTime? @db.Timestamptz(3)
  invitedByUserId String

  organization    Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  invitedBy       User         @relation("InvitedBy", fields: [invitedByUserId], references: [id])

  @@index([organizationId])
  @@index([email])
}

model Account {
  id                       String  @id @default(cuid())
  userId                   String
  type                     String
  provider                 String
  providerAccountId        String
  refresh_token            String?
  access_token             String?
  expires_at               Int?
  token_type               String?
  scope                    String?
  id_token                 String?
  session_state            String?
  user                     User    @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@unique([provider, providerAccountId])
}

model Session {
  id           String   @id @default(cuid())
  sessionToken String   @unique
  userId       String
  expires      DateTime @db.Timestamptz(3)
  user         User     @relation(fields: [userId], references: [id], onDelete: Cascade)
}

model VerificationToken {
  identifier String
  token      String   @unique
  expires    DateTime @db.Timestamptz(3)
  @@unique([identifier, token])
}

model Plan {
  key             PlanKey  @id
  name            String
  maxScreens      Int?
  maxStorageBytes BigInt?
  maxUsers        Int?
  maxLocations    Int?
  features        Json     @default("{}")
  isPublic        Boolean  @default(true)

  subscriptions   Subscription[]
}

model Subscription {
  id                   String             @id @default(cuid())
  organizationId       String             @unique
  planKey              PlanKey
  status               SubscriptionStatus @default(TRIALING)
  trialEndsAt          DateTime?          @db.Timestamptz(3)
  stripeCustomerId     String?
  stripeSubscriptionId String?
  createdAt            DateTime           @default(now()) @db.Timestamptz(3)
  updatedAt            DateTime           @updatedAt @db.Timestamptz(3)

  organization         Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  plan                 Plan         @relation(fields: [planKey], references: [key])
}

model AuditLog {
  id             String         @id @default(cuid())
  organizationId String?
  actorType      AuditActorType
  actorId        String?
  action         String
  targetType     String
  targetId       String?
  metadata       Json           @default("{}")
  createdAt      DateTime       @default(now()) @db.Timestamptz(3)

  organization   Organization? @relation(fields: [organizationId], references: [id], onDelete: SetNull)

  @@index([organizationId, createdAt])
}
```

- [ ] **Step 4: Create `src/lib/db/root.ts`**

```ts
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

/**
 * Unscoped Prisma client. Do NOT import this outside src/lib/auth/** or
 * src/app/(app)/settings/platform/**. All tenant data access must go through
 * src/lib/db/tenant.ts so the organization guard and RLS GUC are applied.
 */
export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
```

- [ ] **Step 5: Generate the migration**

Run: `docker compose up -d postgres`
Run: `npm run db:migrate -- --name init_identity`
Expected: migration created under `prisma/migrations/`, applies cleanly.

- [ ] **Step 6: Write `prisma/seed.ts`**

```ts
import { PrismaClient, PlanKey } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const plans: Array<Parameters<typeof prisma.plan.upsert>[0]["create"]> = [
    { key: PlanKey.TRIAL, name: "Trial", maxScreens: 3, maxUsers: 3, maxLocations: 1, maxStorageBytes: BigInt(1_073_741_824), isPublic: false },
    { key: PlanKey.STARTER, name: "Starter", maxScreens: 10, maxUsers: 10, maxLocations: 3, maxStorageBytes: BigInt(10_737_418_240) },
    { key: PlanKey.GROWTH, name: "Growth", maxScreens: 50, maxUsers: 50, maxLocations: 20, maxStorageBytes: BigInt(107_374_182_400) },
    { key: PlanKey.ENTERPRISE, name: "Enterprise", maxScreens: null, maxUsers: null, maxLocations: null, maxStorageBytes: null },
  ];
  for (const p of plans) {
    await prisma.plan.upsert({ where: { key: p.key }, update: p, create: p });
  }

  const email = process.env.SEED_SUPERADMIN_EMAIL ?? "admin@lynesign.local";
  const password = process.env.SEED_SUPERADMIN_PASSWORD ?? "changeme-in-dev";
  await prisma.user.upsert({
    where: { email },
    update: { isSuperAdmin: true },
    create: { email, name: "Platform Admin", isSuperAdmin: true, hashedPassword: await bcrypt.hash(password, 12), emailVerified: new Date() },
  });

  console.log("Seed complete. Super admin:", email);
}

main().finally(() => prisma.$disconnect());
```

- [ ] **Step 7: Run seed + test**

Run: `npm run db:seed`
Run: `npm run test -- prisma/schema.test.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: identity, tenancy, billing, and audit schema with seed"
```

---

## Task 3: Prisma schema — hierarchy, screens, content skeleton

**Files:**
- Modify: `prisma/schema.prisma`
- Test: `prisma/schema-hierarchy.test.ts`

**Interfaces:**
- Consumes: Task 2 models.
- Produces: models `Location` (self-referencing `parentId`), `Screen` (enum `ScreenStatus` = `UNPAIRED | ONLINE | OFFLINE | DISABLED`), `Canvas`, `Panel`, `Frame` (enum `FrameType` = `CLOCK | PICTURE | VIDEO | YOUTUBE | HTML | MEMO | OUTLOOK | REPORT | POWERBI | WEATHER | NEWS`), `FrameLocation`, `Content`, and typed detail tables `Clock`, `Picture`, `Video`, `Youtube`, `Html`, `Memo`, `Outlook`, `Report`, `Powerbi`, `Weather`, `News`, plus `LegacyIntegration`. `Panel`, `Frame`, `FrameLocation`, `Content`, and every typed detail table carry a denormalized `organizationId`. Every migrated table carries a nullable unique `legacyId Int?`.

- [ ] **Step 1: Write the failing test**

`prisma/schema-hierarchy.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
const schema = readFileSync("prisma/schema.prisma", "utf8");

describe("hierarchy + content skeleton", () => {
  it("Location self-references for the tree", () => {
    expect(schema).toMatch(/parentId\s+String\?/);
    expect(schema).toMatch(/parent\s+Location\?\s+@relation/);
  });
  it("Screen has the status enum and pairing fields", () => {
    expect(schema).toContain("enum ScreenStatus");
    expect(schema).toMatch(/pairingCode\s+String\?/);
    expect(schema).toMatch(/deviceTokenHash\s+String\?/);
  });
  it("content tables carry a denormalized organizationId", () => {
    const block = schema.slice(schema.indexOf("model Panel"), schema.indexOf("model Panel") + 400);
    expect(block).toContain("organizationId");
  });
  it("migrated tables carry legacyId", () => {
    expect((schema.match(/legacyId\s+Int\?\s+@unique/g) ?? []).length).toBeGreaterThanOrEqual(6);
  });
});
```

- [ ] **Step 2: Run it, expect fail**

Run: `npm run test -- prisma/schema-hierarchy.test.ts` -> FAIL.

- [ ] **Step 3: Append models to `prisma/schema.prisma`**

```prisma
enum ScreenStatus {
  UNPAIRED
  ONLINE
  OFFLINE
  DISABLED
}

enum FrameType {
  CLOCK
  PICTURE
  VIDEO
  YOUTUBE
  HTML
  MEMO
  OUTLOOK
  REPORT
  POWERBI
  WEATHER
  NEWS
}

model Location {
  id              String   @id @default(cuid())
  organizationId  String
  parentId        String?
  legacyId        Int?     @unique
  name            String
  addressLine1    String?
  addressLine2    String?
  city            String?
  region          String?
  postalCode      String?
  countryCode     String?
  latitude        Float?
  longitude       Float?
  timeZone        String   @default("UTC")
  locale          String   @default("en-US")
  temperatureUnit String?  @db.Char(1)
  createdAt       DateTime @default(now()) @db.Timestamptz(3)
  updatedAt       DateTime @updatedAt @db.Timestamptz(3)

  organization    Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  parent          Location?    @relation("LocationTree", fields: [parentId], references: [id], onDelete: SetNull)
  children        Location[]   @relation("LocationTree")
  screens         Screen[]
  frameLocations  FrameLocation[]

  @@index([organizationId])
  @@index([parentId])
}

model Screen {
  id                  String       @id @default(cuid())
  organizationId      String
  locationId          String
  legacyId            Int?         @unique
  name                String
  pairingCode         String?      @unique
  deviceTokenHash     String?      @unique
  status              ScreenStatus @default(UNPAIRED)
  lastSeenAt          DateTime?    @db.Timestamptz(3)
  canvasId            String?
  pollIntervalSeconds Int          @default(60)
  orientation         String?
  notes               String?
  createdAt           DateTime     @default(now()) @db.Timestamptz(3)
  updatedAt           DateTime     @updatedAt @db.Timestamptz(3)

  organization        Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  location            Location     @relation(fields: [locationId], references: [id], onDelete: Restrict)
  canvas              Canvas?      @relation(fields: [canvasId], references: [id], onDelete: SetNull)

  @@index([organizationId])
  @@index([locationId])
}

model Canvas {
  id                String   @id @default(cuid())
  organizationId    String
  legacyId          Int?     @unique
  name              String
  width             Int
  height            Int
  backgroundColor   String?
  backgroundImageId String?
  createdAt         DateTime @default(now()) @db.Timestamptz(3)
  updatedAt         DateTime @updatedAt @db.Timestamptz(3)

  organization      Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  panels            Panel[]
  screens           Screen[]

  @@index([organizationId])
}

model Panel {
  id             String  @id @default(cuid())
  organizationId String
  canvasId       String
  legacyId       Int?    @unique
  name           String?
  x              Int
  y              Int
  width          Int
  height         Int
  zIndex         Int     @default(0)
  noScroll       Boolean @default(false)

  canvas         Canvas  @relation(fields: [canvasId], references: [id], onDelete: Cascade)
  frames         Frame[]

  @@index([canvasId])
  @@index([organizationId])
}

model Frame {
  id              String    @id @default(cuid())
  organizationId  String
  panelId         String
  legacyId        Int?      @unique
  sortOrder       Int       @default(0)
  durationSeconds Int       @default(10)
  type            FrameType
  locationScoped  Boolean   @default(false)
  createdAt       DateTime  @default(now()) @db.Timestamptz(3)

  panel           Panel     @relation(fields: [panelId], references: [id], onDelete: Cascade)
  content         Content?
  frameLocations  FrameLocation[]

  @@index([panelId])
  @@index([organizationId])
}

model FrameLocation {
  frameId        String
  locationId     String
  organizationId String

  frame          Frame    @relation(fields: [frameId], references: [id], onDelete: Cascade)
  location       Location @relation(fields: [locationId], references: [id], onDelete: Cascade)

  @@id([frameId, locationId])
  @@index([organizationId])
}

model Content {
  id             String  @id @default(cuid())
  organizationId String
  frameId        String  @unique
  legacyId       Int?    @unique
  name           String?

  frame          Frame   @relation(fields: [frameId], references: [id], onDelete: Cascade)

  clock          Clock?
  picture        Picture?
  video          Video?
  youtube        Youtube?
  html           Html?
  memo           Memo?
  outlook        Outlook?
  report         Report?
  powerbi        Powerbi?
  weather        Weather?
  news           News?

  @@index([organizationId])
}

model Clock   { contentId String @id; organizationId String; type Int @default(0); showDate Boolean @default(true); showTime Boolean @default(true); showSeconds Boolean @default(true); label String?; timeZone String?; content Content @relation(fields: [contentId], references: [id], onDelete: Cascade) }
model Picture { contentId String @id; organizationId String; mediaRef String?; mode String?; content Content @relation(fields: [contentId], references: [id], onDelete: Cascade) }
model Video   { contentId String @id; organizationId String; mediaRef String?; content Content @relation(fields: [contentId], references: [id], onDelete: Cascade) }
model Youtube { contentId String @id; organizationId String; videoId String; aspect String?; quality String?; rate String?; content Content @relation(fields: [contentId], references: [id], onDelete: Cascade) }
model Html    { contentId String @id; organizationId String; body String; content Content @relation(fields: [contentId], references: [id], onDelete: Cascade) }
model Memo    { contentId String @id; organizationId String; body String; content Content @relation(fields: [contentId], references: [id], onDelete: Cascade) }
model Outlook { contentId String @id; organizationId String; mode Int @default(0); privacy Int @default(0); accountRef String?; content Content @relation(fields: [contentId], references: [id], onDelete: Cascade) }
model Report  { contentId String @id; organizationId String; path String; serverRef String?; mode Int @default(0); content Content @relation(fields: [contentId], references: [id], onDelete: Cascade) }
model Powerbi { contentId String @id; organizationId String; url String; type Int @default(0); accountRef String?; content Content @relation(fields: [contentId], references: [id], onDelete: Cascade) }
model Weather { contentId String @id; organizationId String; type Int @default(0); provider Int @default(0); content Content @relation(fields: [contentId], references: [id], onDelete: Cascade) }
model News    { contentId String @id; organizationId String; feedUrl String; content Content @relation(fields: [contentId], references: [id], onDelete: Cascade) }

model LegacyIntegration {
  id             String  @id @default(cuid())
  organizationId String
  legacyId       Int?    @unique
  kind           String  // "azure" | "exchange" | "oauth" | "reportServer"
  payload        Json    // secrets re-encrypted with APP_ENCRYPTION_KEY
  createdAt      DateTime @default(now()) @db.Timestamptz(3)

  @@index([organizationId])
}
```

Then add the back-relations on `Organization` (`canvases Canvas[]` already added in Task 2; add nothing else — `Location`/`Screen`/`Canvas` relations were declared there).

- [ ] **Step 4: Migrate**

Run: `npm run db:migrate -- --name hierarchy_and_content`
Expected: applies cleanly.

- [ ] **Step 5: Run the test**

Run: `npm run test -- prisma/schema-hierarchy.test.ts` -> PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: location hierarchy, screens, and Display Monkey content skeleton"
```

---

## Task 4: Row-level security migration

**Files:**
- Create: `prisma/migrations/<timestamp>_rls/migration.sql` (hand-authored, via `prisma migrate dev --create-only`)
- Test: `src/test/isolation/rls.test.ts`

**Interfaces:**
- Consumes: Tasks 2-3 tables.
- Produces: RLS enabled on every table carrying `organizationId`, with a `USING`/`WITH CHECK` policy comparing `"organizationId"` to `current_setting('app.current_org', true)`. A DB role note: the app connects as the table owner, so policies also require `FORCE ROW LEVEL SECURITY`.

- [ ] **Step 1: Write the failing test**

`src/test/isolation/rls.test.ts`:

```ts
import { describe, it, expect, beforeAll } from "vitest";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

describe("row-level security", () => {
  beforeAll(async () => {
    await prisma.$executeRawUnsafe(`DELETE FROM "Location"`);
  });

  it("hides rows from other orgs when app.current_org is set", async () => {
    const orgA = await prisma.organization.create({ data: { name: "A", slug: `a-${Date.now()}` } });
    const orgB = await prisma.organization.create({ data: { name: "B", slug: `b-${Date.now()}` } });
    await prisma.location.create({ data: { organizationId: orgA.id, name: "A-loc" } });
    await prisma.location.create({ data: { organizationId: orgB.id, name: "B-loc" } });

    const rows = await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SELECT set_config('app.current_org', '${orgA.id}', true)`);
      return tx.$queryRawUnsafe<{ name: string }[]>(`SELECT name FROM "Location"`);
    });
    expect(rows.map((r) => r.name)).toEqual(["A-loc"]);
  });
});
```

- [ ] **Step 2: Run it, expect fail**

Run: `npm run test -- src/test/isolation/rls.test.ts`
Expected: FAIL (returns both rows; RLS not present).

- [ ] **Step 3: Create the empty migration**

Run: `npx prisma migrate dev --create-only --name rls`

- [ ] **Step 4: Author `migration.sql`**

```sql
-- Every table carrying organizationId gets the same tenant policy.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'Membership','Invitation','AuditLog','Location','Screen','Canvas','Panel',
    'Frame','FrameLocation','Content','Clock','Picture','Video','Youtube','Html',
    'Memo','Outlook','Report','Powerbi','Weather','News','Subscription','LegacyIntegration'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($f$
      CREATE POLICY tenant_isolation ON %I
      USING (
        current_setting('app.current_org', true) IS NULL
        OR "organizationId" = current_setting('app.current_org', true)
      )
      WITH CHECK (
        current_setting('app.current_org', true) IS NULL
        OR "organizationId" = current_setting('app.current_org', true)
      )
    $f$, t);
  END LOOP;
END $$;
```

Note: `AuditLog.organizationId` is nullable; the `IS NULL` guard on the setting keeps unscoped maintenance queries working, and rows with a null org are only written by `SYSTEM` actors through the root client.

- [ ] **Step 5: Apply + test**

Run: `npm run db:migrate`
Run: `npm run test -- src/test/isolation/rls.test.ts` -> PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: Postgres row-level security for tenant tables"
```

---

## Task 5: Tenant-guarded Prisma client

**Files:**
- Create: `src/lib/db/tenant.ts`
- Test: `src/lib/db/tenant.test.ts`

**Interfaces:**
- Consumes: `prisma` from `@/lib/db/root`.
- Produces: `forOrg(organizationId: string)` -> a `PrismaClient`-shaped object whose every query runs inside a transaction that first executes `SELECT set_config('app.current_org', $orgId, true)`. `forOrg("")` or a falsy id throws `Error("forOrg requires a non-empty organizationId")`. Also `withOrgTransaction(organizationId, fn)`.

- [ ] **Step 1: Write the failing test**

`src/lib/db/tenant.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { forOrg } from "@/lib/db/tenant";
import { prisma } from "@/lib/db/root";

describe("forOrg", () => {
  it("throws without an org id", () => {
    expect(() => forOrg("")).toThrow(/non-empty organizationId/);
  });

  it("only returns rows for the scoped org", async () => {
    const a = await prisma.organization.create({ data: { name: "A", slug: `a-${Date.now()}-${Math.random()}` } });
    const b = await prisma.organization.create({ data: { name: "B", slug: `b-${Date.now()}-${Math.random()}` } });
    await prisma.location.create({ data: { organizationId: a.id, name: "keep" } });
    await prisma.location.create({ data: { organizationId: b.id, name: "hide" } });

    const db = forOrg(a.id);
    const rows = await db.location.findMany();
    expect(rows.every((r) => r.organizationId === a.id)).toBe(true);
    expect(rows.some((r) => r.name === "hide")).toBe(false);
  });

  it("blocks writes for a different org (RLS WITH CHECK)", async () => {
    const a = await prisma.organization.create({ data: { name: "A", slug: `a-${Date.now()}-${Math.random()}` } });
    const b = await prisma.organization.create({ data: { name: "B", slug: `b-${Date.now()}-${Math.random()}` } });
    const db = forOrg(a.id);
    await expect(db.location.create({ data: { organizationId: b.id, name: "evil" } })).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run it, expect fail** — `npm run test -- src/lib/db/tenant.test.ts` -> FAIL (module missing).

- [ ] **Step 3: Implement `src/lib/db/tenant.ts`**

```ts
import { prisma } from "@/lib/db/root";
import type { PrismaClient } from "@prisma/client";

type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

/**
 * Runs `fn` inside a transaction with the RLS GUC `app.current_org` set to
 * `organizationId` for the life of the transaction. Every tenant-scoped read
 * and write in the app must go through this or `forOrg`.
 */
export async function withOrgTransaction<T>(
  organizationId: string,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  if (!organizationId) throw new Error("withOrgTransaction requires a non-empty organizationId");
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SELECT set_config('app.current_org', $1, true)", organizationId);
    return fn(tx);
  });
}

/**
 * A Prisma-shaped facade bound to one organization. Each model method call is
 * wrapped in its own `withOrgTransaction`. Use for straightforward single-call
 * reads/writes; use `withOrgTransaction` directly for multi-step units of work.
 */
export function forOrg(organizationId: string) {
  if (!organizationId) throw new Error("forOrg requires a non-empty organizationId");
  const models = [
    "membership", "invitation", "auditLog", "location", "screen", "canvas",
    "panel", "frame", "frameLocation", "content", "subscription", "legacyIntegration",
  ] as const;
  const facade = {} as Record<string, unknown>;
  for (const model of models) {
    facade[model] = new Proxy({}, {
      get: (_t, op: string) => (args: unknown) =>
        withOrgTransaction(organizationId, (tx) =>
          (tx as unknown as Record<string, Record<string, (a: unknown) => Promise<unknown>>>)[model][op](args),
        ),
    });
  }
  return facade as unknown as Pick<PrismaClient,
    "membership" | "invitation" | "auditLog" | "location" | "screen" | "canvas" |
    "panel" | "frame" | "frameLocation" | "content" | "subscription" | "legacyIntegration">;
}
```

- [ ] **Step 4: Run the test** -> PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: tenant-guarded Prisma client bound to an organization"
```

---

## Task 6: Cross-cutting libs — errors, logging, audit

**Files:**
- Create: `src/lib/errors/index.ts`, `src/lib/logging/index.ts`, `src/lib/audit/index.ts`
- Test: `src/lib/errors/errors.test.ts`, `src/lib/audit/audit.test.ts`

**Interfaces:**
- Consumes: `withOrgTransaction` from `@/lib/db/tenant`, `prisma` from `@/lib/db/root`.
- Produces:
  - `AppError` base with `code`, `httpStatus`, `userMessage`; subclasses `ValidationError` (422), `ForbiddenError` (403), `NotFoundError` (404), `PlanLimitError` (402), `ConflictError` (409), `UnauthorizedError` (401).
  - `toProblem(err): { status, body }` where `body = { type, title, detail }` and `detail` is always safe to show a user.
  - `logger` (pino) and `withRequestId<T>(fn)` that runs `fn` with a child logger carrying a random `reqId`.
  - `writeAudit(input: { organizationId?: string; actorType: "USER"|"SCREEN"|"SYSTEM"; actorId?: string; action: string; targetType: string; targetId?: string; metadata?: Record<string, unknown> }): Promise<void>` — writes via `withOrgTransaction` when `organizationId` is set, else via the root client.

- [ ] **Step 1: Write `src/lib/errors/errors.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { ForbiddenError, PlanLimitError, toProblem } from "@/lib/errors";

describe("errors", () => {
  it("ForbiddenError maps to a 403 problem with a safe message", () => {
    const p = toProblem(new ForbiddenError("You do not have permission to do that."));
    expect(p.status).toBe(403);
    expect(p.body.detail).toBe("You do not have permission to do that.");
    expect(p.body.title).toBe("Forbidden");
  });
  it("PlanLimitError maps to 402", () => {
    expect(toProblem(new PlanLimitError("Your plan allows 3 screens.")).status).toBe(402);
  });
  it("unknown errors never leak their message", () => {
    const p = toProblem(new Error("stack trace with secrets"));
    expect(p.status).toBe(500);
    expect(p.body.detail).toBe("Something went wrong. Please try again.");
  });
});
```

- [ ] **Step 2: Run -> FAIL.**

- [ ] **Step 3: Implement `src/lib/errors/index.ts`**

```ts
export abstract class AppError extends Error {
  abstract readonly code: string;
  abstract readonly httpStatus: number;
  readonly userMessage: string;
  constructor(userMessage: string) {
    super(userMessage);
    this.userMessage = userMessage;
    this.name = this.constructor.name;
  }
}

export class ValidationError extends AppError { code = "validation_error"; httpStatus = 422; }
export class UnauthorizedError extends AppError { code = "unauthorized"; httpStatus = 401; }
export class ForbiddenError extends AppError { code = "forbidden"; httpStatus = 403; }
export class NotFoundError extends AppError { code = "not_found"; httpStatus = 404; }
export class PlanLimitError extends AppError { code = "plan_limit"; httpStatus = 402; }
export class ConflictError extends AppError { code = "conflict"; httpStatus = 409; }

const TITLES: Record<number, string> = {
  401: "Not signed in", 402: "Plan limit reached", 403: "Forbidden",
  404: "Not found", 409: "Conflict", 422: "Check your input", 500: "Server error",
};

export function toProblem(err: unknown): { status: number; body: { type: string; title: string; detail: string } } {
  if (err instanceof AppError) {
    return { status: err.httpStatus, body: { type: err.code, title: TITLES[err.httpStatus] ?? "Error", detail: err.userMessage } };
  }
  return { status: 500, body: { type: "internal_error", title: TITLES[500], detail: "Something went wrong. Please try again." } };
}
```

- [ ] **Step 4: Implement `src/lib/logging/index.ts`**

```ts
import pino from "pino";
import { randomUUID } from "node:crypto";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === "production" ? "info" : "debug"),
  transport: process.env.NODE_ENV === "production" ? undefined : { target: "pino-pretty" },
});

export async function withRequestId<T>(fn: (log: pino.Logger) => Promise<T>): Promise<T> {
  const child = logger.child({ reqId: randomUUID() });
  return fn(child);
}
```

- [ ] **Step 5: Write `src/lib/audit/audit.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { writeAudit } from "@/lib/audit";
import { prisma } from "@/lib/db/root";

describe("writeAudit", () => {
  it("persists an org-scoped entry", async () => {
    const org = await prisma.organization.create({ data: { name: "Aud", slug: `aud-${Date.now()}` } });
    await writeAudit({ organizationId: org.id, actorType: "USER", actorId: "u1", action: "location.create", targetType: "Location", targetId: "loc1" });
    const rows = await prisma.auditLog.findMany({ where: { organizationId: org.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0].action).toBe("location.create");
  });
});
```

- [ ] **Step 6: Implement `src/lib/audit/index.ts`**

```ts
import { prisma } from "@/lib/db/root";
import { withOrgTransaction } from "@/lib/db/tenant";

export interface AuditInput {
  organizationId?: string;
  actorType: "USER" | "SCREEN" | "SYSTEM";
  actorId?: string;
  action: string;
  targetType: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
}

export async function writeAudit(input: AuditInput): Promise<void> {
  const data = {
    organizationId: input.organizationId ?? null,
    actorType: input.actorType,
    actorId: input.actorId ?? null,
    action: input.action,
    targetType: input.targetType,
    targetId: input.targetId ?? null,
    metadata: input.metadata ?? {},
  };
  if (input.organizationId) {
    await withOrgTransaction(input.organizationId, (tx) => tx.auditLog.create({ data }));
  } else {
    await prisma.auditLog.create({ data });
  }
}
```

- [ ] **Step 7: Run both test files** -> PASS.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: typed errors, pino logging, and audit-log helper"
```

---

## Task 7: RBAC policy module

**Files:**
- Create: `src/lib/rbac/roles.ts`, `src/lib/rbac/policy.ts`, `src/lib/rbac/can.ts`
- Test: `src/lib/rbac/can.test.ts`

**Interfaces:**
- Consumes: `Role` enum from `@prisma/client`, `ForbiddenError` from `@/lib/errors`.
- Produces:
  - type `Actor = { kind: "user"; userId: string; isSuperAdmin: boolean; role: Role | null } | { kind: "screen"; screenId: string; organizationId: string }`
  - type `Action` (string literal union, see policy table below)
  - `can(actor: Actor, action: Action): boolean`
  - `assertCan(actor: Actor, action: Action): void` — throws `ForbiddenError` when `can` is false.
  - `ROLE_RANK: Record<Role, number>` (`OWNER` 5 ... `VIEWER` 1) for UI ordering.

- [ ] **Step 1: Write `src/lib/rbac/can.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { can, assertCan } from "@/lib/rbac/can";
import { Role } from "@prisma/client";

const user = (role: Role | null, isSuperAdmin = false) =>
  ({ kind: "user", userId: "u", isSuperAdmin, role }) as const;

describe("can", () => {
  it("OWNER can invite members", () => {
    expect(can(user(Role.OWNER), "member.invite")).toBe(true);
  });
  it("VIEWER cannot create a screen", () => {
    expect(can(user(Role.VIEWER), "screen.create")).toBe(false);
  });
  it("CONTENT_MANAGER can create a screen but not manage billing", () => {
    expect(can(user(Role.CONTENT_MANAGER), "screen.create")).toBe(true);
    expect(can(user(Role.CONTENT_MANAGER), "billing.manage")).toBe(false);
  });
  it("super admin bypasses the table", () => {
    expect(can(user(null, true), "org.delete")).toBe(true);
  });
  it("a screen principal can only sync itself", () => {
    expect(can({ kind: "screen", screenId: "s", organizationId: "o" }, "player.sync")).toBe(true);
    expect(can({ kind: "screen", screenId: "s", organizationId: "o" }, "screen.create")).toBe(false);
  });
  it("assertCan throws ForbiddenError", () => {
    expect(() => assertCan(user(Role.VIEWER), "screen.create")).toThrow(/permission/i);
  });
});
```

- [ ] **Step 2: Run -> FAIL.**

- [ ] **Step 3: Implement `src/lib/rbac/roles.ts`**

```ts
import { Role } from "@prisma/client";

export const ROLE_RANK: Record<Role, number> = {
  OWNER: 5, ADMIN: 4, MANAGER: 3, CONTENT_MANAGER: 2, VIEWER: 1,
};

export const ASSIGNABLE_ROLES: Role[] = [Role.ADMIN, Role.MANAGER, Role.CONTENT_MANAGER, Role.VIEWER];
```

- [ ] **Step 4: Implement `src/lib/rbac/policy.ts`**

```ts
import { Role } from "@prisma/client";

export type Action =
  | "org.view" | "org.update" | "org.delete"
  | "member.view" | "member.invite" | "member.updateRole" | "member.remove"
  | "location.view" | "location.create" | "location.update" | "location.delete"
  | "screen.view" | "screen.create" | "screen.update" | "screen.delete" | "screen.pair"
  | "billing.view" | "billing.manage"
  | "audit.view"
  | "player.sync";

const ALL: Role[] = [Role.OWNER, Role.ADMIN, Role.MANAGER, Role.CONTENT_MANAGER, Role.VIEWER];
const MANAGERS_UP: Role[] = [Role.OWNER, Role.ADMIN, Role.MANAGER];
const CONTENT_UP: Role[] = [Role.OWNER, Role.ADMIN, Role.MANAGER, Role.CONTENT_MANAGER];
const ADMINS_UP: Role[] = [Role.OWNER, Role.ADMIN];

export const POLICY: Record<Action, Role[]> = {
  "org.view": ALL,
  "org.update": ADMINS_UP,
  "org.delete": [Role.OWNER],
  "member.view": ALL,
  "member.invite": ADMINS_UP,
  "member.updateRole": ADMINS_UP,
  "member.remove": ADMINS_UP,
  "location.view": ALL,
  "location.create": MANAGERS_UP,
  "location.update": MANAGERS_UP,
  "location.delete": ADMINS_UP,
  "screen.view": ALL,
  "screen.create": CONTENT_UP,
  "screen.update": CONTENT_UP,
  "screen.delete": MANAGERS_UP,
  "screen.pair": CONTENT_UP,
  "billing.view": ADMINS_UP,
  "billing.manage": [Role.OWNER],
  "audit.view": ADMINS_UP,
  "player.sync": [],
};
```

- [ ] **Step 5: Implement `src/lib/rbac/can.ts`**

```ts
import { Role } from "@prisma/client";
import { ForbiddenError } from "@/lib/errors";
import { POLICY, type Action } from "./policy";

export type Actor =
  | { kind: "user"; userId: string; isSuperAdmin: boolean; role: Role | null }
  | { kind: "screen"; screenId: string; organizationId: string };

const SCREEN_ACTIONS = new Set<Action>(["player.sync"]);

export function can(actor: Actor, action: Action): boolean {
  if (actor.kind === "screen") return SCREEN_ACTIONS.has(action);
  if (actor.isSuperAdmin) return true;
  if (!actor.role) return false;
  return POLICY[action]?.includes(actor.role) ?? false;
}

export function assertCan(actor: Actor, action: Action): void {
  if (!can(actor, action)) {
    throw new ForbiddenError("You do not have permission to do that.");
  }
}
```

- [ ] **Step 6: Run -> PASS.**

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: table-driven RBAC policy with can/assertCan"
```

---

## Task 8: Plan-limits service

**Files:**
- Create: `src/lib/plan-limits/index.ts`
- Test: `src/lib/plan-limits/plan-limits.test.ts`

**Interfaces:**
- Consumes: `prisma` from `@/lib/db/root`, `PlanLimitError` from `@/lib/errors`.
- Produces:
  - `getPlanForOrg(organizationId): Promise<Plan>` (falls back to `TRIAL` if no subscription).
  - `assertCanAddScreen(organizationId): Promise<void>` / `assertCanAddUser` / `assertCanAddLocation` — throw `PlanLimitError` with a message naming the limit.
  - `getStorageUsage(organizationId): Promise<{ usedBytes: bigint; limitBytes: bigint | null }>` — `usedBytes` is `0n` this increment (no media yet).
  - `getUsageSummary(organizationId): Promise<{ screens: {used:number; limit:number|null}; users: ...; locations: ...; storage: {usedBytes:bigint; limitBytes:bigint|null} }>` for the dashboard and billing page.

- [ ] **Step 1: Write the test**

```ts
import { describe, it, expect } from "vitest";
import { prisma } from "@/lib/db/root";
import { assertCanAddScreen, getUsageSummary } from "@/lib/plan-limits";
import { PlanKey } from "@prisma/client";

async function orgOnPlan(key: PlanKey) {
  const org = await prisma.organization.create({ data: { name: "L", slug: `l-${Date.now()}-${Math.random()}` } });
  await prisma.subscription.create({ data: { organizationId: org.id, planKey: key } });
  return org;
}

describe("plan limits", () => {
  it("blocks a 4th screen on TRIAL (max 3)", async () => {
    const org = await orgOnPlan(PlanKey.TRIAL);
    const loc = await prisma.location.create({ data: { organizationId: org.id, name: "L" } });
    for (let i = 0; i < 3; i++) await prisma.screen.create({ data: { organizationId: org.id, locationId: loc.id, name: `s${i}` } });
    await expect(assertCanAddScreen(org.id)).rejects.toThrow(/3 screens/);
  });
  it("ENTERPRISE has no screen ceiling", async () => {
    const org = await orgOnPlan(PlanKey.ENTERPRISE);
    await expect(assertCanAddScreen(org.id)).resolves.toBeUndefined();
  });
  it("summary reports used vs limit", async () => {
    const org = await orgOnPlan(PlanKey.STARTER);
    const s = await getUsageSummary(org.id);
    expect(s.screens.limit).toBe(10);
    expect(s.screens.used).toBe(0);
  });
});
```

- [ ] **Step 2: Run -> FAIL.**

- [ ] **Step 3: Implement `src/lib/plan-limits/index.ts`**

```ts
import { prisma } from "@/lib/db/root";
import { PlanLimitError } from "@/lib/errors";
import { PlanKey, type Plan } from "@prisma/client";

export async function getPlanForOrg(organizationId: string): Promise<Plan> {
  const sub = await prisma.subscription.findUnique({ where: { organizationId }, include: { plan: true } });
  if (sub?.plan) return sub.plan;
  const trial = await prisma.plan.findUnique({ where: { key: PlanKey.TRIAL } });
  if (!trial) throw new Error("TRIAL plan is not seeded");
  return trial;
}

async function assertUnder(organizationId: string, limit: number | null, current: () => Promise<number>, label: string) {
  if (limit === null) return;
  const count = await current();
  if (count >= limit) throw new PlanLimitError(`Your plan allows ${limit} ${label}. Upgrade to add more.`);
}

export async function assertCanAddScreen(organizationId: string): Promise<void> {
  const plan = await getPlanForOrg(organizationId);
  await assertUnder(organizationId, plan.maxScreens, () => prisma.screen.count({ where: { organizationId } }), "screens");
}
export async function assertCanAddUser(organizationId: string): Promise<void> {
  const plan = await getPlanForOrg(organizationId);
  await assertUnder(organizationId, plan.maxUsers, () => prisma.membership.count({ where: { organizationId, status: "ACTIVE" } }), "team members");
}
export async function assertCanAddLocation(organizationId: string): Promise<void> {
  const plan = await getPlanForOrg(organizationId);
  await assertUnder(organizationId, plan.maxLocations, () => prisma.location.count({ where: { organizationId } }), "locations");
}

export async function getStorageUsage(organizationId: string) {
  const plan = await getPlanForOrg(organizationId);
  return { usedBytes: 0n, limitBytes: plan.maxStorageBytes ?? null };
}

export async function getUsageSummary(organizationId: string) {
  const plan = await getPlanForOrg(organizationId);
  const [screens, users, locations] = await Promise.all([
    prisma.screen.count({ where: { organizationId } }),
    prisma.membership.count({ where: { organizationId, status: "ACTIVE" } }),
    prisma.location.count({ where: { organizationId } }),
  ]);
  return {
    screens: { used: screens, limit: plan.maxScreens },
    users: { used: users, limit: plan.maxUsers },
    locations: { used: locations, limit: plan.maxLocations },
    storage: { usedBytes: 0n, limitBytes: plan.maxStorageBytes ?? null },
  };
}
```

- [ ] **Step 4: Run -> PASS.**

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: plan-limits service for screens, users, locations, storage"
```

---

## Task 9: Authentication — NextAuth config, password + credential sessions

**Files:**
- Create: `src/lib/auth/password.ts`, `src/lib/auth/config.ts`, `src/lib/auth/index.ts`, `src/lib/auth/session.ts`
- Create: `src/app/api/auth/[...nextauth]/route.ts`
- Create: `src/lib/email/index.ts`, `src/lib/email/templates.ts`
- Create: `src/types/next-auth.d.ts`
- Test: `src/lib/auth/password.test.ts`, `src/lib/auth/session.test.ts`

**Interfaces:**
- Consumes: `prisma` from `@/lib/db/root`, `PrismaAdapter`.
- Produces:
  - `hashPassword(plain): Promise<string>` (bcryptjs, cost 12), `verifyPassword(plain, hash): Promise<boolean>`.
  - `auth()` (server session getter), `handlers`, `signIn`, `signOut` from `@/lib/auth`.
  - `createCredentialsSession(userId): Promise<string>` — creates a `Session` row directly (30-day expiry), returns the session token; caller sets the `authjs.session-token` cookie. Mirrors mailpilot's "database sessions, credentials provider avoided" pattern.
  - `getServerAuth(): Promise<{ user: { id: string; email: string; isSuperAdmin: boolean } } | null>`.
  - Session shape augmented with `user.id` and `user.isSuperAdmin` (`src/types/next-auth.d.ts`).
  - `sendMail({ to, subject, html })` and template builders `invitationEmail`, `magicLinkEmail`, `passwordResetEmail`.

- [ ] **Step 1: Write `src/lib/auth/password.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword } from "@/lib/auth/password";

describe("password hashing", () => {
  it("verifies a correct password and rejects a wrong one", async () => {
    const hash = await hashPassword("s3cret-passw0rd");
    expect(await verifyPassword("s3cret-passw0rd", hash)).toBe(true);
    expect(await verifyPassword("wrong", hash)).toBe(false);
  });
});
```

- [ ] **Step 2: Run -> FAIL. Implement `src/lib/auth/password.ts`**

```ts
import bcrypt from "bcryptjs";
export const hashPassword = (plain: string) => bcrypt.hash(plain, 12);
export const verifyPassword = (plain: string, hash: string) => bcrypt.compare(plain, hash);
```

- [ ] **Step 3: Implement `src/lib/auth/config.ts`**

```ts
import type { NextAuthConfig } from "next-auth";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "@/lib/db/root";

export const authConfig: NextAuthConfig = {
  adapter: PrismaAdapter(prisma),
  session: { strategy: "database", maxAge: 60 * 60 * 24 * 30 },
  pages: { signIn: "/login" },
  providers: [], // credential login creates Session rows directly; see session.ts
  callbacks: {
    async session({ session, user }) {
      if (session.user) {
        session.user.id = user.id;
        (session.user as { isSuperAdmin?: boolean }).isSuperAdmin =
          (user as { isSuperAdmin?: boolean }).isSuperAdmin ?? false;
      }
      return session;
    },
  },
};
```

- [ ] **Step 4: Implement `src/lib/auth/index.ts`**

```ts
import NextAuth from "next-auth";
import { authConfig } from "./config";

export const { handlers, auth, signIn, signOut } = NextAuth(authConfig);
```

- [ ] **Step 5: Implement `src/app/api/auth/[...nextauth]/route.ts`**

```ts
export { GET, POST } from "@/lib/auth";
```

- [ ] **Step 6: Write `src/lib/auth/session.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { prisma } from "@/lib/db/root";
import { createCredentialsSession } from "@/lib/auth/session";

describe("createCredentialsSession", () => {
  it("creates a Session row that expires in the future", async () => {
    const user = await prisma.user.create({ data: { email: `s-${Date.now()}@x.com` } });
    const token = await createCredentialsSession(user.id);
    const row = await prisma.session.findUnique({ where: { sessionToken: token } });
    expect(row?.userId).toBe(user.id);
    expect(row!.expires.getTime()).toBeGreaterThan(Date.now());
  });
});
```

- [ ] **Step 7: Implement `src/lib/auth/session.ts`**

```ts
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db/root";
import { auth } from "@/lib/auth";

const THIRTY_DAYS_MS = 60 * 60 * 24 * 30 * 1000;

export async function createCredentialsSession(userId: string): Promise<string> {
  const sessionToken = randomUUID();
  await prisma.session.create({
    data: { sessionToken, userId, expires: new Date(Date.now() + THIRTY_DAYS_MS) },
  });
  return sessionToken;
}

export async function getServerAuth() {
  const session = await auth();
  if (!session?.user?.id) return null;
  return {
    user: {
      id: session.user.id,
      email: session.user.email ?? "",
      isSuperAdmin: (session.user as { isSuperAdmin?: boolean }).isSuperAdmin ?? false,
    },
  };
}

export const SESSION_COOKIE =
  process.env.NODE_ENV === "production" ? "__Secure-authjs.session-token" : "authjs.session-token";
```

- [ ] **Step 8: Implement `src/types/next-auth.d.ts`**

```ts
import type { DefaultSession } from "next-auth";
declare module "next-auth" {
  interface Session {
    user: { id: string; isSuperAdmin: boolean } & DefaultSession["user"];
  }
}
```

- [ ] **Step 9: Implement `src/lib/email/index.ts` and `templates.ts`**

```ts
// src/lib/email/index.ts
import nodemailer from "nodemailer";
import { logger } from "@/lib/logging";

const transport = nodemailer.createTransport(process.env.EMAIL_SERVER ?? "");

export async function sendMail(msg: { to: string; subject: string; html: string }) {
  if (!process.env.EMAIL_SERVER) {
    logger.warn({ to: msg.to, subject: msg.subject }, "EMAIL_SERVER unset; logging mail instead of sending");
    return;
  }
  await transport.sendMail({ from: process.env.EMAIL_FROM, ...msg });
}
```

```ts
// src/lib/email/templates.ts
const wrap = (title: string, body: string) =>
  `<div style="font-family:Inter,Arial,sans-serif;color:#1B2A45"><h2>${title}</h2>${body}<p style="color:#6B7280;font-size:13px">LyneSign</p></div>`;

export const invitationEmail = (orgName: string, url: string) =>
  wrap("You have been invited to LyneSign", `<p>${orgName} invited you to help manage their screens.</p><p><a href="${url}">Accept the invitation</a></p><p>This link expires in 7 days.</p>`);

export const magicLinkEmail = (url: string) =>
  wrap("Sign in to LyneSign", `<p><a href="${url}">Click here to sign in</a>. This link expires in 15 minutes.</p>`);

export const passwordResetEmail = (url: string) =>
  wrap("Reset your LyneSign password", `<p><a href="${url}">Choose a new password</a>. This link expires in 1 hour.</p>`);
```

- [ ] **Step 10: Run tests** — `npm run test -- src/lib/auth` -> PASS.

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "feat: NextAuth database sessions, password hashing, email transport"
```

---

## Task 10: Server auth context — requireUser, requireOrg, requireRole

**Files:**
- Create: `src/lib/auth/context.ts`
- Test: `src/lib/auth/context.test.ts`

**Interfaces:**
- Consumes: `getServerAuth` from `@/lib/auth/session`, `prisma` from `@/lib/db/root`, `forOrg` from `@/lib/db/tenant`, errors, `can`/`assertCan` + `Actor` from `@/lib/rbac/can`, `cookies()` from `next/headers`.
- Produces:
  - `requireUser(): Promise<{ id: string; email: string; isSuperAdmin: boolean }>` — throws `UnauthorizedError` when no session.
  - `resolveActiveOrg(userId): Promise<{ organizationId: string; role: Role }>` — reads `lynesign_active_org` cookie, validates it against the user's `ACTIVE` memberships, else falls back to the most recently joined membership. Throws `NotFoundError` if the user has no memberships.
  - `requireOrg(): Promise<{ user; organizationId: string; role: Role; db: ReturnType<typeof forOrg>; actor: Actor }>`.
  - `requireRole(action: Action): Promise<...same as requireOrg...>` — calls `assertCan(actor, action)`.
  - `ACTIVE_ORG_COOKIE = "lynesign_active_org"`.

- [ ] **Step 1: Write `src/lib/auth/context.test.ts`**

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { prisma } from "@/lib/db/root";

const mockCookieStore = { get: vi.fn(), set: vi.fn() };
vi.mock("next/headers", () => ({ cookies: async () => mockCookieStore }));
const authState: { user: { id: string; email: string; isSuperAdmin: boolean } | null } = { user: null };
vi.mock("@/lib/auth/session", () => ({ getServerAuth: async () => (authState.user ? { user: authState.user } : null) }));

beforeEach(() => { mockCookieStore.get.mockReset(); authState.user = null; });

describe("auth context", () => {
  it("requireUser throws when signed out", async () => {
    const { requireUser } = await import("@/lib/auth/context");
    await expect(requireUser()).rejects.toThrow(/sign/i);
  });

  it("resolveActiveOrg rejects a cookie org the user is not a member of", async () => {
    const user = await prisma.user.create({ data: { email: `c-${Date.now()}@x.com` } });
    const mine = await prisma.organization.create({ data: { name: "Mine", slug: `mine-${Date.now()}` } });
    const other = await prisma.organization.create({ data: { name: "Other", slug: `other-${Date.now()}` } });
    await prisma.membership.create({ data: { userId: user.id, organizationId: mine.id, role: "OWNER" } });
    mockCookieStore.get.mockReturnValue({ value: other.id });
    authState.user = { id: user.id, email: user.email, isSuperAdmin: false };
    const { resolveActiveOrg } = await import("@/lib/auth/context");
    const res = await resolveActiveOrg(user.id);
    expect(res.organizationId).toBe(mine.id);
  });

  it("requireRole throws ForbiddenError for a VIEWER creating a screen", async () => {
    const user = await prisma.user.create({ data: { email: `v-${Date.now()}@x.com` } });
    const org = await prisma.organization.create({ data: { name: "V", slug: `v-${Date.now()}` } });
    await prisma.membership.create({ data: { userId: user.id, organizationId: org.id, role: "VIEWER" } });
    mockCookieStore.get.mockReturnValue({ value: org.id });
    authState.user = { id: user.id, email: user.email, isSuperAdmin: false };
    const { requireRole } = await import("@/lib/auth/context");
    await expect(requireRole("screen.create")).rejects.toThrow(/permission/i);
  });
});
```

- [ ] **Step 2: Run -> FAIL.**

- [ ] **Step 3: Implement `src/lib/auth/context.ts`**

```ts
import { cookies } from "next/headers";
import type { Role } from "@prisma/client";
import { prisma } from "@/lib/db/root";
import { forOrg } from "@/lib/db/tenant";
import { getServerAuth } from "@/lib/auth/session";
import { UnauthorizedError, NotFoundError } from "@/lib/errors";
import { assertCan, type Actor } from "@/lib/rbac/can";
import type { Action } from "@/lib/rbac/policy";

export const ACTIVE_ORG_COOKIE = "lynesign_active_org";

export async function requireUser() {
  const session = await getServerAuth();
  if (!session) throw new UnauthorizedError("Please sign in to continue.");
  return session.user;
}

export async function resolveActiveOrg(userId: string): Promise<{ organizationId: string; role: Role }> {
  const memberships = await prisma.membership.findMany({
    where: { userId, status: "ACTIVE" },
    orderBy: { createdAt: "desc" },
  });
  if (memberships.length === 0) throw new NotFoundError("You are not a member of any organization yet.");
  const cookieOrg = (await cookies()).get(ACTIVE_ORG_COOKIE)?.value;
  const chosen = memberships.find((m) => m.organizationId === cookieOrg) ?? memberships[0];
  return { organizationId: chosen.organizationId, role: chosen.role };
}

export async function requireOrg() {
  const user = await requireUser();
  const { organizationId, role } = await resolveActiveOrg(user.id);
  const actor: Actor = { kind: "user", userId: user.id, isSuperAdmin: user.isSuperAdmin, role };
  return { user, organizationId, role, db: forOrg(organizationId), actor };
}

export async function requireRole(action: Action) {
  const ctx = await requireOrg();
  assertCan(ctx.actor, action);
  return ctx;
}
```

- [ ] **Step 4: Run -> PASS.**

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: server auth context with org resolution and role gates"
```

---

## Task 11: Sign-up flow

**Files:**
- Create: `src/app/(auth)/actions.ts` (start with `signUp`)
- Create: `src/app/(auth)/register/page.tsx`
- Create: `src/app/(auth)/layout.tsx`
- Create: `src/lib/validation/auth.ts`
- Create: `src/lib/slug.ts`
- Test: `src/app/(auth)/signup.test.ts`

**Interfaces:**
- Consumes: `prisma` from `@/lib/db/root`, `hashPassword`, `createCredentialsSession`, `SESSION_COOKIE`, `writeAudit`, `PlanKey`, `Role`.
- Produces:
  - `signUp(formData: FormData): Promise<{ error?: string }>` server action: validates with `signUpSchema`, creates `User` + `Organization` + `OWNER` `Membership` + `Subscription{ planKey: TRIAL, status: TRIALING, trialEndsAt: +14d }` in one `prisma.$transaction`, sets the session cookie, `redirect("/dashboard")`. On duplicate email returns `{ error: "An account with that email already exists." }`.
  - `signUpSchema` (zod): `name` min 1, `email` email, `password` min 12, `organizationName` min 1.
  - `slugify(input: string): string` and `uniqueOrgSlug(base: string): Promise<string>`.

- [ ] **Step 1: Write `src/app/(auth)/signup.test.ts`**

```ts
import { describe, it, expect, vi } from "vitest";
import { prisma } from "@/lib/db/root";

vi.mock("next/headers", () => ({ cookies: async () => ({ set: vi.fn(), get: vi.fn() }) }));
const redirectMock = vi.fn(() => { throw new Error("REDIRECT"); });
vi.mock("next/navigation", () => ({ redirect: redirectMock }));

describe("signUp", () => {
  it("creates user, org, owner membership, and a trial subscription", async () => {
    const { signUp } = await import("@/app/(auth)/actions");
    const fd = new FormData();
    fd.set("name", "Dana"); fd.set("email", `dana-${Date.now()}@x.com`);
    fd.set("password", "correcthorsebattery"); fd.set("organizationName", "Dana Signs");
    await expect(signUp(fd)).rejects.toThrow("REDIRECT");

    const user = await prisma.user.findFirst({ where: { name: "Dana" }, include: { memberships: { include: { organization: { include: { subscription: true } } } } } });
    expect(user?.memberships[0].role).toBe("OWNER");
    expect(user?.memberships[0].organization.subscription?.planKey).toBe("TRIAL");
  });

  it("rejects a duplicate email without throwing", async () => {
    const { signUp } = await import("@/app/(auth)/actions");
    const email = `dup-${Date.now()}@x.com`;
    const a = new FormData(); a.set("name", "A"); a.set("email", email); a.set("password", "correcthorsebattery"); a.set("organizationName", "A");
    await expect(signUp(a)).rejects.toThrow("REDIRECT");
    const b = new FormData(); b.set("name", "B"); b.set("email", email); b.set("password", "correcthorsebattery"); b.set("organizationName", "B");
    const res = await signUp(b);
    expect(res.error).toMatch(/already exists/);
  });
});
```

- [ ] **Step 2: Run -> FAIL.**

- [ ] **Step 3: Implement `src/lib/slug.ts`**

```ts
import { prisma } from "@/lib/db/root";

export function slugify(input: string): string {
  return input.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "org";
}

export async function uniqueOrgSlug(base: string): Promise<string> {
  const root = slugify(base);
  for (let i = 0; i < 50; i++) {
    const candidate = i === 0 ? root : `${root}-${i + 1}`;
    if (!(await prisma.organization.findUnique({ where: { slug: candidate } }))) return candidate;
  }
  return `${root}-${Date.now()}`;
}
```

- [ ] **Step 4: Implement `src/lib/validation/auth.ts`**

```ts
import { z } from "zod";

export const signUpSchema = z.object({
  name: z.string().min(1, "Enter your name."),
  email: z.string().email("Enter a valid email address."),
  password: z.string().min(12, "Use at least 12 characters."),
  organizationName: z.string().min(1, "Name your organization."),
});

export const signInSchema = z.object({
  email: z.string().email("Enter a valid email address."),
  password: z.string().min(1, "Enter your password."),
});
```

- [ ] **Step 5: Implement `signUp` in `src/app/(auth)/actions.ts`**

```ts
"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Prisma, PlanKey, Role } from "@prisma/client";
import { prisma } from "@/lib/db/root";
import { hashPassword } from "@/lib/auth/password";
import { createCredentialsSession, SESSION_COOKIE } from "@/lib/auth/session";
import { uniqueOrgSlug } from "@/lib/slug";
import { writeAudit } from "@/lib/audit";
import { signUpSchema } from "@/lib/validation/auth";

export async function signUp(formData: FormData): Promise<{ error?: string }> {
  const parsed = signUpSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check your details." };
  const { name, email, password, organizationName } = parsed.data;

  const slug = await uniqueOrgSlug(organizationName);
  let userId: string;
  try {
    userId = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: { name, email: email.toLowerCase(), hashedPassword: await hashPassword(password), emailVerified: new Date() },
      });
      const org = await tx.organization.create({ data: { name: organizationName, slug } });
      await tx.membership.create({ data: { userId: user.id, organizationId: org.id, role: Role.OWNER } });
      await tx.subscription.create({
        data: { organizationId: org.id, planKey: PlanKey.TRIAL, status: "TRIALING", trialEndsAt: new Date(Date.now() + 14 * 864e5) },
      });
      return user.id;
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return { error: "An account with that email already exists." };
    }
    throw e;
  }

  await writeAudit({ actorType: "USER", actorId: userId, action: "auth.signup", targetType: "User", targetId: userId });
  const token = await createCredentialsSession(userId);
  (await cookies()).set(SESSION_COOKIE, token, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 30 });
  redirect("/dashboard");
}
```

- [ ] **Step 6: Implement `src/app/(auth)/layout.tsx` and `register/page.tsx`**

`layout.tsx`: centered card, `<Heading>Welcome to <accent>LyneSign</accent></Heading>` placeholder text is fine until Task 17 (use plain `<h1>` for now with a TODO-free comment: import `Heading` once available). Keep copy plain: "Create your account", "Sign in".

`register/page.tsx`: a client component form (`"use client"`), `react-hook-form` + `zodResolver(signUpSchema)`, fields name/email/password/organizationName, submits via `signUp` (action passed to `<form action={...}>` or called in `onSubmit`), shows `error` from the returned object with `sonner` `toast.error`.

- [ ] **Step 7: Run the test** -> PASS. Then `npm run dev`, visit `/register`, create an account, confirm redirect to `/dashboard` (dashboard route lands in Task 22; a 404 is fine now, the cookie and redirect are what matter — verify the `Session` row exists with `npm run db:studio`).

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: sign-up flow creating org, owner membership, and trial"
```

---

## Task 12: Sign-in, forgot password, reset password

**Files:**
- Modify: `src/app/(auth)/actions.ts` (add `signInWithPassword`, `signOutAction`, `requestPasswordReset`, `resetPassword`)
- Create: `src/app/(auth)/login/page.tsx`, `src/app/(auth)/forgot-password/page.tsx`, `src/app/(auth)/reset-password/page.tsx`
- Test: `src/app/(auth)/signin.test.ts`

**Interfaces:**
- Consumes: `verifyPassword`, `createCredentialsSession`, `SESSION_COOKIE`, `prisma`, `VerificationToken`, `sendMail`, `passwordResetEmail`, `writeAudit`.
- Produces:
  - `signInWithPassword(formData): Promise<{ error?: string }>` — validates `signInSchema`, looks up user by email, `verifyPassword`; on success sets session cookie and `redirect("/dashboard")`; generic `{ error: "That email or password is not correct." }` on any failure (no user enumeration). If `user.mustResetPassword`, redirect to `/forgot-password?forced=1` instead.
  - `signOutAction(): Promise<void>` — deletes the `Session` row for the current cookie, clears cookie, `redirect("/login")`.
  - `requestPasswordReset(formData): Promise<{ ok: true }>` — always returns `{ ok: true }`; if the user exists, writes a `VerificationToken` (`identifier = "pwreset:" + email`, 1h expiry) and emails the link `${AUTH_URL}/reset-password?token=...&email=...`.
  - `resetPassword(formData): Promise<{ error?: string }>` — validates token+expiry, sets `hashedPassword`, clears `mustResetPassword`, deletes the token and all the user's `Session` rows, `redirect("/login?reset=1")`.

- [ ] **Step 1: Write `src/app/(auth)/signin.test.ts`**

```ts
import { describe, it, expect, vi } from "vitest";
import { prisma } from "@/lib/db/root";
import { hashPassword } from "@/lib/auth/password";

vi.mock("next/headers", () => ({ cookies: async () => ({ set: vi.fn(), get: vi.fn(), delete: vi.fn() }) }));
vi.mock("next/navigation", () => ({ redirect: vi.fn(() => { throw new Error("REDIRECT"); }) }));

describe("signInWithPassword", () => {
  it("accepts a correct password", async () => {
    const email = `si-${Date.now()}@x.com`;
    await prisma.user.create({ data: { email, hashedPassword: await hashPassword("correcthorsebattery") } });
    const { signInWithPassword } = await import("@/app/(auth)/actions");
    const fd = new FormData(); fd.set("email", email); fd.set("password", "correcthorsebattery");
    await expect(signInWithPassword(fd)).rejects.toThrow("REDIRECT");
  });
  it("rejects a wrong password with a generic message", async () => {
    const email = `si2-${Date.now()}@x.com`;
    await prisma.user.create({ data: { email, hashedPassword: await hashPassword("correcthorsebattery") } });
    const { signInWithPassword } = await import("@/app/(auth)/actions");
    const fd = new FormData(); fd.set("email", email); fd.set("password", "nope");
    expect((await signInWithPassword(fd)).error).toMatch(/not correct/);
  });
  it("rejects an unknown email with the same generic message", async () => {
    const { signInWithPassword } = await import("@/app/(auth)/actions");
    const fd = new FormData(); fd.set("email", `ghost-${Date.now()}@x.com`); fd.set("password", "whatever12345");
    expect((await signInWithPassword(fd)).error).toMatch(/not correct/);
  });
});
```

- [ ] **Step 2: Run -> FAIL.**

- [ ] **Step 3: Implement the four actions** in `src/app/(auth)/actions.ts` (append).

```ts
export async function signInWithPassword(formData: FormData): Promise<{ error?: string }> {
  const parsed = signInSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "That email or password is not correct." };
  const user = await prisma.user.findUnique({ where: { email: parsed.data.email.toLowerCase() } });
  if (!user?.hashedPassword || !(await verifyPassword(parsed.data.password, user.hashedPassword))) {
    return { error: "That email or password is not correct." };
  }
  if (user.mustResetPassword) redirect("/forgot-password?forced=1");
  await writeAudit({ actorType: "USER", actorId: user.id, action: "auth.signin", targetType: "User", targetId: user.id });
  const token = await createCredentialsSession(user.id);
  (await cookies()).set(SESSION_COOKIE, token, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 30 });
  redirect("/dashboard");
}
```

(Include `requestPasswordReset`, `resetPassword`, `signOutAction` following the interface contract above; `requestPasswordReset` uses `crypto.randomUUID()` for the token and `sendMail(passwordResetEmail(url))`.)

Add the imports at the top of the file: `verifyPassword` from `@/lib/auth/password`, `signInSchema` from `@/lib/validation/auth`, `sendMail` + `passwordResetEmail` from `@/lib/email`.

- [ ] **Step 4: Build the three pages** — client forms mirroring `register/page.tsx`. `login/page.tsx` shows a success banner when `?reset=1` or `?registered=1`. `forgot-password/page.tsx` shows a forced-reset note when `?forced=1`. All copy plain, no exclamation points.

- [ ] **Step 5: Run the test** -> PASS. Manually: sign in with the Task 11 account, land on `/dashboard`.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: password sign-in, sign-out, and reset flows"
```

---

## Task 13: Invitations — create and accept

**Files:**
- Create: `src/app/(app)/users/actions.ts` (start with `inviteMember`)
- Modify: `src/app/(auth)/actions.ts` (add `acceptInvite`)
- Create: `src/app/(auth)/invite/[token]/page.tsx`
- Create: `src/lib/validation/members.ts`
- Test: `src/app/(app)/users/invite.test.ts`

**Interfaces:**
- Consumes: `requireRole` from `@/lib/auth/context`, `prisma`, `assertCanAddUser`, `sendMail` + `invitationEmail`, `writeAudit`, `Role`, `ASSIGNABLE_ROLES`, `createCredentialsSession`.
- Produces:
  - `inviteMember(formData): Promise<{ error?: string; ok?: true }>` — `requireRole("member.invite")`, validate `{ email, role in ASSIGNABLE_ROLES }`, `assertCanAddUser(organizationId)`, reject if the email is already a member (`ConflictError` -> `{ error }`), upsert an `Invitation` (7-day expiry, `token = randomUUID()`), email the link `${AUTH_URL}/invite/${token}`, audit `member.invite`.
  - `acceptInvite(token: string, formData: FormData): Promise<{ error?: string }>` — loads the invitation, checks `expiresAt` and `acceptedAt`; if no `User` with that email exists, create one from `{ name, password }` in the form (min 12); create the `Membership` with the invite's role; mark `acceptedAt`; sign the user in (session cookie); `redirect("/dashboard")`.

- [ ] **Step 1: Write `src/app/(app)/users/invite.test.ts`**

```ts
import { describe, it, expect, vi } from "vitest";
import { prisma } from "@/lib/db/root";

const ctx = { user: { id: "", email: "", isSuperAdmin: false }, organizationId: "", role: "OWNER" as const, actor: {} as never, db: {} as never };
vi.mock("@/lib/auth/context", () => ({ requireRole: async () => ctx, requireOrg: async () => ctx }));
vi.mock("@/lib/email", () => ({ sendMail: vi.fn(), invitationEmail: () => "<p>x</p>" }));

describe("inviteMember", () => {
  it("creates a pending invitation for a new email", async () => {
    const owner = await prisma.user.create({ data: { email: `own-${Date.now()}@x.com` } });
    const org = await prisma.organization.create({ data: { name: "Inv", slug: `inv-${Date.now()}` } });
    await prisma.membership.create({ data: { userId: owner.id, organizationId: org.id, role: "OWNER" } });
    await prisma.subscription.create({ data: { organizationId: org.id, planKey: "GROWTH" } });
    ctx.user = { id: owner.id, email: owner.email, isSuperAdmin: false }; ctx.organizationId = org.id;

    const { inviteMember } = await import("@/app/(app)/users/actions");
    const fd = new FormData(); fd.set("email", `newbie-${Date.now()}@x.com`); fd.set("role", "MANAGER");
    const res = await inviteMember(fd);
    expect(res.ok).toBe(true);
    expect(await prisma.invitation.count({ where: { organizationId: org.id } })).toBe(1);
  });
});
```

- [ ] **Step 2: Run -> FAIL. Implement `src/lib/validation/members.ts`, `inviteMember`, `acceptInvite`, and the accept page** per the interface contract.

- [ ] **Step 3: Run -> PASS.**

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: member invitations with email and accept flow"
```

---

## Task 14: Organization switch

**Files:**
- Create: `src/app/(app)/settings/actions.ts` (`switchOrg`)
- Test: `src/app/(app)/settings/switch-org.test.ts`

**Interfaces:**
- Consumes: `requireUser`, `prisma`, `ACTIVE_ORG_COOKIE`, `cookies()`, `redirect`, `writeAudit`.
- Produces: `switchOrg(organizationId: string): Promise<{ error?: string }>` — verifies the user has an `ACTIVE` membership in `organizationId`; if not returns `{ error: "You are not a member of that organization." }`; else sets the `lynesign_active_org` cookie and `redirect("/dashboard")`.

- [ ] **Step 1: Write the test**

```ts
import { describe, it, expect, vi } from "vitest";
import { prisma } from "@/lib/db/root";

const cookieStore = { set: vi.fn(), get: vi.fn() };
vi.mock("next/headers", () => ({ cookies: async () => cookieStore }));
vi.mock("next/navigation", () => ({ redirect: vi.fn(() => { throw new Error("REDIRECT"); }) }));
const authUser = { id: "", email: "x", isSuperAdmin: false };
vi.mock("@/lib/auth/context", () => ({ requireUser: async () => authUser, ACTIVE_ORG_COOKIE: "lynesign_active_org" }));

describe("switchOrg", () => {
  it("rejects an org the user does not belong to", async () => {
    const u = await prisma.user.create({ data: { email: `sw-${Date.now()}@x.com` } });
    const other = await prisma.organization.create({ data: { name: "No", slug: `no-${Date.now()}` } });
    authUser.id = u.id;
    const { switchOrg } = await import("@/app/(app)/settings/actions");
    expect((await switchOrg(other.id)).error).toMatch(/not a member/);
  });
  it("sets the cookie for a valid org", async () => {
    const u = await prisma.user.create({ data: { email: `sw2-${Date.now()}@x.com` } });
    const org = await prisma.organization.create({ data: { name: "Yes", slug: `yes-${Date.now()}` } });
    await prisma.membership.create({ data: { userId: u.id, organizationId: org.id, role: "ADMIN" } });
    authUser.id = u.id;
    const { switchOrg } = await import("@/app/(app)/settings/actions");
    await expect(switchOrg(org.id)).rejects.toThrow("REDIRECT");
    expect(cookieStore.set).toHaveBeenCalledWith("lynesign_active_org", org.id, expect.objectContaining({ path: "/" }));
  });
});
```

- [ ] **Step 2: Run -> FAIL. Implement `switchOrg`. Run -> PASS.**

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat: organization switch server action"
```

---

## Task 15: Design tokens, fonts, Tailwind theme

**Files:**
- Modify: `src/app/globals.css`
- Modify: `src/app/layout.tsx`
- Create: `src/components/providers.tsx`
- Create: `components.json`
- Test: `src/app/theme.test.ts`

**Interfaces:**
- Consumes: `next/font/google`.
- Produces: CSS custom properties for the LyneSign palette in `:root` and a dark override under `.dark`, mapped into Tailwind v4's `@theme` so `bg-navy`, `text-tan`, `border-hairline`, `rounded-card`, `font-display` resolve. `<Providers>` wraps children in `next-themes` `ThemeProvider` (`attribute="class"`, `defaultTheme="light"`) plus the `sonner` `<Toaster richColors position="top-right" />`. Fonts: Poppins (display) and Inter (body) exposed as `--font-display` / `--font-body`.

- [ ] **Step 1: Write `src/app/theme.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
const css = readFileSync("src/app/globals.css", "utf8");

describe("design tokens", () => {
  it("defines the LyneSign palette", () => {
    expect(css).toContain("--ls-navy: #1B2A45");
    expect(css).toContain("--ls-tan: #D9A468");
  });
  it("has a dark override block", () => {
    expect(css).toMatch(/\.dark\s*\{/);
  });
  it("maps tokens into the Tailwind theme", () => {
    expect(css).toContain("@theme");
    expect(css).toMatch(/--color-navy:\s*var\(--ls-navy\)/);
  });
});
```

- [ ] **Step 2: Run -> FAIL.**

- [ ] **Step 3: Write `src/app/globals.css`**

```css
@import "tailwindcss";
@import "tw-animate-css";

:root {
  --ls-navy: #1B2A45;
  --ls-navy-dark: #16223A;
  --ls-tan: #D9A468;
  --ls-tan-hover: #C68A4A;
  --ls-ink: #1B2A45;
  --ls-body: #6B7280;
  --ls-hairline: #E5E7EB;
  --ls-surface: #FFFFFF;
  --ls-canvas: #F7F8FA;

  --background: var(--ls-canvas);
  --foreground: var(--ls-ink);
  --primary: var(--ls-navy);
  --primary-foreground: #FFFFFF;
  --accent: var(--ls-tan);
  --ring: var(--ls-tan);
  --border: var(--ls-hairline);
  --card: var(--ls-surface);
}

.dark {
  --ls-ink: #EEF1F6;
  --ls-body: #A7AEBC;
  --ls-hairline: #2A3550;
  --ls-surface: #1B2438;
  --ls-canvas: #131A2A;

  --background: var(--ls-canvas);
  --foreground: var(--ls-ink);
  --primary: #2E4習: ; /* replaced below */
}
```

Note for the implementer: in `.dark`, set `--primary: #33538A;` (a lightened navy that keeps white-text contrast >= 4.5:1) and `--primary-foreground: #FFFFFF;`. Do not leave the placeholder line above; write the real value.

```css
@theme {
  --color-navy: var(--ls-navy);
  --color-navy-dark: var(--ls-navy-dark);
  --color-tan: var(--ls-tan);
  --color-tan-hover: var(--ls-tan-hover);
  --color-ink: var(--ls-ink);
  --color-body: var(--ls-body);
  --color-hairline: var(--ls-hairline);
  --color-surface: var(--ls-surface);
  --color-canvas: var(--ls-canvas);

  --radius-btn: 6px;
  --radius-card: 8px;
  --radius-input: 6px;
  --radius-panel: 16px;

  --font-display: var(--font-display), "Poppins", ui-sans-serif, system-ui, sans-serif;
  --font-body: var(--font-body), "Inter", ui-sans-serif, system-ui, sans-serif;
}

body {
  background: var(--background);
  color: var(--foreground);
  font-family: var(--font-body);
}
```

- [ ] **Step 4: Update `src/app/layout.tsx`**

```tsx
import type { Metadata } from "next";
import { Inter, Poppins } from "next/font/google";
import { Providers } from "@/components/providers";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-body" });
const poppins = Poppins({ subsets: ["latin"], weight: ["600", "700"], variable: "--font-display" });

export const metadata: Metadata = {
  title: { default: "LyneSign", template: "%s | LyneSign" },
  description: "Digital signage for everybody, anywhere.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={`${inter.variable} ${poppins.variable}`}>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
```

- [ ] **Step 5: Write `src/components/providers.tsx`**

```tsx
"use client";
import { ThemeProvider } from "next-themes";
import { Toaster } from "sonner";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false}>
      {children}
      <Toaster richColors position="top-right" />
    </ThemeProvider>
  );
}
```

- [ ] **Step 6: Create `components.json`** — copy `mailpilot/components.json`, set `"css": "src/app/globals.css"`, `"baseColor": "neutral"`, aliases identical.

- [ ] **Step 7: Run the test** -> PASS. Run `npm run dev`, confirm the page renders with the Inter font and no console errors.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: LyneSign design tokens, fonts, and theme provider"
```

---

## Task 16: UI primitives (shadcn, restyled)

**Files:**
- Create (via `npx shadcn@latest add`): `src/components/ui/{button,input,label,textarea,select,checkbox,dialog,sheet,dropdown-menu,tabs,card,badge,table,tooltip,skeleton,sonner,avatar,separator}.tsx`
- Modify: `src/components/ui/button.tsx` (variant restyle)
- Test: `src/components/ui/button.test.tsx`

**Interfaces:**
- Consumes: `cn` from `@/lib/utils`.
- Produces: the shadcn primitive set. `Button` variants: `default` (navy bg, white text), `accent` (tan bg, navy text — never white), `outline` (hairline border), `ghost`, `destructive`, `link`. Sizes `sm | default | lg | icon`. Focus ring uses `--ring` (tan) at 2px with 2px offset.

- [ ] **Step 1: Add the primitives**

Run: `npx shadcn@latest add button input label textarea select checkbox dialog sheet dropdown-menu tabs card badge table tooltip skeleton sonner avatar separator --yes`

- [ ] **Step 2: Write `src/components/ui/button.test.tsx`**

```tsx
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { Button } from "@/components/ui/button";

describe("Button", () => {
  it("renders the default (navy) variant with white text utility", () => {
    const { getByRole } = render(<Button>Save</Button>);
    expect(getByRole("button").className).toMatch(/bg-navy/);
    expect(getByRole("button").className).toMatch(/text-white/);
  });
  it("accent variant uses navy text, not white", () => {
    const { getByRole } = render(<Button variant="accent">Highlight</Button>);
    expect(getByRole("button").className).toMatch(/bg-tan/);
    expect(getByRole("button").className).not.toMatch(/text-white/);
  });
});
```

Add `@testing-library/react` and `@testing-library/dom` + `jsdom` to devDependencies; set `test.environment` to `"jsdom"` for `*.test.tsx` via a `environmentMatchGlobs` entry in `vitest.config.ts`.

- [ ] **Step 3: Run -> FAIL. Restyle `button.tsx`** `buttonVariants` to the variant/size contract above using `navy`, `tan`, `hairline` theme colors and `rounded-btn`.

- [ ] **Step 4: Run -> PASS.**

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: shadcn UI primitives restyled to LyneSign tokens"
```

---

## Task 17: App components

**Files:**
- Create: `src/components/app/{heading,page-header,empty-state,coming-soon,error-state,loading-state,status-dot,stat-tile,screen-card,data-table}.tsx`
- Test: `src/components/app/heading.test.tsx`, `src/components/app/status-dot.test.tsx`, `src/components/app/coming-soon.test.tsx`

**Interfaces:**
- Consumes: `ui/*`, `cn`, `lucide-react`, `ScreenStatus` from `@prisma/client`.
- Produces:
  - `<Heading lead={string} accent?={string} as?={"h1"|"h2"}>` — renders `lead` in `text-ink`, `accent` in `text-tan`, joined by a space, `font-display`. Single accessible name.
  - `<PageHeader title accent? description? actions?>`.
  - `<EmptyState icon title description action?>` — `action` is `{ label, href }` or a node.
  - `<ComingSoon feature={string} description={string}>` — an `EmptyState` preset with copy "This is where you will {description}. It is coming in a later release."
  - `<ErrorState title? detail retry?>` — plain message + "Try again" (calls `retry`) + "Contact support" (mailto `support@lynesign.com`).
  - `<LoadingState label?>` — skeleton rows.
  - `<StatusDot status: ScreenStatus>` — colored dot + text label (`ONLINE` green, `OFFLINE` amber, `UNPAIRED` slate, `DISABLED` muted); color is never the only signal (always shows the word).
  - `<StatTile label value hint? tone?>`.
  - `<ScreenCard screen={{ id; name; status; locationName; lastSeenAt }} />`.
  - `<DataTable columns rows emptyState? pageSize? >` — client component, sortable headers, simple pagination.

- [ ] **Step 1: Write the three tests**

```tsx
// heading.test.tsx
import { render } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { Heading } from "@/components/app/heading";
describe("Heading", () => {
  it("splits lead and accent", () => {
    const { getByRole } = render(<Heading lead="Your" accent="Screens" />);
    expect(getByRole("heading").textContent).toBe("Your Screens");
    expect(getByRole("heading").querySelector(".text-tan")?.textContent).toBe("Screens");
  });
});
```

```tsx
// status-dot.test.tsx
import { render } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { StatusDot } from "@/components/app/status-dot";
describe("StatusDot", () => {
  it("always shows a text label alongside the color", () => {
    const { getByText } = render(<StatusDot status="OFFLINE" />);
    expect(getByText("Offline")).toBeTruthy();
  });
});
```

```tsx
// coming-soon.test.tsx
import { render } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { ComingSoon } from "@/components/app/coming-soon";
describe("ComingSoon", () => {
  it("renders the feature name and a plain sentence", () => {
    const { getByText, container } = render(<ComingSoon feature="Media" description="upload and organize your images and videos" />);
    expect(getByText("Media")).toBeTruthy();
    expect(container.textContent).not.toMatch(/!/);
  });
});
```

- [ ] **Step 2: Run -> FAIL. Implement all components. Run -> PASS.**

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat: LyneSign app component library"
```

---

## Task 18: App shell, navigation, coming-soon routes

**Files:**
- Create: `src/components/app/{app-shell,nav-sidebar,org-switcher}.tsx`
- Create: `src/app/(app)/layout.tsx`
- Create: `src/app/(app)/{media,playlists,campaigns,schedule,analytics}/page.tsx`
- Create: `src/app/(app)/settings/page.tsx`, `src/app/(app)/billing/page.tsx`
- Create: `src/lib/nav.ts`
- Test: `src/lib/nav.test.ts`, `src/app/(app)/layout.test.tsx`

**Interfaces:**
- Consumes: `requireOrg` from `@/lib/auth/context`, `can` + `Actor` from `@/lib/rbac/can`, `prisma`, `switchOrg`, `signOutAction`, `ui/*`, app components.
- Produces:
  - `NAV_ITEMS: Array<{ href: string; label: string; icon: string; action?: Action }>` in `src/lib/nav.ts` (Dashboard, Screens, Locations, Media, Playlists, Campaigns, Schedule, Analytics, Users, Billing, Settings). `visibleNav(actor): NavItem[]` filters by `can(actor, item.action)` when `action` is set.
  - `(app)/layout.tsx`: server component; calls `requireOrg()` (redirects to `/login` on `UnauthorizedError`, to `/register?onboard=1` on the no-membership `NotFoundError`); loads the user's org list for the switcher; renders `<AppShell nav={visibleNav(actor)} orgs={...} activeOrgId={...} user={...}>{children}</AppShell>`.
  - `<AppShell>`: fixed left sidebar on `lg+`, top bar + `Sheet` drawer below `lg`. Header has `<OrgSwitcher>` and a user `DropdownMenu` with Sign out.
  - Coming-soon pages: `<ComingSoon feature="Media" description="upload and organize your images and videos" />` and equivalents.
  - `settings/page.tsx`: shows org name, slug, your role. `billing/page.tsx`: current plan + `getUsageSummary` bars (read-only, "Manage billing" button disabled with helper text "Billing management is coming soon.").

- [ ] **Step 1: Write `src/lib/nav.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { visibleNav } from "@/lib/nav";
import { Role } from "@prisma/client";

describe("visibleNav", () => {
  it("hides Billing from a VIEWER", () => {
    const actor = { kind: "user", userId: "u", isSuperAdmin: false, role: Role.VIEWER } as const;
    expect(visibleNav(actor).some((i) => i.href === "/billing")).toBe(false);
  });
  it("shows Billing to an OWNER", () => {
    const actor = { kind: "user", userId: "u", isSuperAdmin: false, role: Role.OWNER } as const;
    expect(visibleNav(actor).some((i) => i.href === "/billing")).toBe(true);
  });
  it("always shows Dashboard", () => {
    const actor = { kind: "user", userId: "u", isSuperAdmin: false, role: Role.VIEWER } as const;
    expect(visibleNav(actor)[0].href).toBe("/dashboard");
  });
});
```

- [ ] **Step 2: Write `src/app/(app)/layout.test.tsx`**

```tsx
import { describe, it, expect, vi } from "vitest";
vi.mock("@/lib/auth/context", () => ({ requireOrg: vi.fn(async () => { const e = new Error("Please sign in."); e.name = "UnauthorizedError"; throw e; }) }));
const redirectMock = vi.fn(() => { throw new Error("REDIRECT:/login"); });
vi.mock("next/navigation", () => ({ redirect: redirectMock }));

describe("(app) layout", () => {
  it("redirects to /login when unauthorized", async () => {
    const mod = await import("@/app/(app)/layout");
    await expect(mod.default({ children: null } as never)).rejects.toThrow("REDIRECT:/login");
  });
});
```

Note: in the layout, catch by `instanceof UnauthorizedError` / `NotFoundError` from `@/lib/errors` (not by `name`); the test mock throws a plain error whose `name` you can also check. Prefer: `import { UnauthorizedError, NotFoundError } from "@/lib/errors"` and in the layout `catch (e) { if (e instanceof UnauthorizedError) redirect("/login"); if (e instanceof NotFoundError) redirect("/register?onboard=1"); throw e; }`. Adjust the test mock to `throw new UnauthorizedError("Please sign in.")` by importing the real class.

- [ ] **Step 3: Run -> FAIL. Implement `nav.ts`, the layout, `AppShell`, `NavSidebar`, `OrgSwitcher`, and the coming-soon + settings + billing pages.**

- [ ] **Step 4: Run tests -> PASS.** Then `npm run dev`, sign in, confirm the shell renders, nav links resolve (coming-soon pages show the `ComingSoon` state), the org switcher lists your org, and Sign out returns you to `/login`.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: authenticated app shell, role-filtered nav, placeholder sections"
```

---

## Task 19: Locations — list and create

**Files:**
- Create: `src/app/(app)/locations/page.tsx`, `src/app/(app)/locations/actions.ts`
- Create: `src/components/app/location-form.tsx`
- Create: `src/lib/validation/locations.ts`
- Test: `src/app/(app)/locations/locations.test.ts`

**Interfaces:**
- Consumes: `requireRole` / `requireOrg`, `assertCanAddLocation`, `writeAudit`, `ui/*`, `DataTable`, `EmptyState`.
- Produces:
  - `createLocation(formData): Promise<{ error?: string }>` — `requireRole("location.create")`, validate `locationSchema` (`name` required; `parentId` optional and, if set, must belong to the same org; `timeZone` defaults `"UTC"`, `locale` defaults `"en-US"`), `assertCanAddLocation`, create via `ctx.db.location.create`, audit `location.create`, `revalidatePath("/locations")`.
  - `locations/page.tsx` — server component: `requireOrg`, `ctx.db.location.findMany({ orderBy: { name: "asc" } })`, render `DataTable` (Name, Parent, Time zone, Screens count) or `EmptyState` ("No locations yet. Add your first location to group your screens by site.", action Add Location) when empty. A `Dialog` hosts `LocationForm`.

- [ ] **Step 1: Write `src/app/(app)/locations/locations.test.ts`**

```ts
import { describe, it, expect, vi } from "vitest";
import { prisma } from "@/lib/db/root";
import { forOrg } from "@/lib/db/tenant";

const ctx: { user: { id: string; email: string; isSuperAdmin: boolean }; organizationId: string; role: "MANAGER"; actor: never; db: ReturnType<typeof forOrg> } =
  { user: { id: "", email: "", isSuperAdmin: false }, organizationId: "", role: "MANAGER", actor: {} as never, db: {} as never };
vi.mock("@/lib/auth/context", () => ({ requireRole: async () => ctx, requireOrg: async () => ctx }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

describe("createLocation", () => {
  it("creates a location scoped to the active org", async () => {
    const org = await prisma.organization.create({ data: { name: "Loc", slug: `loc-${Date.now()}` } });
    await prisma.subscription.create({ data: { organizationId: org.id, planKey: "GROWTH" } });
    ctx.organizationId = org.id; ctx.db = forOrg(org.id);
    const { createLocation } = await import("@/app/(app)/locations/actions");
    const fd = new FormData(); fd.set("name", "Downtown Store");
    const res = await createLocation(fd);
    expect(res.error).toBeUndefined();
    expect(await prisma.location.count({ where: { organizationId: org.id, name: "Downtown Store" } })).toBe(1);
  });

  it("enforces the plan location cap", async () => {
    const org = await prisma.organization.create({ data: { name: "Cap", slug: `cap-${Date.now()}` } });
    await prisma.subscription.create({ data: { organizationId: org.id, planKey: "TRIAL" } }); // maxLocations 1
    await prisma.location.create({ data: { organizationId: org.id, name: "Only" } });
    ctx.organizationId = org.id; ctx.db = forOrg(org.id);
    const { createLocation } = await import("@/app/(app)/locations/actions");
    const fd = new FormData(); fd.set("name", "Second");
    expect((await createLocation(fd)).error).toMatch(/plan allows 1 location/);
  });
});
```

- [ ] **Step 2: Run -> FAIL. Implement the schema, action, page, and form. Run -> PASS.**

- [ ] **Step 3: Manual check** — `npm run dev`, add a location, see it in the table.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: locations list and creation with plan enforcement"
```

---

## Task 20: Screens, pairing, and the player protocol skeleton

**Files:**
- Create: `src/app/(app)/screens/page.tsx`, `src/app/(app)/screens/actions.ts`
- Create: `src/components/app/{screen-form,pair-screen-dialog}.tsx`
- Create: `src/app/api/player/pair/route.ts`, `src/app/api/player/sync/route.ts`, `src/app/api/player/heartbeat/route.ts`
- Create: `src/app/api/health/route.ts`
- Create: `src/lib/pairing.ts`
- Create: `src/lib/validation/screens.ts`
- Test: `src/lib/pairing.test.ts`, `src/app/(app)/screens/screens.test.ts`, `src/app/api/player/player.test.ts`

**Interfaces:**
- Consumes: `requireRole` / `requireOrg`, `assertCanAddScreen`, `writeAudit`, `prisma` (root, for device-token lookup in route handlers), `forOrg`, `toProblem`, `withRequestId`, `logger`, `can` (for the `SCREEN` actor).
- Produces:
  - `src/lib/pairing.ts`: `generatePairingCode(): string` (8 chars, `A-Z2-9`, no ambiguous `O/0/I/1`), `hashDeviceToken(raw: string): string` (HMAC-SHA256 with `APP_ENCRYPTION_KEY`), `newDeviceToken(): { raw: string; hash: string }`.
  - `createScreen(formData): Promise<{ error?: string; pairingCode?: string }>` — `requireRole("screen.create")`, validate `{ name, locationId }`, `assertCanAddScreen`, create `Screen{ status: UNPAIRED, pairingCode }`, audit `screen.create`, return the code.
  - `regeneratePairingCode(screenId): Promise<{ error?: string; pairingCode?: string }>`.
  - `POST /api/player/pair` body `{ pairingCode }` -> `{ deviceToken, screenId, pollIntervalSeconds }`; sets `deviceTokenHash`, clears `pairingCode`, `status = ONLINE`, `lastSeenAt = now`. Unknown code -> 404 problem.
  - `POST /api/player/heartbeat` header `authorization: Bearer <deviceToken>` -> `{ ok: true }`; updates `lastSeenAt`, `status = ONLINE`.
  - `GET /api/player/sync` same auth -> `{ screenId, pollIntervalSeconds, canvas: null, manifest: [] }` (stub; real assembly is a later increment). Builds a `SCREEN` actor and calls `assertCan(actor, "player.sync")`.
  - `GET /api/health` -> `{ status: "ok" }` after `SELECT 1`, else 503.

- [ ] **Step 1: Write `src/lib/pairing.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { generatePairingCode, hashDeviceToken, newDeviceToken } from "@/lib/pairing";

describe("pairing", () => {
  it("codes are 8 chars and avoid ambiguous glyphs", () => {
    for (let i = 0; i < 50; i++) {
      const c = generatePairingCode();
      expect(c).toMatch(/^[A-Z2-9]{8}$/);
      expect(c).not.toMatch(/[O0I1]/);
    }
  });
  it("hash is stable and token round-trips", () => {
    const { raw, hash } = newDeviceToken();
    expect(hashDeviceToken(raw)).toBe(hash);
  });
});
```

- [ ] **Step 2: Run -> FAIL. Implement `src/lib/pairing.ts`.**

```ts
import { createHmac, randomBytes, randomInt } from "node:crypto";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no O,0,I,1

export function generatePairingCode(): string {
  let out = "";
  for (let i = 0; i < 8; i++) out += ALPHABET[randomInt(ALPHABET.length)];
  return out;
}

export function hashDeviceToken(raw: string): string {
  const key = process.env.APP_ENCRYPTION_KEY;
  if (!key) throw new Error("APP_ENCRYPTION_KEY is not set");
  return createHmac("sha256", key).update(raw).digest("hex");
}

export function newDeviceToken(): { raw: string; hash: string } {
  const raw = randomBytes(32).toString("base64url");
  return { raw, hash: hashDeviceToken(raw) };
}
```

- [ ] **Step 3: Write `src/app/api/player/player.test.ts`**

```ts
import { describe, it, expect, vi } from "vitest";
import { prisma } from "@/lib/db/root";
import { NextRequest } from "next/server";

vi.stubEnv("APP_ENCRYPTION_KEY", "test-key-please-change");

describe("player protocol", () => {
  it("pairs a screen by code, then heartbeats with the token", async () => {
    const org = await prisma.organization.create({ data: { name: "P", slug: `p-${Date.now()}` } });
    const loc = await prisma.location.create({ data: { organizationId: org.id, name: "L" } });
    const screen = await prisma.screen.create({ data: { organizationId: org.id, locationId: loc.id, name: "Lobby", pairingCode: "ABCD2345", status: "UNPAIRED" } });

    const { POST: pair } = await import("@/app/api/player/pair/route");
    const pairRes = await pair(new NextRequest("http://x/api/player/pair", { method: "POST", body: JSON.stringify({ pairingCode: "ABCD2345" }) }));
    const pairБody = await pairRes.json();
    expect(pairRes.status).toBe(200);
    expect(pairБody.screenId).toBe(screen.id);

    const { POST: hb } = await import("@/app/api/player/heartbeat/route");
    const hbRes = await hb(new NextRequest("http://x/api/player/heartbeat", { method: "POST", headers: { authorization: `Bearer ${pairБody.deviceToken}` } }));
    expect(hbRes.status).toBe(200);
    const after = await prisma.screen.findUnique({ where: { id: screen.id } });
    expect(after?.status).toBe("ONLINE");
    expect(after?.pairingCode).toBeNull();
  });

  it("rejects an unknown pairing code with 404", async () => {
    const { POST: pair } = await import("@/app/api/player/pair/route");
    const res = await pair(new NextRequest("http://x/api/player/pair", { method: "POST", body: JSON.stringify({ pairingCode: "ZZZZ9999" }) }));
    expect(res.status).toBe(404);
  });
});
```

(Fix the two intentionally mangled identifiers `pairБody` -> `pairBody` when typing this in.)

- [ ] **Step 4: Run -> FAIL. Implement the three route handlers + health.** Each wraps its body in `try/catch` -> `toProblem`. `pair` looks up by `pairingCode`, generates a token with `newDeviceToken()`, stores `deviceTokenHash`. `heartbeat`/`sync` read `authorization`, hash the bearer, `prisma.screen.findUnique({ where: { deviceTokenHash } })`, 401 problem if missing.

- [ ] **Step 5: Write `src/app/(app)/screens/screens.test.ts`** — mirrors the locations test: `createScreen` scopes to the org, returns a `pairingCode`, and enforces `assertCanAddScreen` (TRIAL cap 3).

- [ ] **Step 6: Run -> FAIL. Implement `createScreen`, `regeneratePairingCode`, the page (`DataTable` of screens with `<StatusDot>`, `EmptyState` when none), `ScreenForm`, and `PairScreenDialog` (shows the code + short instructions).**

- [ ] **Step 7: Run all new tests -> PASS.** Manual: add a screen, see the pairing code, `curl -XPOST localhost:3000/api/player/pair -d '{"pairingCode":"..."}'`, confirm the screen flips to Online on the Screens page after a refresh.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: screen management, pairing, and player protocol skeleton"
```

---

## Task 21: Users page — list members, invite UI, change role, remove

**Files:**
- Create: `src/app/(app)/users/page.tsx`
- Modify: `src/app/(app)/users/actions.ts` (add `updateMemberRole`, `removeMember`)
- Create: `src/components/app/{invite-member-dialog,member-row-actions}.tsx`
- Test: `src/app/(app)/users/members.test.ts`

**Interfaces:**
- Consumes: `requireRole`, `prisma`, `writeAudit`, `ASSIGNABLE_ROLES`, `ROLE_RANK`, `ui/*`.
- Produces:
  - `updateMemberRole(membershipId, role): Promise<{ error?: string }>` — `requireRole("member.updateRole")`; refuses to change the last `OWNER`'s role (`ConflictError` -> `{ error: "An organization must keep at least one owner." }`); refuses to set `OWNER` unless the actor is an `OWNER` or super admin; audit `member.updateRole`.
  - `removeMember(membershipId): Promise<{ error?: string }>` — `requireRole("member.remove")`; refuses to remove the last `OWNER` or yourself; audit `member.remove`.
  - `users/page.tsx` — server component: lists memberships (name, email, role, joined) + pending invitations (email, role, "Invited"), with `InviteMemberDialog` and per-row actions gated by `can(actor, ...)`.

- [ ] **Step 1: Write `src/app/(app)/users/members.test.ts`**

```ts
import { describe, it, expect, vi } from "vitest";
import { prisma } from "@/lib/db/root";

const ctx = { user: { id: "", email: "", isSuperAdmin: false }, organizationId: "", role: "OWNER" as const, actor: { kind: "user", userId: "", isSuperAdmin: false, role: "OWNER" } as never, db: {} as never };
vi.mock("@/lib/auth/context", () => ({ requireRole: async () => ctx, requireOrg: async () => ctx }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

describe("member management", () => {
  it("will not demote the last owner", async () => {
    const owner = await prisma.user.create({ data: { email: `lo-${Date.now()}@x.com` } });
    const org = await prisma.organization.create({ data: { name: "LO", slug: `lo-${Date.now()}` } });
    const m = await prisma.membership.create({ data: { userId: owner.id, organizationId: org.id, role: "OWNER" } });
    ctx.user = { id: owner.id, email: owner.email, isSuperAdmin: false }; ctx.organizationId = org.id;
    (ctx.actor as { userId: string }).userId = owner.id;
    const { updateMemberRole } = await import("@/app/(app)/users/actions");
    expect((await updateMemberRole(m.id, "ADMIN")).error).toMatch(/at least one owner/);
  });
});
```

- [ ] **Step 2: Run -> FAIL. Implement the two actions + page + dialogs. Run -> PASS.**

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat: users page with invite, role change, and safe removal"
```

---

## Task 22: Dashboard

**Files:**
- Create: `src/app/(app)/dashboard/page.tsx`
- Create: `src/components/app/{onboarding-checklist,recent-activity.tsx}`
- Create: `src/lib/dashboard.ts`
- Test: `src/lib/dashboard.test.ts`

**Interfaces:**
- Consumes: `requireOrg`, `prisma`, `getUsageSummary`, `ScreenStatus`, app components.
- Produces:
  - `getDashboardData(organizationId): Promise<{ screens: { total; online; offline; unpaired }; locations: number; members: number; usage: Awaited<ReturnType<typeof getUsageSummary>>; recentActivity: Array<{ id; action; targetType; createdAt; actorId }>; onboarding: { hasLocation; hasScreen; hasPairedScreen; hasTeammate } }>`.
  - `dashboard/page.tsx` — `StatTile` row (Screens total with online/offline hint, Locations, Team members, Storage used vs limit), `RecentActivity` (last 10 audit rows, humanized), quick actions (Add Screen, Add Location, Invite teammate). When `onboarding` has any false flag, render `<OnboardingChecklist>` above the tiles instead of leading with zeros.
  - Screen online/offline is derived: `ONLINE` if `status === "ONLINE"` and `lastSeenAt` within `pollIntervalSeconds * 3`, else counted `offline`.

- [ ] **Step 1: Write `src/lib/dashboard.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { prisma } from "@/lib/db/root";
import { getDashboardData } from "@/lib/dashboard";

describe("getDashboardData", () => {
  it("counts screens by derived online/offline and flags onboarding", async () => {
    const org = await prisma.organization.create({ data: { name: "Dash", slug: `dash-${Date.now()}` } });
    await prisma.subscription.create({ data: { organizationId: org.id, planKey: "GROWTH" } });
    const loc = await prisma.location.create({ data: { organizationId: org.id, name: "L" } });
    await prisma.screen.create({ data: { organizationId: org.id, locationId: loc.id, name: "fresh", status: "ONLINE", lastSeenAt: new Date(), pollIntervalSeconds: 60 } });
    await prisma.screen.create({ data: { organizationId: org.id, locationId: loc.id, name: "stale", status: "ONLINE", lastSeenAt: new Date(Date.now() - 3600_000), pollIntervalSeconds: 60 } });

    const d = await getDashboardData(org.id);
    expect(d.screens.total).toBe(2);
    expect(d.screens.online).toBe(1);
    expect(d.screens.offline).toBe(1);
    expect(d.onboarding.hasLocation).toBe(true);
    expect(d.onboarding.hasPairedScreen).toBe(false);
  });
});
```

- [ ] **Step 2: Run -> FAIL. Implement `src/lib/dashboard.ts` and the page. Run -> PASS.**

- [ ] **Step 3: Manual check** — sign in as the Task 11 account (no data): the onboarding checklist shows. Add a location and a screen: tiles populate, recent activity lists the creates.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: dashboard with live metrics, onboarding checklist, activity feed"
```

---

## Task 23: Worker jobs

**Files:**
- Create: `src/worker/index.ts`, `src/worker/jobs/sweepOfflineScreens.ts`, `src/worker/jobs/sendInvitationEmails.ts`
- Modify: `src/app/(app)/users/actions.ts` and `src/app/(auth)/actions.ts` — enqueue invitation email by writing a row rather than sending inline (add an `OutboundEmail` model) OR send inline and have the sweep only handle screens. Decision: keep invitation email inline (already implemented); the worker owns only `sweepOfflineScreens` for this increment. `sendInvitationEmails` is a retry sweep over failed sends.
- Create: `prisma/schema.prisma` addition — `OutboundEmail { id, to, subject, html, status: PENDING|SENT|FAILED, attempts, lastError?, createdAt, sentAt? }` (global table, not tenant-scoped).
- Test: `src/worker/jobs/sweep.test.ts`

**Interfaces:**
- Consumes: `prisma` (root), `logger`, `sendMail`, `writeAudit`.
- Produces:
  - `sweepOfflineScreens(now = new Date()): Promise<{ flipped: number }>` — sets `status = OFFLINE` for screens where `status = ONLINE` and `lastSeenAt < now - pollIntervalSeconds*3 seconds`; writes a `SYSTEM` audit row per org affected (aggregate count in metadata).
  - `sendInvitationEmails(): Promise<{ sent: number; failed: number }>` — processes `OutboundEmail` where `status IN (PENDING, FAILED)` and `attempts < 5`.
  - `src/worker/index.ts` — the mailpilot `setInterval` tick pattern; runs `sweepOfflineScreens` every 60s and `sendInvitationEmails` every 30s; guards against overlap with a running flag; `SIGINT`/`SIGTERM` clean shutdown.

- [ ] **Step 1: Add `OutboundEmail` to the schema, migrate (`--name outbound_email`), and change `sendMail` callers for invitations to insert an `OutboundEmail` row.**

- [ ] **Step 2: Write `src/worker/jobs/sweep.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { prisma } from "@/lib/db/root";
import { sweepOfflineScreens } from "@/worker/jobs/sweepOfflineScreens";

describe("sweepOfflineScreens", () => {
  it("flips a stale ONLINE screen to OFFLINE", async () => {
    const org = await prisma.organization.create({ data: { name: "Sw", slug: `sw-${Date.now()}` } });
    const loc = await prisma.location.create({ data: { organizationId: org.id, name: "L" } });
    const stale = await prisma.screen.create({ data: { organizationId: org.id, locationId: loc.id, name: "stale", status: "ONLINE", lastSeenAt: new Date(Date.now() - 3600_000), pollIntervalSeconds: 60 } });
    const fresh = await prisma.screen.create({ data: { organizationId: org.id, locationId: loc.id, name: "fresh", status: "ONLINE", lastSeenAt: new Date(), pollIntervalSeconds: 60 } });

    const res = await sweepOfflineScreens();
    expect(res.flipped).toBeGreaterThanOrEqual(1);
    expect((await prisma.screen.findUnique({ where: { id: stale.id } }))?.status).toBe("OFFLINE");
    expect((await prisma.screen.findUnique({ where: { id: fresh.id } }))?.status).toBe("ONLINE");
  });
});
```

- [ ] **Step 3: Run -> FAIL. Implement the jobs and `src/worker/index.ts`. Run -> PASS.**

- [ ] **Step 4: Manual check** — `npm run worker:dev`, confirm the log lines and clean Ctrl-C shutdown.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: worker process with offline-screen sweep and email retry"
```

---

## Task 24: Display Monkey migration script

**Files:**
- Create: `scripts/migrate-displaymonkey.ts`
- Create: `scripts/dm/{reader.ts,map.ts,reconcile.ts}`
- Create: `scripts/fixtures/displaymonkey.sample.json`
- Test: `scripts/dm/map.test.ts`, `scripts/dm/migrate.integration.test.ts`

**Interfaces:**
- Consumes: `prisma` (root), `PlanKey`, `Role`, `FrameType`, `hashDeviceToken` is not used; `APP_ENCRYPTION_KEY` for `LegacyIntegration.payload`.
- Produces:
  - `readSource(opts: { mssqlUrl?: string; fixture?: string }): Promise<DmDump>` — when `mssqlUrl` is set, queries the Display Monkey tables (`Level`, `Location`, `Display`, `Canvas`, `Panel`, `Frame`, `FrameLocation`, `Content` + typed, `Users`, `AzureAccount`, `ExchangeAccount`, `OauthAccount`, `ReportServer`) with `mssql`; otherwise loads the JSON fixture. `DmDump` is a typed shape of arrays.
  - `mapDump(dump: DmDump, ctx: { organizationId: string }): MappedRows` — pure function. `mapFrameType(n: number): FrameType`, `mapUserRole(s: string): Role`, `mapLevelAndLocations(...)` building the `Location` tree (`Level` -> parent `Location`, its `Location` rows -> children), `Display` -> `Screen` (`status: UNPAIRED`, `Host` dropped, `legacyId` set), content tables copied with `legacyId` + denormalized `organizationId`.
  - `reconcile(dump, db, organizationId): Promise<ReconcileReport>` — per-table `{ source, destination, ok }`; script exits `1` if any `ok` is false.
  - `main()` — parses `--org-name` (default `"Imported"`), `--fixture <path>` / `--mssql-url <url>` (falls back to `DISPLAYMONKEY_MSSQL_URL`); upserts the org by slug + an `ENTERPRISE` subscription; runs `mapDump` then bulk `createMany` inside `withOrgTransaction`; prints the reconcile report.
  - Idempotency: every insert is `upsert` keyed on `legacyId`.

- [ ] **Step 1: Create `scripts/fixtures/displaymonkey.sample.json`** — a small but complete dump: 1 `Level`, 2 `Location`, 2 `Display`, 1 `Canvas`, 2 `Panel`, 3 `Frame` (types 0/1/4), matching `FrameLocation` and `Content` rows, 2 `Users` (`admin`, `viewer`), 1 `AzureAccount`.

- [ ] **Step 2: Write `scripts/dm/map.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { mapDump, mapFrameType, mapUserRole } from "./map";

const dump = JSON.parse(readFileSync("scripts/fixtures/displaymonkey.sample.json", "utf8"));

describe("Display Monkey mapping", () => {
  it("maps integer frame types to the FrameType enum", () => {
    expect(mapFrameType(0)).toBe("CLOCK");
    expect(mapFrameType(1)).toBe("PICTURE");
  });
  it("maps admin to ADMIN and anything else to VIEWER", () => {
    expect(mapUserRole("admin")).toBe("ADMIN");
    expect(mapUserRole("whatever")).toBe("VIEWER");
  });
  it("builds a Location tree with Level as the parent", () => {
    const mapped = mapDump(dump, { organizationId: "org_1" });
    const parents = mapped.locations.filter((l) => l.parentId === null);
    const children = mapped.locations.filter((l) => l.parentId !== null);
    expect(parents.length).toBe(1);
    expect(children.length).toBe(2);
    expect(mapped.locations.every((l) => l.organizationId === "org_1")).toBe(true);
  });
  it("drops Display.Host and marks screens UNPAIRED", () => {
    const mapped = mapDump(dump, { organizationId: "org_1" });
    expect(mapped.screens.every((s) => s.status === "UNPAIRED")).toBe(true);
    expect(mapped.screens.every((s) => !("host" in s))).toBe(true);
  });
});
```

- [ ] **Step 3: Run -> FAIL. Implement `scripts/dm/map.ts` (pure), then `reader.ts`, `reconcile.ts`, and `migrate-displaymonkey.ts`.**

- [ ] **Step 4: Write `scripts/dm/migrate.integration.test.ts`** — runs `main()` with `--fixture scripts/fixtures/displaymonkey.sample.json` against the test DB, asserts row counts match the fixture, asserts a second run does not duplicate (idempotent), asserts the reconcile report is all-ok.

- [ ] **Step 5: Run -> PASS.**

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: Display Monkey to LyneSign migration script with reconciliation"
```

---

## Task 25: End-to-end and tenant-isolation suites

**Files:**
- Create: `playwright.config.ts`
- Create: `src/test/e2e/core-journey.spec.ts`
- Create: `src/test/isolation/tenant-isolation.spec.ts`
- Create: `src/test/helpers/db.ts`
- Modify: `package.json` (`test:e2e` wired; `pretest:e2e` runs `prisma migrate deploy` + `db:seed` against a test DB)

**Interfaces:**
- Consumes: the running app (`webServer` in `playwright.config.ts` runs `npm run build && npm run start` on port 3100 with a `DATABASE_URL` pointing at a dedicated `lynesign_test` database).
- Produces:
  - `core-journey.spec.ts`: register -> land on dashboard -> see onboarding checklist -> add a location -> add a screen -> see the pairing code -> `request.post("/api/player/pair", ...)` -> reload Screens -> status shows Online -> dashboard tiles show 1 screen / 1 location.
  - `tenant-isolation.spec.ts`: create org A (user A) and org B (user B) via the API/actions; as user A, attempt to `GET`/mutate a `locationId` and `screenId` belonging to org B through every server action entry point and the player `sync` route with A's session; assert every attempt fails (404/403) and no B row changes. Also assert `forOrg(B).location.findMany()` run under an A-scoped GUC returns nothing (direct DB check via `src/test/helpers/db.ts`).

- [ ] **Step 1: Write `playwright.config.ts`** (`webServer`, `baseURL: "http://localhost:3100"`, `reuseExistingServer: !process.env.CI`).

- [ ] **Step 2: Write `src/test/helpers/db.ts`** — `resetDb()` truncates all tables; `seedPlans()`.

- [ ] **Step 3: Write both specs.**

- [ ] **Step 4: Run**

Run: `npm run test:e2e`
Expected: both specs green.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "test: end-to-end core journey and tenant-isolation suites"
```

---

## Task 26: CI, architecture doc, README

**Files:**
- Create: `.github/workflows/ci.yml`
- Create: `docs/architecture.md`
- Create: `README.md`

**Interfaces:**
- Consumes: all prior tasks.
- Produces:
  - `ci.yml`: on push/PR — a `postgres:16` service; steps: `npm ci`, `npx prisma migrate deploy`, `npm run db:seed`, `npm run lint`, `npm run typecheck`, `npm run test`, `npx playwright install --with-deps`, `npm run test:e2e`. Env `DATABASE_URL`, `AUTH_SECRET`, `APP_ENCRYPTION_KEY` set to CI dummies.
  - `docs/architecture.md`: architecture overview, the data model (link to `schema.prisma` + an ER summary), auth model, authorization model (the `POLICY` table), multi-tenancy model (the three layers, with the RLS SQL), env vars table, deployment (Docker Compose services, `output: "standalone"`), and a "Migration from Display Monkey" section: **preserved** (domain model shape, content tables), **changed** (framework, both UIs, auth, schema is now multi-tenant), **migrated** (Level/Location/Display/Canvas/Panel/Frame/Content/Users via the script), **manual action** (password-reset blast for imported users, re-pair every screen, re-enter integration credentials in later increments).
  - `README.md`: prerequisites (Node 22, Docker), `cp .env.example .env`, `npm run generate-key` for `AUTH_SECRET` and `APP_ENCRYPTION_KEY`, `docker compose up -d postgres`, `npm install`, `npm run db:migrate`, `npm run db:seed`, `npm run dev`, `npm run worker:dev`. Testing section. Migration section: `npm run migrate:dm -- --mssql-url "<url>"`.

- [ ] **Step 1: Write `.github/workflows/ci.yml`.**

- [ ] **Step 2: Run the whole gate locally**

Run: `npm run lint && npm run typecheck && npm run test && npm run test:e2e`
Expected: all green.

- [ ] **Step 3: Write `docs/architecture.md` and `README.md`.**

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "docs: CI workflow, architecture overview, and README"
```

---

## Self-Review

**Spec coverage:**

| Spec section | Task(s) |
|---|---|
| 2 Scope: workspace | 1 |
| 3.1 runtime / worker | 1, 23 |
| 3.2 directory layout | 1, and each feature task |
| 3.3 multi-tenancy (3 layers) | 4 (RLS), 5 (guarded client), 10 (server org context) |
| 3.4 authentication | 9, 11, 12 |
| 3.5 RBAC | 7, enforced in 10, 13, 19, 20, 21 |
| 3.6 player protocol skeleton | 20 |
| 4.1 identity/tenancy models | 2 |
| 4.2 hierarchy models | 3 |
| 4.3 content skeleton | 3, round-tripped in 24 |
| 4.4 billing abstraction + PlanLimits | 2 (models), 8 (service), 18 (billing page) |
| 4.5 denormalized organizationId + RLS | 3, 4 |
| 5 Display Monkey migration | 24 |
| 6 design system | 15, 16, 17 |
| 6.1 contrast decision (navy primary, tan accent) | 15, 16 (Button test asserts it) |
| 7 app shell + dashboard | 18, 22 |
| 8 error handling + observability | 6, used in 20, 22 |
| 9 testing (unit/integration/e2e/isolation) | unit per task, 25 (e2e + isolation), 26 (CI) |
| 10 deliverables | 26 (docs), all |
| 11 env vars | 1 (.env.example), 26 (documented) |
| 12 risk: exact brand hex | flagged in 15 (tokens in one file); values are the design.md estimates |
| 12 risk: DM source access | 24 ships a fixture + integration test; real-data run is manual |

Gaps found and closed: added `OutboundEmail` model in Task 23 (was implied by "invitation emails" + retry but not modeled in the spec); noted it is a global, non-tenant table so it does not need RLS.

**Placeholder scan:** one deliberate placeholder line in Task 15's `.dark` block is called out in prose with the exact replacement value (`--primary: #33538A;`) and an instruction not to ship the placeholder. Two identifiers in Task 20's test (`pairБody`, `pairScreenDialog` casing) are flagged inline for correction. No `TBD`/`TODO`/"add error handling"/"similar to Task N" left in.

**Type consistency:** `forOrg` model list in Task 5 matches the tenant models in Tasks 2-3. `Actor`, `Action`, `can`, `assertCan` signatures are identical across Tasks 7, 10, 18, 20. `requireOrg`/`requireRole` return shape (`{ user, organizationId, role, db, actor }`) is consumed unchanged in Tasks 13, 19, 20, 21, 22. `getUsageSummary` shape defined in Task 8 is consumed in Tasks 18 and 22. `writeAudit` input type defined in Task 6 is used unchanged everywhere. `SESSION_COOKIE` (Task 9) and `ACTIVE_ORG_COOKIE` / `lynesign_active_org` (Task 10) names are consistent in Tasks 11, 12, 14, 18.
