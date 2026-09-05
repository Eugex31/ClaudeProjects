import { render } from "@testing-library/react";
import { describe, it, expect } from "vitest";

import { CampaignList } from "@/components/app/campaigns/campaign-list";

const rows = [
  {
    id: "c1",
    name: "Fall Sale",
    playlistName: "Promos",
    windowLabel: "1 Sep to 15 Sep",
    status: "Active",
    targetLabel: "3 screens, 1 location",
    priority: 10,
  },
  {
    id: "c2",
    name: "Holiday",
    playlistName: "Xmas",
    windowLabel: "1 Dec to 5 Jan",
    status: "Scheduled",
    targetLabel: "1 screen",
    priority: 0,
  },
];

describe("CampaignList", () => {
  it("renders a row per campaign with name, playlist, status, target and priority", () => {
    const { getByText, getAllByRole } = render(<CampaignList rows={rows} />);

    expect(getByText("Fall Sale")).toBeTruthy();
    expect(getByText("Holiday")).toBeTruthy();

    expect(getByText("Promos")).toBeTruthy();
    expect(getByText("Xmas")).toBeTruthy();

    expect(getByText("Active")).toBeTruthy();
    expect(getByText("Scheduled")).toBeTruthy();

    expect(getByText("3 screens, 1 location")).toBeTruthy();
    expect(getByText("1 screen")).toBeTruthy();

    expect(getByText("Priority 10")).toBeTruthy();
    expect(getByText("Priority 0")).toBeTruthy();

    const links = getAllByRole("link");
    expect(links.map((a) => a.getAttribute("href"))).toEqual([
      "/campaigns/c1",
      "/campaigns/c2",
    ]);
  });
});
