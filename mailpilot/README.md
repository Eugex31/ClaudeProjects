# LyneSign Marketing

Send personalized cold email campaigns through your own Gmail account, via the official Gmail API. No SMTP passwords, no third-party mail relay — every send goes out from your connected Gmail address using OAuth.

**Use this responsibly.** LyneSign Marketing is built for legitimate, permission-based outreach. You are responsible for complying with CAN-SPAM, GDPR, and Gmail's sending policies, and for respecting Gmail's own daily sending limits (~500/day for regular Gmail accounts, ~2000/day for Workspace).

## Features

- Google OAuth sign-in with minimal scope (`gmail.send` only — the app never reads your inbox)
- OAuth tokens encrypted at rest (AES-256-GCM)
- CSV contact import with column mapping and duplicate detection
- Campaign builder with merge-variable personalization (`{{first_name}}`, `{{company}}`, custom fields) and sensible fallbacks
- Paced sending engine: randomized delay between sends, daily send limit, pause/resume/stop, automatic retry with backoff
- Dashboard, per-recipient send logs, and account-wide settings

## Architecture

- **Web app**: Next.js (App Router) — UI, API routes, auth
- **Worker**: a standalone Node process (`src/worker`) that polls Postgres for due sends and drives the Gmail API. Runs as its own process/container so a crash in the send loop never takes down the UI.
- **Database**: PostgreSQL via Prisma — also used for the sending schedule (`CampaignRecipient.scheduledAt`) and a simple Postgres-backed rate limiter, so no Redis is needed at this app's scale.

See [`prisma/schema.prisma`](prisma/schema.prisma) for the full data model.

## Prerequisites

- Node.js 22+ and npm
- PostgreSQL 16+ (or Docker, to run the bundled Postgres container)
- A Google Cloud project with the Gmail API enabled

## Google Cloud setup

1. Create a project at https://console.cloud.google.com/
2. **Enable the Gmail API**: APIs & Services → Library → search "Gmail API" → Enable.
3. **Configure the OAuth consent screen**: APIs & Services → OAuth consent screen
   - User type: External
   - Scopes: add `https://www.googleapis.com/auth/gmail.send`
   - Test users: add every Google account that will sign in, while the app is in "Testing" mode (this is fine for personal/small-team use — full verification is only needed for public access)
4. **Create an OAuth Client ID**: APIs & Services → Credentials → Create Credentials → OAuth client ID
   - Application type: Web application
   - Authorized redirect URI: `http://localhost:3000/api/auth/callback/google` (adjust the host if not running on localhost:3000)
5. Copy the generated Client ID and Client Secret into `.env` (see below).

## Local development

```bash
cp .env.example .env
```

Fill in `.env`:

- `DATABASE_URL` — defaults to the bundled Docker Postgres; adjust if using a different instance
- `NEXTAUTH_SECRET` — generate with `openssl rand -base64 32`
- `NEXTAUTH_URL` — `http://localhost:3000` for local dev
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` — from the Google Cloud setup above
- `ENCRYPTION_KEY` — generate with `npm run generate-key` (32-byte key, base64-encoded)

Start Postgres (skip if you already have one running locally):

```bash
docker compose up postgres -d
```

Install dependencies, run migrations, and start the app:

```bash
npm install
npm run db:migrate
npm run dev
```

The sending engine runs as a **separate process** — open a second terminal and run:

```bash
npm run worker:dev
```

Without the worker running, campaigns will accept a "Start" click but nothing will actually send.

Visit http://localhost:3000, sign in with Google, import some contacts, and build a campaign.

## Running the full stack with Docker

```bash
cp .env.example .env   # fill in the same values as above
docker compose up --build
```

This builds and starts Postgres, runs migrations, and starts both the `web` and `worker` containers from the same [`Dockerfile`](Dockerfile) (two build targets sharing one build context). The app is available at http://localhost:3000.

## Security notes

- OAuth access/refresh tokens are encrypted (AES-256-GCM) before ever touching the database — see `src/lib/crypto/tokenCipher.ts`.
- The Google OAuth scope requested is `gmail.send` only. The app cannot read your inbox.
- Outgoing MIME messages are built with nodemailer's `MailComposer` in-process (never an SMTP transport), with `disableFileAccess`/`disableUrlAccess` set — no attachments or embedded remote content are ever accepted from campaign input, so `GHSA-p6gq-j5cr-w38f` (nodemailer's raw-option file/URL access bypass) isn't reachable through this app's code paths.
- `npm audit` currently reports a few unresolved advisories in transitive dependencies of Next.js itself (`postcss`, `sharp`) whose only available fix is downgrading Next.js by several major versions to an old canary release — not a reasonable tradeoff. Both are only reachable through Next's built-in image-optimization route, which this app never invokes (no `next/image` usage, no configured remote image patterns).
- Also unresolved without a breaking dependency bump: a `brace-expansion` DoS advisory reached only through `googleapis`'s internal `gaxios` → `rimraf` → `glob` → `minimatch` chain. This app never constructs glob patterns from user input (or from anything Gmail-API-response-derived), so the vulnerable code path isn't reachable through this app's usage.

## Project structure

```
prisma/schema.prisma          Database schema (Prisma)
src/app/                      Next.js App Router pages + API routes
src/components/                UI components, organized by feature
src/lib/
  auth.ts                      Auth.js config, encrypted token storage
  crypto/tokenCipher.ts        AES-256-GCM encrypt/decrypt for OAuth tokens
  gmail/                       Gmail API client, MIME building, send + error classification
  personalization/             Merge-variable substitution, email composition
  scheduling.ts                Send pacing / backoff math
  rateLimit.ts                 Postgres-backed fixed-window rate limiter
src/worker/                   Standalone sending-engine process (poller, send job, entrypoint)
src/proxy.ts                  Auth guard + origin-check (Next.js 16's renamed middleware)
```

## Useful scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Start the Next.js dev server |
| `npm run worker:dev` | Start the sending-engine worker (watches for changes) |
| `npm run db:migrate` | Apply Prisma migrations |
| `npm run db:studio` | Open Prisma Studio to browse the database |
| `npm run generate-key` | Generate a fresh `ENCRYPTION_KEY` |
| `npm run lint` | Run ESLint |
