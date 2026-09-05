import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeAll } from "vitest";

import {
  ScheduleWeekGrid,
  type ScheduleWeekGridProps,
} from "@/components/app/schedule/schedule-week-grid";
import * as actions from "@/app/(app)/schedule/actions";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

vi.mock("@/app/(app)/schedule/actions", () => ({
  createScheduleRule: vi.fn(async () => ({ id: "new-rule" })),
  updateScheduleRule: vi.fn(async () => ({ id: "r1" })),
  setScheduleRuleTargets: vi.fn(async () => ({ id: "r1" })),
  setScheduleRuleEnabled: vi.fn(async () => ({ id: "r1" })),
  archiveScheduleRule: vi.fn(async () => ({ ok: true })),
  restoreScheduleRule: vi.fn(async () => ({ ok: true })),
  deleteScheduleRule: vi.fn(async () => ({ ok: true })),
}));

beforeAll(() => {
  const proto = window.Element.prototype as unknown as Record<string, unknown>;
  proto.scrollIntoView = vi.fn();
  proto.hasPointerCapture = vi.fn(() => false);
  proto.releasePointerCapture = vi.fn();
  if (!("ResizeObserver" in window)) {
    (window as unknown as Record<string, unknown>).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
});

function baseProps(
  overrides: Partial<ScheduleWeekGridProps> = {},
): ScheduleWeekGridProps {
  return {
    screenId: "screen-1",
    rules: [
      {
        id: "r1",
        name: null,
        enabled: true,
        isArchived: false,
        daysOfWeek: [1, 2, 3, 4, 5],
        startMinute: 540,
        endMinute: 1020,
        effectiveFrom: null,
        effectiveUntil: null,
        playlist: { id: "p1", name: "Lobby Loop" },
        campaign: null,
        screenIds: ["screen-1"],
        locationIds: [],
      },
    ],
    campaigns: [
      {
        id: "c1",
        name: "Fall Sale",
        startsAt: "2026-09-01T00:00:00.000Z",
        endsAt: "2026-12-01T00:00:00.000Z",
      },
    ],
    playlistOptions: [{ id: "p1", name: "Lobby Loop" }],
    campaignOptions: [{ id: "c1", name: "Fall Sale" }],
    canManage: true,
    canDelete: true,
    ...overrides,
  };
}

describe("ScheduleWeekGrid", () => {
  it("renders one block per weekday for a Mon-Fri rule with name and time label", () => {
    render(<ScheduleWeekGrid {...baseProps()} />);

    const blocks = document.querySelectorAll("[data-rule-block]");
    expect(blocks.length).toBe(5);
    expect(screen.getAllByText("Lobby Loop")).toHaveLength(5);
    expect(screen.getAllByText("09:00 to 17:00")).toHaveLength(5);
  });

  it("renders a single full-width campaign ribbon linking to the campaign", () => {
    render(<ScheduleWeekGrid {...baseProps()} />);

    const ribbons = screen.getAllByTestId("campaign-ribbon");
    expect(ribbons).toHaveLength(1);
    const link = screen.getByRole("link", { name: "Fall Sale" });
    expect(link.getAttribute("href")).toBe("/campaigns/c1");
  });

  it("renders no campaign ribbon when there are no campaigns", () => {
    render(<ScheduleWeekGrid {...baseProps({ campaigns: [] })} />);
    expect(screen.queryByTestId("campaign-ribbon")).toBeNull();
  });

  it("opens the create dialog prefilled when an empty cell is clicked", async () => {
    render(<ScheduleWeekGrid {...baseProps()} />);

    fireEvent.click(
      screen.getByLabelText("Add a rule on Tuesday at 10:00"),
    );

    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeTruthy();
    });
    const tuesday = screen.getByLabelText("Tuesday") as HTMLInputElement;
    expect(tuesday.checked).toBe(true);
    const start = screen.getByLabelText("Start time") as HTMLInputElement;
    expect(start.value).toBe("10:00");
  });

  it("does not make cells interactive when the caller cannot manage", () => {
    render(<ScheduleWeekGrid {...baseProps({ canManage: false })} />);
    expect(
      screen.queryByLabelText("Add a rule on Tuesday at 10:00"),
    ).toBeNull();
  });

  it("shows the error when a restore fails", async () => {
    vi.mocked(actions.restoreScheduleRule).mockResolvedValueOnce({
      error: "That would overlap another rule.",
    });

    render(
      <ScheduleWeekGrid
        {...baseProps({
          rules: [
            {
              id: "r-archived",
              name: null,
              enabled: true,
              isArchived: true,
              daysOfWeek: [1],
              startMinute: 540,
              endMinute: 600,
              effectiveFrom: null,
              effectiveUntil: null,
              playlist: { id: "p1", name: "Lobby Loop" },
              campaign: null,
              screenIds: ["screen-1"],
              locationIds: [],
            },
          ],
        })}
      />,
    );

    fireEvent.click(screen.getByLabelText("Show archived"));
    fireEvent.click(screen.getByRole("button", { name: /restore/i }));

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain(
        "That would overlap another rule.",
      );
    });
  });
});
