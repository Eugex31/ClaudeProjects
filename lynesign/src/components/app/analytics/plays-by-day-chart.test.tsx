import { render } from "@testing-library/react";
import { describe, it, expect } from "vitest";

import { PlaysByDayChart } from "@/components/app/analytics/plays-by-day-chart";

describe("PlaysByDayChart", () => {
  it("renders one titled bar per day and scales the busiest day tallest", () => {
    const { container } = render(
      <PlaysByDayChart
        byDay={[
          { date: "2026-08-01", plays: 2 },
          { date: "2026-08-02", plays: 0 },
          { date: "2026-08-03", plays: 5 },
        ]}
      />,
    );

    const rects = Array.from(container.querySelectorAll("rect"));
    expect(rects).toHaveLength(3);

    for (const rect of rects) {
      expect(rect.querySelector("title")).not.toBeNull();
    }

    const heightFor = (date: string): number => {
      const rect = rects.find((r) =>
        r.querySelector("title")?.textContent?.includes(date),
      );
      if (!rect) throw new Error(`no rect found for ${date}`);
      return Number(rect.getAttribute("height"));
    };

    expect(heightFor("2026-08-03")).toBeGreaterThan(heightFor("2026-08-01"));
    expect(heightFor("2026-08-01")).toBeGreaterThan(heightFor("2026-08-02"));

    const busiestTitle = rects
      .map((r) => r.querySelector("title")?.textContent ?? "")
      .find((t) => t.includes("2026-08-03"));
    expect(busiestTitle).toContain("2026-08-03");
    expect(busiestTitle).toContain("5 plays");
  });

  it("shows an empty message and no bars when every day is zero", () => {
    const { container, getByText } = render(
      <PlaysByDayChart
        byDay={[
          { date: "2026-08-01", plays: 0 },
          { date: "2026-08-02", plays: 0 },
        ]}
      />,
    );

    expect(getByText("No plays in this range.")).toBeTruthy();
    expect(container.querySelectorAll("rect")).toHaveLength(0);
  });
});
