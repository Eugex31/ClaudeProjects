import { render, fireEvent } from "@testing-library/react";
import { describe, it, expect } from "vitest";

import { ContentPerformanceTable } from "@/components/app/analytics/content-performance-table";
import { playHours } from "@/lib/analytics/shape";

const rows = [
  {
    mediaAssetId: "a1",
    assetName: "Alpha",
    kind: "image",
    plays: 30,
    playSeconds: 45000,
    screensReached: 2,
    lastAiredAt: "2026-08-20T10:00:00.000Z",
  },
  {
    mediaAssetId: "a2",
    assetName: "Bravo",
    kind: null,
    plays: 10,
    playSeconds: 3600,
    screensReached: 9,
    lastAiredAt: "2026-08-21T10:00:00.000Z",
  },
  {
    mediaAssetId: "a3",
    assetName: "Charlie",
    kind: "video",
    plays: 20,
    playSeconds: 7200,
    screensReached: 5,
    lastAiredAt: "2026-08-22T10:00:00.000Z",
  },
];

function assetOrder(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll("tbody tr")).map(
    (tr) => tr.querySelector("td")?.textContent ?? "",
  );
}

describe("ContentPerformanceTable", () => {
  it("defaults to Plays descending", () => {
    const { container } = render(<ContentPerformanceTable rows={rows} />);
    expect(assetOrder(container)).toEqual(["Alpha", "Charlie", "Bravo"]);
  });

  it("sorts by Screens on header click, flipping direction on a second click", () => {
    const { container, getByText } = render(
      <ContentPerformanceTable rows={rows} />,
    );

    fireEvent.click(getByText("Screens"));
    expect(assetOrder(container)).toEqual(["Bravo", "Charlie", "Alpha"]);

    fireEvent.click(getByText("Screens"));
    expect(assetOrder(container)).toEqual(["Alpha", "Charlie", "Bravo"]);
  });

  it("formats Play hours and shows a dash for a null kind", () => {
    const { container } = render(<ContentPerformanceTable rows={rows} />);

    expect(container.textContent ?? "").toContain(playHours(45000));

    const bravoRow = Array.from(container.querySelectorAll("tbody tr")).find(
      (tr) => tr.textContent?.includes("Bravo"),
    );
    expect(bravoRow?.children[1].textContent).toBe("-");
  });
});
