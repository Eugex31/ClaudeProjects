import { formatDistanceToNow } from "date-fns";
import type { Prisma } from "@prisma/client";

import { requireRole } from "@/lib/auth/context";
import { can } from "@/lib/rbac/can";
import { withOrgTransaction } from "@/lib/db/tenant";
import { getStorageUsage } from "@/lib/plan-limits";
import { storage } from "@/lib/storage";
import { PageHeader } from "@/components/app/page-header";
import { StorageBar } from "@/components/app/media/storage-bar";
import { MediaLibrary } from "@/components/app/media/media-library";
import type { MediaCardAsset } from "@/components/app/media/media-card";
import type { FolderOption } from "@/components/app/media/move-to-folder-dialog";
import type { Crumb } from "@/components/app/media/folder-crumbs";
import type { ChildFolder } from "@/components/app/media/media-library";

export const metadata = { title: "Media" };

const PAGE_SIZE = 24;

const SORT_ORDER: Record<string, Prisma.MediaAssetOrderByWithRelationInput> = {
  newest: { createdAt: "desc" },
  oldest: { createdAt: "asc" },
  name: { name: "asc" },
  name_desc: { name: "desc" },
  largest: { sizeBytes: "desc" },
};

function first(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

/**
 * Media library for the active organization. One `withOrgTransaction` loads the
 * current folder and its ancestor chain, the child folders, one page of assets,
 * and the full folder list for the move dialog; `getStorageUsage` runs beside it
 * on its own scoped transaction. Everything handed to {@link MediaLibrary} is
 * serializable: bigints become strings, dates become relative-time labels, and
 * thumbnails are pre-signed here so the grid never fans out one request per card.
 */
export default async function MediaPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireRole("media.view");
  const sp = await searchParams;

  const folderParam = first(sp.folder) || null;
  const q = first(sp.q).trim();
  const kindParam = first(sp.kind).toUpperCase();
  const kind =
    kindParam === "IMAGE" || kindParam === "VIDEO" || kindParam === "WEB"
      ? (kindParam as MediaCardAsset["kind"])
      : null;
  const sortParam = first(sp.sort);
  const sort = Object.hasOwn(SORT_ORDER, sortParam) ? sortParam : "newest";
  const pageRaw = Number.parseInt(first(sp.page), 10);
  const page = Number.isFinite(pageRaw) && pageRaw > 1 ? pageRaw : 1;

  const where: Prisma.MediaAssetWhereInput = {
    archivedAt: null,
    ...(kind ? { kind } : {}),
    ...(q
      ? {
          OR: [
            { name: { contains: q, mode: "insensitive" as const } },
            { tags: { has: q } },
          ],
        }
      : {}),
  };

  const [data, usage] = await Promise.all([
    withOrgTransaction(ctx.organizationId, async (tx) => {
      const currentFolder = folderParam
        ? await tx.mediaFolder.findUnique({ where: { id: folderParam } })
        : null;
      const currentFolderId = currentFolder?.id ?? null;

      const ancestors: Crumb[] = [];
      if (currentFolder) {
        let cursor: { id: string; name: string; parentId: string | null } | null =
          currentFolder;
        const guard = new Set<string>();
        while (cursor && !guard.has(cursor.id)) {
          guard.add(cursor.id);
          ancestors.unshift({ id: cursor.id, name: cursor.name });
          cursor = cursor.parentId
            ? await tx.mediaFolder.findUnique({ where: { id: cursor.parentId } })
            : null;
        }
      }

      const childFolders = await tx.mediaFolder.findMany({
        where: { parentId: currentFolderId },
        orderBy: { name: "asc" },
        select: {
          id: true,
          name: true,
          _count: {
            select: { assets: { where: { archivedAt: null } }, children: true },
          },
        },
      });

      const rows = await tx.mediaAsset.findMany({
        where: { ...where, folderId: currentFolderId },
        orderBy: SORT_ORDER[sort],
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE + 1,
        include: { _count: { select: { pictures: true, videos: true } } },
      });

      const allFolders = await tx.mediaFolder.findMany({
        orderBy: { name: "asc" },
        select: { id: true, name: true, parentId: true },
      });

      return { currentFolderId, ancestors, childFolders, rows, allFolders };
    }),
    getStorageUsage(ctx.organizationId),
  ]);

  const hasMore = data.rows.length > PAGE_SIZE;
  const visible = hasMore ? data.rows.slice(0, PAGE_SIZE) : data.rows;

  const assets: MediaCardAsset[] = await Promise.all(
    visible.map(async (row) => ({
      id: row.id,
      name: row.name,
      kind: row.kind,
      status: row.status,
      sizeBytes: row.sizeBytes.toString(),
      mimeType: row.mimeType,
      thumbnailUrl: row.thumbnailKey
        ? await storage.createDownloadUrl(row.thumbnailKey, 3600)
        : null,
      width: row.width,
      height: row.height,
      durationSeconds: row.durationSeconds,
      url: row.url,
      tags: row.tags,
      usedCount: row._count.pictures + row._count.videos,
      createdAtLabel: formatDistanceToNow(row.createdAt, { addSuffix: true }),
    })),
  );

  const childFolders: ChildFolder[] = data.childFolders.map((folder) => ({
    id: folder.id,
    name: folder.name,
    assetCount: folder._count.assets,
    subfolderCount: folder._count.children,
  }));

  const allFolders: FolderOption[] = flattenFolders(data.allFolders);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Media"
        description="Upload images and videos, add web pages, and organize everything into folders."
      />

      <StorageBar
        used={usage.usedBytes.toString()}
        limit={usage.limitBytes === null ? null : usage.limitBytes.toString()}
      />

      <MediaLibrary
        currentFolderId={data.currentFolderId}
        crumbs={data.ancestors}
        childFolders={childFolders}
        assets={assets}
        allFolders={allFolders}
        query={{ q, kind: kind ?? "", sort, page, hasMore }}
        canCreate={can(ctx.actor, "media.create")}
        canUpdate={can(ctx.actor, "media.update")}
        canDelete={can(ctx.actor, "media.delete")}
        canManageFolders={can(ctx.actor, "media.folder.manage")}
      />
    </div>
  );
}

/**
 * Depth-first flatten of the folder forest into an indented option list for the
 * move dialog. Roots (and any folder whose parent is not in the set) are ordered
 * by the name sort they arrived in.
 */
function flattenFolders(
  folders: Array<{ id: string; name: string; parentId: string | null }>,
): FolderOption[] {
  const byParent = new Map<string | null, Array<{ id: string; name: string }>>();
  const known = new Set(folders.map((f) => f.id));
  for (const folder of folders) {
    const key = folder.parentId && known.has(folder.parentId) ? folder.parentId : null;
    const bucket = byParent.get(key) ?? [];
    bucket.push({ id: folder.id, name: folder.name });
    byParent.set(key, bucket);
  }

  const out: FolderOption[] = [];
  const walk = (parentId: string | null, depth: number) => {
    for (const folder of byParent.get(parentId) ?? []) {
      out.push({ id: folder.id, name: folder.name, depth });
      walk(folder.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}
