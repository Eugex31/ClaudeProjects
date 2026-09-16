import { CalendarClock } from "lucide-react";

import { requireRole } from "@/lib/auth/context";
import { can } from "@/lib/rbac/can";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/empty-state";
import { ScheduleScreenPicker } from "@/components/app/schedule/schedule-screen-picker";
import { ScheduleWeekGrid } from "@/components/app/schedule/schedule-week-grid";

export const metadata = { title: "Schedule" };

/**
 * Schedule page for one screen in the active organization. It loads the screen
 * list for the picker, then the selected screen's applicable rules (archived
 * ones included, for a later archived toggle), its active and upcoming
 * campaigns for the overlay ribbon, and the org's live playlists and campaigns
 * for the rule dialog. Everything handed to the client is serialized here: rule
 * effective dates become "YYYY-MM-DD" strings or null and campaign timestamps
 * become ISO strings, so no Date object or function crosses the boundary. The
 * serialized props then feed the client `ScheduleWeekGrid`.
 */
export default async function SchedulePage({
  searchParams,
}: {
  searchParams: Promise<{ screen?: string }>;
}) {
  const ctx = await requireRole("schedule.view");
  const { screen: screenParam } = await searchParams;

  const screens = await ctx.db.screen.findMany({
    select: {
      id: true,
      name: true,
      location: { select: { id: true, name: true } },
    },
    orderBy: [{ location: { name: "asc" } }, { name: "asc" }],
  });

  if (screens.length === 0) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Schedule"
          description="Recurring weekly playback rules for this screen."
        />
        <EmptyState
          icon={CalendarClock}
          title="No screens yet"
          description="Add a screen to start building a schedule."
        />
      </div>
    );
  }

  const selected = screens.find((s) => s.id === screenParam) ?? screens[0];

  const rules = await ctx.db.scheduleRule.findMany({
    where: {
      OR: [
        { screens: { some: { screenId: selected.id } } },
        { locations: { some: { locationId: selected.location.id } } },
      ],
    },
    select: {
      id: true,
      name: true,
      enabled: true,
      archivedAt: true,
      daysOfWeek: true,
      startMinute: true,
      endMinute: true,
      effectiveFrom: true,
      effectiveUntil: true,
      playlist: { select: { id: true, name: true } },
      campaign: { select: { id: true, name: true } },
      screens: { select: { screenId: true } },
      locations: { select: { locationId: true } },
    },
    orderBy: [{ startMinute: "asc" }],
  });

  const now = new Date();
  const campaigns = await ctx.db.campaign.findMany({
    where: {
      enabled: true,
      archivedAt: null,
      endsAt: { gt: now },
      OR: [
        { screens: { some: { screenId: selected.id } } },
        { locations: { some: { locationId: selected.location.id } } },
      ],
    },
    select: { id: true, name: true, startsAt: true, endsAt: true },
    orderBy: [{ startsAt: "asc" }],
  });

  const [playlistOptions, campaignOptions] = await Promise.all([
    ctx.db.playlist.findMany({
      where: { archivedAt: null },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    ctx.db.campaign.findMany({
      where: { archivedAt: null },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  const canManage = can(ctx.actor, "schedule.update");
  const canDelete = can(ctx.actor, "schedule.delete");

  const toDay = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

  const serializedGridProps = {
    screenId: selected.id,
    rules: rules.map((rule) => ({
      id: rule.id,
      name: rule.name,
      enabled: rule.enabled,
      isArchived: rule.archivedAt !== null,
      daysOfWeek: rule.daysOfWeek,
      startMinute: rule.startMinute,
      endMinute: rule.endMinute,
      effectiveFrom: toDay(rule.effectiveFrom),
      effectiveUntil: toDay(rule.effectiveUntil),
      playlist: rule.playlist,
      campaign: rule.campaign,
      screenIds: rule.screens.map((s) => s.screenId),
      locationIds: rule.locations.map((l) => l.locationId),
    })),
    campaigns: campaigns.map((c) => ({
      id: c.id,
      name: c.name,
      startsAt: c.startsAt.toISOString(),
      endsAt: c.endsAt.toISOString(),
    })),
    playlistOptions,
    campaignOptions,
    canManage,
    canDelete,
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Schedule"
        description="Recurring weekly playback rules for this screen."
      />
      <ScheduleScreenPicker screens={screens} selectedId={selected.id} />
      <ScheduleWeekGrid {...serializedGridProps} />
    </div>
  );
}
