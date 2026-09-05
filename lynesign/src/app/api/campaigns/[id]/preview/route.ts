import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/context";
import { assemblePlaylistPreview } from "@/lib/player/preview";
import { toProblem, NotFoundError } from "@/lib/errors";

/**
 * `GET /api/campaigns/[id]/preview` -- lets the signed-in operator preview the
 * playlist a campaign runs, using the same player as the playlist preview.
 * Gated by `requireRole("campaign.view")` and org-scoped through `ctx.db`, so a
 * campaign id outside the caller's active organization reads as absent.
 *
 * The campaign is resolved to its `playlistId`, then `assemblePlaylistPreview`
 * returns the identical `{ id, name, revision, items }` shape as the playlist
 * preview. Those values are the campaign's PLAYLIST's id, name and revision, not
 * the campaign's. Any failure collapses to an RFC 7807 problem body.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const { id } = await context.params;
    const ctx = await requireRole("campaign.view");
    const campaign = await ctx.db.campaign.findUnique({
      where: { id },
      select: { playlistId: true },
    });
    if (!campaign) {
      throw new NotFoundError("That campaign is not available.");
    }
    return NextResponse.json(
      await assemblePlaylistPreview(ctx.db, campaign.playlistId),
    );
  } catch (err) {
    const problem = toProblem(err);
    return NextResponse.json(problem.body, { status: problem.status });
  }
}
