import type { PrismaClient } from "@prisma/client";

import { storage } from "@/lib/storage";
import {
  assembleCanvasManifest,
  type CanvasManifest,
  type CanvasTree,
} from "@/lib/player/canvas-manifest";

const DOWNLOAD_URL_TTL_SECONDS = 3600;

/**
 * The Prisma surface this helper needs: only the `canvas` delegate. Both the
 * unscoped root `prisma` client and a tenant-scoped `ctx.db` facade satisfy it,
 * so a caller that already holds org context and a device-authed caller that
 * passes `organizationId` explicitly can share one code path.
 */
type CanvasReader = Pick<PrismaClient, "canvas">;

/**
 * Load one canvas scoped to an organization and assemble the `CanvasManifest` a
 * paired screen would receive: panels in `zIndex` then `id` order, each frame
 * resolved to a renderable kind, every image, video and background storage key
 * pre-signed once. Shared by `GET /api/canvas/[id]/preview` and the canvas tier
 * of `GET /api/player/sync`.
 *
 * A `null` return means only that no live canvas row with this id exists in this
 * organization: a missing row and an archived one are both `null`, because an
 * archived canvas is off air and must stop being served. It does not encode an
 * empty canvas: a canvas with zero panels assembles to a manifest whose `panels`
 * is an empty array, and each caller decides for itself what to do with that.
 *
 * The nested `panels` and `frames` includes repeat `organizationId` because this
 * helper is called with the unscoped root client on the device-authed sync path,
 * where no RLS session variable is set. The to-one `content`, `picture`,
 * `video` and `backgroundImage` relations carry no `where`, because Prisma does
 * not accept one on a to-one include; those rows are constrained on the write
 * side instead, where `setImageContent`, `setVideoContent` and
 * `isReadyBackgroundImage` all resolve the asset through the tenant `ctx.db`.
 */
export async function buildCanvasManifest(
  db: CanvasReader,
  canvasId: string,
  organizationId: string,
  opts?: { ttlSeconds?: number },
): Promise<CanvasManifest | null> {
  const canvas = await db.canvas.findFirst({
    where: { id: canvasId, organizationId, archivedAt: null },
    include: {
      backgroundImage: { select: { storageKey: true } },
      panels: {
        where: { organizationId },
        orderBy: { zIndex: "asc" },
        include: {
          frames: {
            where: { organizationId },
            orderBy: { sortOrder: "asc" },
            include: {
              content: {
                include: {
                  clock: true,
                  picture: {
                    include: {
                      mediaAsset: {
                        select: {
                          kind: true,
                          storageKey: true,
                          status: true,
                          archivedAt: true,
                        },
                      },
                    },
                  },
                  video: {
                    include: {
                      mediaAsset: {
                        select: {
                          kind: true,
                          storageKey: true,
                          status: true,
                          archivedAt: true,
                          durationSeconds: true,
                        },
                      },
                    },
                  },
                  memo: true,
                  web: true,
                },
              },
            },
          },
        },
      },
    },
  });
  if (!canvas) {
    return null;
  }

  // The Prisma payload is structurally the `CanvasTree` the assembler wants;
  // only the media `kind` column comes back as the wider `MediaKind` enum rather
  // than the `"IMAGE"` / `"VIDEO"` literal. `assembleCanvasManifest` never reads
  // `asset.kind`, so the one assertion here is safe.
  const tree = canvas as unknown as CanvasTree;

  const keys = new Set<string>();
  const addKey = (key: string | null | undefined) => {
    if (key != null && key !== "") keys.add(key);
  };
  addKey(canvas.backgroundImage?.storageKey);
  for (const panel of canvas.panels) {
    for (const frame of panel.frames) {
      addKey(frame.content?.picture?.mediaAsset?.storageKey);
      addKey(frame.content?.video?.mediaAsset?.storageKey);
    }
  }

  const ttlSeconds = opts?.ttlSeconds ?? DOWNLOAD_URL_TTL_SECONDS;
  const orderedKeys = [...keys];
  const signed = await Promise.all(
    orderedKeys.map((key) => storage.createDownloadUrl(key, ttlSeconds)),
  );
  const urlMap = new Map(orderedKeys.map((key, index) => [key, signed[index]]));

  return assembleCanvasManifest(tree, (key) => urlMap.get(key) ?? "");
}
