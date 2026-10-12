# StepReel

StepReel is a multi-tenant SaaS that turns a product's 3D model and its assembly manual into a step-by-step assembly video. Teams upload a model (GLB) and a manual (PDF), an AI pass drafts the assembly steps and captions, the editor lets them review and approve each step, and the result can be previewed in a 3D player, exported as a video, or shared through a public link. New workspaces start with an approved sample project ("Sample: 3-shelf bookshelf").

Stack: Next.js 16, React 19, Three.js, Supabase (Postgres, Auth, Storage, RLS), Anthropic API.

## Local setup

Requirements: Node 24 and Docker (the local Supabase stack runs in Docker containers).

```bash
npm install
npx supabase start          # starts the local stack (needs Docker running)
npx supabase db reset       # applies all migrations
cp .env.example .env.local  # then fill in the values below
npm run dev
```

Fill `.env.local` from the output of `npx supabase status` (`NEXT_PUBLIC_SUPABASE_ANON_KEY` = anon / publishable key, `SUPABASE_SERVICE_ROLE_KEY` = service role / secret key) and add your `ANTHROPIC_API_KEY` (only needed for AI generation). `ANTHROPIC_MODEL` and `NEXT_PUBLIC_SITE_URL` come from the `.env.example` defaults (model defaults to claude-sonnet-5-5; site URL http://localhost:3000). The app runs at http://localhost:3000.

## Tests

- `npm test` - unit tests (Vitest).
- `npm run test:rls` - row-level-security tests; needs the local Supabase stack running.
- `npm run test:e2e` - Playwright smoke test (signup, sample project, preview, share link, public player). Needs the local stack and `.env.local`; install the browser once with `npx playwright install chromium`. It starts `npm run dev` itself unless a server is already running. If port 3000 is in use, run with `E2E_PORT=3100 npm run test:e2e`.

## Deploy

1. Create a Supabase cloud project.
2. `npx supabase link --project-ref <ref>`
3. `npx supabase db push` (applies all four migrations, including the sample template).
4. In Supabase Auth settings set Site URL to the Vercel URL and add `<url>/auth/callback` to the redirect URLs. Keep **email confirmations ON** in the hosted project (Auth > Providers > Email > Confirm email): invites are bound to the invitee's email address, and `accept_invite` refuses accounts whose email is unconfirmed.
5. Import the repo in Vercel with **Root Directory = `AI product video generation`**.
6. Set the environment variables: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`, `NEXT_PUBLIC_SITE_URL`.
7. The AI generate route (`app/api/projects/[id]/generate/route.ts`) sets `maxDuration = 300`. That needs a Vercel plan that allows functions to run longer than 60 s; on a plan capped at 60 s, lower it (long manuals may then time out).

## Operating pilots

To change a workspace's plan or quota, edit its row in Supabase Studio, `organizations` table. Workspace owners cannot change these values themselves.

## Security notes

Asset storage paths are constrained in the database to the owning project's own prefix, so a row cannot point at another project's or tenant's files.

Approval goes only through the `approve_project` RPC, which approves the exact storyboard version the reviewer loaded; `projects.status` is not client-writable. Editing the storyboard, or adding or removing a model, resets approval to draft.

`0002_rls.sql` revokes anon privileges on the tables that exist at that point. Any table added by a later migration must revoke anon privileges and enable RLS itself.

## Known limitations

- Exported videos have captions but no voice.
- Recording needs a visible Chrome or Edge tab; the tab must stay in the foreground while recording.
- Concurrent AI generations can exceed the quota by the number of simultaneous requests.
- Invite links are copied manually (no email sending).
- Signed model URLs on share pages expire after 10 minutes (reload fixes it); the same applies to editor model links.
- The local stack requires Docker.
