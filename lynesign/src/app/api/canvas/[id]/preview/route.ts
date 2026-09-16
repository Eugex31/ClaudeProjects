import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/context";
import { toProblem, NotFoundError } from "@/lib/errors";
import { buildCanvasManifest } from "@/lib/player/canvas-preview";

/**
 * `GET /api/canvas/[id]/preview` -- the canvas manifest a paired screen would
 * receive from `/api/player/sync`, assembled for the signed-in operator to play
 * in the browser. Gated by `requireRole("canvas.view")`, and the shared
 * `buildCanvasManifest` scopes its read to the caller's active organization, so
 * a canvas id outside that organization reads as absent and this answers 404.
 *
 * The body is a `CanvasManifest` from the shared, pure `assembleCanvasManifest`:
 * panels in `zIndex` then `id` order, each frame resolved to a renderable kind,
 * every image, video and background storage key pre-signed once. A canvas with
 * no renderable panels is returned as-is, with an empty `panels` array. Any
 * failure collapses to an RFC 7807 problem body via `toProblem`.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const { id } = await context.params;
    const ctx = await requireRole("canvas.view");

    const manifest = await buildCanvasManifest(ctx.db, id, ctx.organizationId);
    if (manifest == null) {
      throw new NotFoundError("That canvas is not available.");
    }

    return NextResponse.json(manifest);
  } catch (err) {
    const problem = toProblem(err);
    return NextResponse.json(problem.body, { status: problem.status });
  }
}
