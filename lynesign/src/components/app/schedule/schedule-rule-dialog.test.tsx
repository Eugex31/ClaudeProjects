import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeAll } from "vitest";

import {
  ScheduleRuleDialog,
  type ScheduleRuleDialogProps,
} from "@/components/app/schedule/schedule-rule-dialog";
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

function props(
  overrides: Partial<ScheduleRuleDialogProps> = {},
): ScheduleRuleDialogProps {
  return {
    open: true,
    onOpenChange: vi.fn(),
    mode: "create",
    prefill: { daysOfWeek: [], startMinute: 540 },
    screenId: "screen-1",
    playlistOptions: [{ id: "p1", name: "Lobby Loop" }],
    campaignOptions: [{ id: "c1", name: "Fall Sale" }],
    locationOptions: [],
    canManage: true,
    canDelete: true,
    ...overrides,
  };
}

describe("ScheduleRuleDialog", () => {
  it("submits create with the expected payload", async () => {
    render(<ScheduleRuleDialog {...props()} />);

    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Morning" },
    });
    fireEvent.change(screen.getByLabelText("Playlist"), {
      target: { value: "p1" },
    });
    fireEvent.click(screen.getByLabelText("Monday"));
    fireEvent.click(screen.getByLabelText("Wednesday"));
    fireEvent.change(screen.getByLabelText("Start time"), {
      target: { value: "09:00" },
    });
    fireEvent.change(screen.getByLabelText("End time"), {
      target: { value: "12:00" },
    });
    fireEvent.click(screen.getByRole("button", { name: /create rule/i }));

    await waitFor(() => {
      expect(actions.createScheduleRule).toHaveBeenCalledWith({
        name: "Morning",
        playlistId: "p1",
        daysOfWeek: [1, 3],
        startMinute: 540,
        endMinute: 720,
        screenIds: ["screen-1"],
        locationIds: [],
      });
    });
  });

  it("submits create with an end time of 24:00 as endMinute 1440", async () => {
    render(<ScheduleRuleDialog {...props()} />);

    fireEvent.change(screen.getByLabelText("Playlist"), {
      target: { value: "p1" },
    });
    fireEvent.click(screen.getByLabelText("Monday"));
    fireEvent.change(screen.getByLabelText("Start time"), {
      target: { value: "23:00" },
    });
    fireEvent.change(screen.getByLabelText("End time"), {
      target: { value: "24:00" },
    });
    fireEvent.click(screen.getByRole("button", { name: /create rule/i }));

    await waitFor(() => {
      expect(actions.createScheduleRule).toHaveBeenCalledWith({
        playlistId: "p1",
        daysOfWeek: [1],
        startMinute: 1380,
        endMinute: 1440,
        screenIds: ["screen-1"],
        locationIds: [],
      });
    });
  });

  it("prefills the fields from the rule in edit mode", () => {
    render(
      <ScheduleRuleDialog
        {...props({
          mode: "edit",
          prefill: null,
          rule: {
            id: "r1",
            name: "Evening",
            enabled: true,
            isArchived: false,
            daysOfWeek: [1, 2],
            startMinute: 600,
            endMinute: 900,
            effectiveFrom: null,
            effectiveUntil: null,
            playlist: { id: "p1", name: "Lobby Loop" },
            campaign: null,
            screenIds: ["screen-1"],
            locationIds: [],
          },
          canDelete: false,
        })}
      />,
    );

    expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe(
      "Evening",
    );
    expect(
      (screen.getByLabelText("Start time") as HTMLInputElement).value,
    ).toBe("10:00");
    expect((screen.getByLabelText("End time") as HTMLInputElement).value).toBe(
      "15:00",
    );
    expect((screen.getByLabelText("Monday") as HTMLInputElement).checked).toBe(
      true,
    );
    expect((screen.getByLabelText("Tuesday") as HTMLInputElement).checked).toBe(
      true,
    );
    expect(
      (screen.getByLabelText("Wednesday") as HTMLInputElement).checked,
    ).toBe(false);
  });

  it("hides the Delete button when the caller cannot delete", () => {
    render(
      <ScheduleRuleDialog
        {...props({
          mode: "edit",
          prefill: null,
          canDelete: false,
          rule: {
            id: "r1",
            name: "Evening",
            enabled: true,
            isArchived: false,
            daysOfWeek: [1, 2],
            startMinute: 600,
            endMinute: 900,
            effectiveFrom: null,
            effectiveUntil: null,
            playlist: { id: "p1", name: "Lobby Loop" },
            campaign: null,
            screenIds: ["screen-1"],
            locationIds: [],
          },
        })}
      />,
    );

    expect(screen.queryByRole("button", { name: /delete rule/i })).toBeNull();
  });
});
