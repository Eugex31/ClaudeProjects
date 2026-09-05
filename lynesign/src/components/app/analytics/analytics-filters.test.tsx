import { render, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

import { AnalyticsFilters } from "@/components/app/analytics/analytics-filters";

const push = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

const locations = [
  { id: "loc1", name: "Head Office" },
  { id: "loc2", name: "Warehouse" },
];

const screens = [
  { id: "s1", name: "Lobby", location: { id: "loc1", name: "Head Office" } },
  { id: "s2", name: "Cafe", location: { id: "loc1", name: "Head Office" } },
  { id: "s3", name: "Entrance", location: { id: "loc2", name: "Warehouse" } },
];

beforeEach(() => {
  push.mockClear();
});

describe("AnalyticsFilters", () => {
  it("shows the from and to values on the date inputs", () => {
    const { getByLabelText } = render(
      <AnalyticsFilters
        from="2026-08-01"
        to="2026-08-31"
        screens={screens}
        locations={locations}
      />,
    );

    expect((getByLabelText("From") as HTMLInputElement).value).toBe(
      "2026-08-01",
    );
    expect((getByLabelText("To") as HTMLInputElement).value).toBe("2026-08-31");
  });

  it("groups the screen options into one optgroup per location", () => {
    const { getByLabelText } = render(
      <AnalyticsFilters
        from="2026-08-01"
        to="2026-08-31"
        screens={screens}
        locations={locations}
      />,
    );

    const select = getByLabelText("Screen") as HTMLSelectElement;
    const groups = Array.from(select.querySelectorAll("optgroup"));
    expect(groups.map((g) => g.getAttribute("label"))).toEqual([
      "Head Office",
      "Warehouse",
    ]);
  });

  it("pushes the new from value while preserving to, with no location or screen keys", () => {
    const { getByLabelText } = render(
      <AnalyticsFilters
        from="2026-08-01"
        to="2026-08-31"
        screens={screens}
        locations={locations}
      />,
    );

    fireEvent.change(getByLabelText("From"), { target: { value: "2026-08-10" } });

    expect(push).toHaveBeenCalledWith("/analytics?from=2026-08-10&to=2026-08-31");
  });

  it("pushes the selected location while preserving from and to", () => {
    const { getByLabelText } = render(
      <AnalyticsFilters
        from="2026-08-01"
        to="2026-08-31"
        screens={screens}
        locations={locations}
      />,
    );

    fireEvent.change(getByLabelText("Location"), { target: { value: "loc2" } });

    expect(push).toHaveBeenCalledWith(
      "/analytics?from=2026-08-01&to=2026-08-31&location=loc2",
    );
  });
});
