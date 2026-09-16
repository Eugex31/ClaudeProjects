import { notFound } from "next/navigation";
import type { Prisma } from "@prisma/client";

import { requireRole } from "@/lib/auth/context";
import { can } from "@/lib/rbac/can";
import { storage } from "@/lib/storage";
import { PageHeader } from "@/components/app/page-header";
import {
  CanvasEditor,
  type CanvasEditorAsset,
  type CanvasTree,
} from "@/components/app/canvas/canvas-editor";
import type {
  FrameContentVM,
  FrameKind,
  FrameVM,
  PanelVM,
} from "@/components/app/canvas/canvas-stage";

export const metadata = { title: "Canvas editor" };

/**
 * Visual editor for one canvas in the active organization. A single tenant-scoped
 * read loads the canvas, its panels in `zIndex` order, each panel's frames in
 * `sortOrder` order, and every frame's content row with its typed sub-record.
 * The ready media library and the background image are pre-signed here so the
 * client never fans out one request per thumbnail. Everything handed across the
 * boundary is serializable: `Date` becomes an ISO string and no closures are
 * passed. `canManage` gates every mutating control in the editor.
 */
export default async function CanvasEditorPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await requireRole("canvas.view");

  const canvas = await ctx.db.canvas.findUnique({
    where: { id },
    include: {
      backgroundImage: { select: { storageKey: true } },
      panels: {
        orderBy: { zIndex: "asc" },
        include: {
          frames: {
            orderBy: { sortOrder: "asc" },
            include: {
              content: {
                include: {
                  clock: true,
                  picture: true,
                  video: true,
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
  if (!canvas) notFound();

  const assetRows = await ctx.db.mediaAsset.findMany({
    where: { archivedAt: null, status: "READY" },
    orderBy: { name: "asc" },
    select: { id: true, name: true, kind: true, thumbnailKey: true },
  });

  const keys = new Set<string>();
  for (const asset of assetRows) {
    if (asset.thumbnailKey) keys.add(asset.thumbnailKey);
  }
  const backgroundKey = canvas.backgroundImage?.storageKey ?? null;
  if (backgroundKey) keys.add(backgroundKey);

  const urlByKey = new Map<string, string>();
  await Promise.all(
    [...keys].map(async (key) => {
      urlByKey.set(key, await storage.createDownloadUrl(key, 3600));
    }),
  );

  const assets: CanvasEditorAsset[] = assetRows.map((asset) => ({
    id: asset.id,
    name: asset.name,
    kind: asset.kind,
    thumbnailUrl: asset.thumbnailKey
      ? urlByKey.get(asset.thumbnailKey) ?? null
      : null,
  }));

  const panels: PanelVM[] = canvas.panels.map((panel) => ({
    id: panel.id,
    name: panel.name,
    x: panel.x,
    y: panel.y,
    width: panel.width,
    height: panel.height,
    zIndex: panel.zIndex,
    noScroll: panel.noScroll,
    frames: panel.frames.map(
      (frame): FrameVM => ({
        id: frame.id,
        sortOrder: frame.sortOrder,
        durationSeconds: frame.durationSeconds,
        type: frame.type as FrameKind,
        locationScoped: frame.locationScoped,
        createdAt: frame.createdAt.toISOString(),
        content: frame.content
          ? serializeContent(frame.content)
          : null,
      }),
    ),
  }));

  const tree: CanvasTree = {
    id: canvas.id,
    name: canvas.name,
    width: canvas.width,
    height: canvas.height,
    backgroundColor: canvas.backgroundColor,
    backgroundImageUrl: backgroundKey
      ? urlByKey.get(backgroundKey) ?? null
      : null,
    revision: canvas.revision,
    panels,
  };

  const canManage = can(ctx.actor, "canvas.update");

  return (
    <div className="space-y-6">
      <PageHeader
        title={canvas.name}
        description="Arrange panels, then fill each with frames of media, text, and clocks."
      />
      <CanvasEditor tree={tree} assets={assets} canManage={canManage} />
    </div>
  );
}

type ContentRow = Prisma.ContentGetPayload<{
  include: {
    clock: true;
    picture: true;
    video: true;
    memo: true;
    web: true;
  };
}>;

/** Strip `contentId` / `organizationId` from each content sub-record so only the
 * fields the Task 13 editors read cross to the client. */
function serializeContent(content: ContentRow): FrameContentVM {
  return {
    id: content.id,
    name: content.name,
    clock: content.clock
      ? {
          type: content.clock.type,
          showDate: content.clock.showDate,
          showTime: content.clock.showTime,
          showSeconds: content.clock.showSeconds,
          label: content.clock.label,
          timeZone: content.clock.timeZone,
        }
      : null,
    picture: content.picture
      ? {
          mediaRef: content.picture.mediaRef,
          mode: content.picture.mode,
          mediaAssetId: content.picture.mediaAssetId,
        }
      : null,
    video: content.video
      ? {
          mediaRef: content.video.mediaRef,
          mediaAssetId: content.video.mediaAssetId,
        }
      : null,
    memo: content.memo ? { body: content.memo.body } : null,
    web: content.web ? { url: content.web.url } : null,
  };
}
