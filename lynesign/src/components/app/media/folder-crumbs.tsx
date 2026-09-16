"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ChevronRight } from "lucide-react";

import { cn } from "@/lib/utils";

export interface Crumb {
  id: string;
  name: string;
}

export interface FolderCrumbsProps {
  /** Ancestors from root to the current folder's parent, then the current folder last. */
  crumbs: Crumb[];
  className?: string;
}

/**
 * Breadcrumb trail for the media library. "All media" links to the folder root;
 * every other crumb links to `/media?folder=<id>` while preserving the current
 * search, kind and sort params. The last crumb is the current folder and is not
 * a link.
 */
export function FolderCrumbs({ crumbs, className }: FolderCrumbsProps) {
  const params = useSearchParams();

  function hrefFor(folderId: string | null): string {
    const next = new URLSearchParams(params.toString());
    if (folderId) next.set("folder", folderId);
    else next.delete("folder");
    next.delete("page");
    const qs = next.toString();
    return qs ? `/media?${qs}` : "/media";
  }

  return (
    <nav
      aria-label="Folder path"
      className={cn("flex flex-wrap items-center gap-1 text-sm", className)}
    >
      {crumbs.length === 0 ? (
        <span className="font-medium text-ink">All media</span>
      ) : (
        <Link href={hrefFor(null)} className="text-body hover:text-ink hover:underline">
          All media
        </Link>
      )}
      {crumbs.map((crumb, index) => {
        const isLast = index === crumbs.length - 1;
        return (
          <span key={crumb.id} className="flex items-center gap-1">
            <ChevronRight aria-hidden className="size-3.5 text-muted-foreground" />
            {isLast ? (
              <span className="font-medium text-ink">{crumb.name}</span>
            ) : (
              <Link
                href={hrefFor(crumb.id)}
                className="text-body hover:text-ink hover:underline"
              >
                {crumb.name}
              </Link>
            )}
          </span>
        );
      })}
    </nav>
  );
}
