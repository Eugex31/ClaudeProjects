# StepReel MVP — Design Spec

*Working name: StepReel. Date: 2026-10-12.*

## 1. Purpose

Turn a product's **real 3D model** plus its **existing assembly manual** into an accurate, narrated, step-by-step assembly video — as easy as HeyGen, as accurate as CAD tools.

- **First customer:** small consumer-product companies (flat-pack furniture, fitness equipment, grills) selling on Amazon/Wayfair, where assembly frustration drives returns and one-star reviews.
- **MVP goal:** a hosted, multi-tenant SaaS that pilot customers (5–10) can log into, upload their files, and get an approved video and share link. Pilots are invoiced manually.
- **Success criteria:**
  1. A pilot user can go from upload to an approved, playable video in under 30 minutes for a 10–20 part product.
  2. Every part shown in the video is real geometry from the customer's model — no generated imagery.
  3. Tenant A can never read tenant B's data or files (verified by automated tests).

## 2. Core principle

AI decides **what happens when** (step order, which parts, captions, narration, camera). It never draws the product. three.js renders the customer's actual geometry. A human approves every storyboard before it can be exported or shared.

## 3. Stack

| Concern | Choice |
|---|---|
| App | Next.js (App Router, TypeScript), deployed to Vercel |
| Auth / DB / files | Supabase Auth (email magic link + password), Postgres with RLS, private Storage bucket |
| 3D | three.js + GLTFLoader, client-only components |
| AI | Claude via `@anthropic-ai/sdk`, called only from server route handlers |
| PDF text | `unpdf` on the server |
| Voice | Browser `speechSynthesis` (live player only) |
| Export | `canvas.captureStream()` + `MediaRecorder` → MP4 if supported, else WebM |
| Tests | Vitest (unit), SQL-level RLS tests against a local Supabase, Playwright smoke test |

Environment: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (server only, used solely for share-link reads and quota updates), `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` (default `claude-sonnet-5-5`).

## 4. Data model

All tenant tables carry `org_id` and have RLS enabled.

- **organizations** — `id`, `name`, `plan` (`pilot` | `pro`), `monthly_generation_quota` (int, default 20), `created_at`.
- **memberships** — `org_id`, `user_id`, `role` (`owner` | `editor` | `viewer`), PK (`org_id`, `user_id`).
- **invites** — `id`, `org_id`, `email`, `role`, `token` (random, unique), `expires_at` (7 days), `accepted_at`.
- **projects** — `id`, `org_id`, `name`, `language` (`en` | `pt` | `es` | `fr`), `status` (`draft` | `approved`), `approved_by`, `approved_at`, `share_token` (nullable, random 32 chars), `created_by`, timestamps.
- **assets** — `id`, `org_id`, `project_id`, `kind` (`model` | `manual` | `export`), `storage_path`, `filename`, `size_bytes`, `created_at`.
- **storyboards** — `project_id` (PK), `org_id`, `parts` (jsonb: part manifest), `steps` (jsonb), `manual_text` (text), `updated_at`.
- **usage** — `org_id`, `period` (`YYYY-MM`), `generations` (int), PK (`org_id`, `period`).

**RLS policy shape:** a helper `is_member(org_id, min_role)` (SECURITY DEFINER, reads `memberships` for `auth.uid()`). Select requires `viewer`; insert/update/delete on projects, assets, storyboards requires `editor`; organization settings and invites require `owner`. `usage` is readable by members and writable only by the service role.

**Signup:** a trigger on `auth.users` insert creates an organization named "<email local-part>'s workspace" (renamable in settings), an `owner` membership, and a sample project (see §12).

## 5. File storage

- One **private** bucket `org-files`, paths `{org_id}/{project_id}/{asset_id}-{filename}`.
- Storage RLS: read/write allowed only when the first path segment is an org the user belongs to (editor+ for write).
- Upload limits: model ≤ 50 MB (`.glb`), manual ≤ 20 MB (`.pdf`) or pasted text ≤ 100 KB; export ≤ 200 MB.
- Browser receives only signed URLs (10-minute expiry). Nothing is public.

## 6. Storyboard format

```ts
type PartManifest = {
  id: string;            // glTF node name (unnamed meshes auto-named part_01, part_02…)
  label: string;         // human label, editable
  size: [number, number, number];    // bounding box extents
  center: [number, number, number];  // bounding box center in assembled pose
}[];

type Step = {
  id: string;
  title: string;          // ≤ 60 chars, shown as caption heading
  narration: string;      // ≤ 300 chars, spoken + captioned
  parts: string[];        // PartManifest ids that appear/move in this step
  from: "above" | "below" | "left" | "right" | "front" | "back";  // fly-in direction
  camera: "front" | "back" | "left" | "right" | "top" | "iso";   // preset angle
  warning?: string;       // optional safety note shown as a callout
};
```

