import { render, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

import { ScheduleScreenPicker } from "@/components/app/schedule/schedule-screen-picker";

const push = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

const screens = [
  { id: "s1", name: "Lobby", location: { id: "loc1", name: "Head Office" } },
  { id: "s2", name: "Cafe", location: { id: "loc1", name: "Head Office" } },
  { id: "s3", name: "Entrance", location: { id: "loc2", name: "Warehouse" } },
  { id: "s4", name: "Dock", location: { id: "loc2", name: "Warehouse" } },
];

beforeEach(() => {
  push.mockClear();
});

describe("ScheduleScreenPicker", () => {
  it("groups the options into one optgroup per location", () => {
    const { container } = render(
      <ScheduleScreenPicker screens={screens} selectedId="s1" />,
    );

    const groups = Array.from(container.querySelectorAll("optgroup"));
    expect(groups.map((g) => g.getAttribute("label"))).toEqual([
      "Head Office",
      "Warehouse",
    ]);

    expect(
      Array.from(groups[0].querySelectorAll("option")).map((o) => ({
        value: o.getAttribute("value"),
        label: o.textContent,
      })),
    ).toEqual([
      { value: "s1", label: "Lobby" },
      { value: "s2", label: "Cafe" },
    ]);
    expect(
      Array.from(groups[1].querySelectorAll("option")).map((o) => ({
        value: o.getAttribute("value"),
        label: o.textContent,
      })),
    ).toEqual([
      { value: "s3", label: "Entrance" },
      { value: "s4", label: "Dock" },
    ]);
  });

  it("reflects the selected screen as the select value", () => {
    const { getByLabelText } = render(
      <ScheduleScreenPicker screens={screens} selectedId="s3" />,
    );

    expect((getByLabelText("Screen") as HTMLSelectElement).value).toBe("s3");
  });

  it("pushes /schedule?screen=<id> when a different screen is chosen", () => {
    const { getByLabelText } = render(
      <ScheduleScreenPicker screens={screens} selectedId="s1" />,
    );

    fireEvent.change(getByLabelText("Screen"), { target: { value: "s3" } });

    expect(push).toHaveBeenCalledWith("/schedule?screen=s3");
  });
});
