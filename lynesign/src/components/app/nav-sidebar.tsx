"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  CalendarClock,
  ChartColumn,
  CreditCard,
  Images,
  LayoutDashboard,
  LayoutGrid,
  ListVideo,
  MapPin,
  Megaphone,
  MonitorPlay,
  Settings,
  Users,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import type { NavItem } from "@/lib/nav";

const ICONS: Record<string, LucideIcon> = {
  dashboard: LayoutDashboard,
  screens: MonitorPlay,
  locations: MapPin,
  media: Images,
  playlists: ListVideo,
  canvas: LayoutGrid,
  campaigns: Megaphone,
  schedule: CalendarClock,
  analytics: ChartColumn,
  users: Users,
  billing: CreditCard,
  settings: Settings,
};

export interface NavSidebarProps {
  items: NavItem[];
  /** Called after a link is chosen, so the mobile drawer can close itself. */
  onNavigate?: () => void;
  className?: string;
}

function isActive(pathname: string | null, href: string): boolean {
  if (!pathname) return false;
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * Vertical list of {@link NavItem} links with their icon and active styling.
 * Shared by the `lg+` fixed sidebar and the below-`lg` `Sheet` drawer.
 */
export function NavSidebar({ items, onNavigate, className }: NavSidebarProps) {
  const pathname = usePathname();

  return (
    <nav aria-label="Primary" className={cn("flex flex-col gap-1", className)}>
      {items.map((item) => {
        const Icon = ICONS[item.icon] ?? LayoutDashboard;
        const active = isActive(pathname, item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex items-center gap-3 rounded-btn px-3 py-2 text-sm font-medium transition-colors",
              active
                ? "bg-navy text-white"
                : "text-body hover:bg-canvas hover:text-ink",
            )}
          >
            <Icon className="size-4 shrink-0" aria-hidden />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
