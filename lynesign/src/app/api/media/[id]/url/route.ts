import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/context";
import { storage } from "@/lib/storage";
import { toProblem, NotFoundError } from "@/lib/errors";

/**
 * `GET /api/media/[id]/url` -- a short-lived URL the browser can use to fetch an
 * asset for preview. Gated by `requireRole("media.view")`, and the lookup goes
 * through the tenant facade, so an id outside the caller's active organization
 * reads as absent. An archived asset is treated as gone too.
 *
 * A `WEB` asset has no stored object; its `url` is returned as-is. Everything
 * else gets a 1 hour presigned GET for the original plus, when one exists, a
 * matching URL for the thumbnail. Any failure collapses to an RFC 7807 problem
 * body via `toProblem`, which never leaks internals.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const { id } = await context.params;
    const ctx = await requireRole("media.view");

    const asset = await ctx.db.mediaAsset.findUnique({ where: { id } });
    if (!asset || asset.archivedAt) {
      throw new NotFoundError("That media item is not available.");
    }

    if (asset.kind === "WEB") {
      return NextResponse.json({ url: asset.url });
    }

    if (!asset.storageKey) {
      throw new NotFoundError("That media item is not available.");
    }

    const url = await storage.createDownloadUrl(asset.storageKey, 3600);
    const thumbnailUrl = asset.thumbnailKey
      ? await storage.createDownloadUrl(asset.thumbnailKey, 3600)
      : null;

    return NextResponse.json({ url, thumbnailUrl });
  } catch (err) {
    const problem = toProblem(err);
    return NextResponse.json(problem.body, { status: problem.status });
  }
}