**Validation (`validateStoryboard`)** — pure function, unit-tested: drops part ids not in the manifest (recording them in `issues[]`), clamps text lengths, fills defaults for missing `from`/`camera`, rejects zero-step storyboards, and reports parts never placed in any step as a warning. The editor shows `issues[]` to the user.

## 7. AI generation

Route `POST /api/projects/:id/generate` (editor+):

1. Check quota: `usage.generations < organizations.monthly_generation_quota` for the current month, else `429` with a clear message.
2. Load manual text (extracted from PDF at upload time and stored in `storyboards.manual_text`) and the part manifest (extracted client-side from the GLB at upload time and saved with the storyboard).
3. Call Claude with a system prompt describing the task and a **tool definition whose input schema is the `Step[]` shape**, forcing structured output. The prompt includes the manual text, the part manifest, and the target language (narration and titles are written in that language).
4. Run `validateStoryboard`, save steps, increment usage (service role), set project `status = draft`.
5. Errors: missing API key → `503` "AI generation not configured; you can build the storyboard manually." Claude failure → `502`, usage not incremented.

Generation can be re-run; it overwrites steps after a confirm dialog.

## 8. Screens

- `/login`, `/signup` — Supabase Auth.
- `/invite/:token` — accept invite (must be signed in with matching email).
- `/app` — project list for the current org; org switcher in header.
- `/app/projects/new` — name, language, upload GLB, upload PDF or paste manual text.
- `/app/projects/:id` — **editor**: 3D viewport (left), step list (right). Click a step to preview it; click parts in the viewport to toggle them in the selected step; edit title/narration/warning, direction, camera; drag to reorder; add/delete steps; issues banner. Buttons: Generate with AI, Play, Approve, Record, Share.
- `/app/settings` — org name, members and roles, invites, plan and usage this month (read-only).
- `/v/:share_token` — public read-only player (no login).

## 9. Approval workflow

- Any edit to steps or part labels sets `status = draft` and clears `approved_by/at`.
- **Approve** (editor+) sets `status = approved`, `approved_by = auth.uid()`, `approved_at = now()`.
- Record and Share buttons are disabled unless `status = approved`.
- Share creates `share_token`; Revoke sets it to null. `/v/:token` renders only if the project is approved and the token matches; it reads via a server route using the service role and returns the storyboard plus signed model URL — never other project data.

## 10. Player

A pure `buildTimeline(steps, manifest)` function (unit-tested) produces, per step: start time, duration (`max(4s, narration words / 2.5 words-per-sec + 1.5s)`), the set of parts visible at start, the parts animating in, and each animating part's start offset (`from` direction × 1.5 × the model's largest bounding dimension).

Rendering per frame:
- Parts placed in earlier steps: visible, normal material.
- Current step parts: lerp from offset to assembled position over the first 1.5 s (ease-out), with an emissive highlight that fades after arrival.
- Future parts: hidden.
- Camera eases to the step's preset (positions computed from the model's bounding sphere).
- Caption overlay: "Step n / N", title, narration, warning callout.
- `speechSynthesis` speaks narration with a voice matching the project language when available.

Controls: play/pause, previous/next step, restart, speed (0.75×/1×/1.25×).

## 11. Export

Record runs the timeline at 1× into a 1280×720 offscreen canvas that composites the three.js frame with captions drawn via 2D canvas, recorded at 30 fps. MIME preference: `video/mp4;codecs=avc1` → `video/webm;codecs=vp9` → `video/webm`. The result is downloaded locally and uploaded as an `export` asset. **The exported file has no audio** (browser speech cannot be captured); the UI states this.

## 12. Sample project

`lib/sample/bookshelf.ts` procedurally builds a flat-pack bookshelf (2 side panels, top, bottom, 3 shelves, back panel, 8 dowels, 8 cam locks — named nodes) and exports it to GLB with `GLTFExporter`. A build script writes `public/sample/bookshelf.glb` plus `bookshelf-manual.txt` (a 7-step manual). The signup trigger copies a sample project referencing these files with a pre-written approved storyboard so new users see a working video immediately. Its model asset uses the reserved `storage_path` prefix `sample:` (e.g. `sample:bookshelf.glb`), which the app resolves to the public `/sample/` file instead of a signed URL; sample files are not customer data.

## 13. Testing

- **Unit (Vitest):** `validateStoryboard`, `buildTimeline`, part-manifest extraction, quota check, camera preset math.
- **RLS (Vitest against local Supabase via `supabase start`):** create users in two orgs; assert user A cannot select/update B's projects, storyboards, assets, or storage objects; viewer cannot update; share route returns 404 for unapproved projects and revoked tokens.
- **Smoke (Playwright):** sign up → sample project exists → open editor → play → approve → share link opens player logged out.
- Claude calls are mocked in automated tests; one manual end-to-end run with a real key before handoff.

## 14. Out of scope

Stripe billing, STEP/SolidWorks/Fusion import, voiced export (server TTS), QR codes and viewing analytics, SSO/SAML, audit logs beyond the approval stamp, inferring assembly order from geometry alone, mobile-optimized editor (player is responsive).
