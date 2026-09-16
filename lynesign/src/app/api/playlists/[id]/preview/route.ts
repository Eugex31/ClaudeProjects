import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/context";
import { assemblePlaylistPreview } from "@/lib/player/preview";
import { toProblem } from "@/lib/errors";

/**
 * `GET /api/playlists/[id]/preview` -- the same manifest a paired screen would
 * receive from `/api/player/sync`, but for the signed-in operator to preview in
 * the browser. Gated by `requireRole("playlist.view")`, and every read goes
 * through the tenant facade, so a playlist id outside the caller's active
 * organization reads as absent.
 *
 * The body is `{ id, name, revision, items: ManifestItem[] }`, assembled by the
 * shared `assemblePlaylistPreview` helper: enabled items in position order, each
 * resolved to a ready, non-archived asset with a freshly signed download URL.
 * Any failure collapses to an RFC 7807 problem body via `toProblem`.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const { id } = await context.params;
    const ctx = await requireRole("playlist.view");
    return NextResponse.json(await assemblePlaylistPreview(ctx.db, id));
  } catch (err) {
    const problem = toProblem(err);
    return NextResponse.json(problem.body, { status: problem.status });
  }
}
