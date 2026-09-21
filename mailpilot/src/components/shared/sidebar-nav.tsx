"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard,
  Users,
  Send,
  FileText,
  Workflow,
  Mail,
  BarChart3,
  Plug,
  ScrollText,
  Settings,
  CreditCard,
  Sparkles,
  Share2,
  UsersRound,
  type LucideIcon,
} from "lucide-react";

type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  requiresProfiles?: boolean;
  hideWhileActing?: boolean;
};

// Grouped by what a customer is actually doing — the sending workflow
// they're in day to day vs. account/admin concerns they visit occasionally.
// Previously one flat, undifferentiated 11-item list with no hierarchy.
const NAV_GROUPS: { label: string; items: NavItem[] }[] = [
  {
    label: "Send",
    items: [
      { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
      { href: "/campaign-wizard", label: "AI Campaign Wizard", icon: Sparkles },
      { href: "/contacts", label: "Contacts", icon: Users },
      { href: "/campaigns", label: "Campaigns", icon: Send },
      { href: "/sequences", label: "Sequences", icon: Workflow },
      { href: "/templates", label: "Templates", icon: FileText },
      { href: "/newsletters", label: "Newsletters", icon: Mail },
      { href: "/social", label: "Social", icon: Share2 },
      { href: "/reports", label: "Reports", icon: BarChart3 },
    ],
  },
  {
    label: "Account",
    items: [
      { href: "/ai-connections", label: "AI Connections", icon: Sparkles },
      { href: "/integrations", label: "Integrations", icon: Plug },
      { href: "/logs", label: "Logs", icon: ScrollText },
      // Profiles/Billing are agency-level concerns — filtered out below
      // whenever the plan doesn't include profiles, or while acting as one
      // (a managed client can't itself manage profiles or billing).
      { href: "/profiles", label: "Profiles", icon: UsersRound, requiresProfiles: true, hideWhileActing: true },
      { href: "/billing", label: "Billing", icon: CreditCard, hideWhileActing: true },
      { href: "/settings", label: "Settings", icon: Settings },
    ],
  },
];

export function SidebarNav({
  showProfiles = false,
  isActingAsProfile = false,
}: {
  showProfiles?: boolean;
  isActingAsProfile?: boolean;
}) {
  const pathname = usePathname();
  const groups = NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => {
      if (item.requiresProfiles && !showProfiles) return false;
      if (item.hideWhileActing && isActingAsProfile) return false;
      return true;
    }),
  }));

  return (
    <nav className="flex flex-col gap-4 p-3">
      {groups.map((group) => (
        <div key={group.label} className="flex flex-col gap-1">
          <p className="px-3 pb-1 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
            {group.label}
          </p>
          {group.items.map((item) => {
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-3 rounded-md border-l-2 px-3 py-2 text-sm font-medium transition-colors",
                  active
                    ? "border-l-[#DDA974] bg-primary text-primary-foreground"
                    : "border-l-transparent text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                )}
              >
                <Icon className="size-4" />
                {item.label}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
