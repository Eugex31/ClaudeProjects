import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/context";
import { toProblem, NotFoundError } from "@/lib/errors";
import { resolveScreenPlayback } from "@/lib/player/resolve-screen-playback";

/**
 * `GET /api/screens/[id]/preview` -- tells the signed-in operator what one
 * screen is playing right now, so the row's "Preview" action can open the
 * matching player with a demo watermark. Gated by `requireRole("screen.view")`
 * and org-scoped through `ctx.db`, so a screen id outside the caller's active
 * organization reads as absent and this answers 404.
 *
 * The shared `resolveScreenPlayback` applies the exact precedence of
 * `GET /api/player/sync` -- active campaign, matching schedule rule, canvas
 * tier, base playlist, nothing. The body is deliberately thin: the canvas and
 * playlist sub-dialogs fetch their own manifests, so this returns only the
 * `source`, the id the sub-dialog needs (`canvasId` or `playlistId`), a human
 * `label` for the campaign or rule, and the screen name for the dialog title.
 * Any failure collapses to an RFC 7807 problem body via `toProblem`.
 */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const { id } = await ctx.params;
    const auth = await requireRole("screen.view");

    const screen = await auth.db.screen.findUnique({
      where: { id },
      select: {
        id: true,
        organizationId: true,
        locationId: true,
        playlistId: true,
        canvasId: true,
        name: true,
      },
    });
    if (!screen) {
      throw new NotFoundError("That screen is not available.");
    }

    const r = await resolveScreenPlayback(auth.db, screen, new Date(), {
      warn() {},
    });

    if (r.source === "canvas") {
      return NextResponse.json({
        source: "canvas",
        canvasId: r.canvasId,
        screenName: screen.name,
      });
    }
    if (r.source === "campaign") {
      return NextResponse.json({
        source: "campaign",
        playlistId: r.playlistId,
        label: r.campaign.name,
        screenName: screen.name,
      });
    }
    if (r.source === "schedule") {
      return NextResponse.json({
        source: "schedule",
        playlistId: r.playlistId,
        label: r.rule.name,
        screenName: screen.name,
      });
    }
    if (r.source === "playlist") {
      return NextResponse.json({
        source: "playlist",
        playlistId: r.playlistId,
        screenName: screen.name,
      });
    }
    return NextResponse.json({ source: "none", screenName: screen.name });
  } catch (err) {
    const problem = toProblem(err);
    return NextResponse.json(problem.body, { status: problem.status });
  }
}
