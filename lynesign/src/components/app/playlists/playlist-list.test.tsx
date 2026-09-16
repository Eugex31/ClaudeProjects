import { render } from "@testing-library/react";
import { describe, it, expect } from "vitest";

import { PlaylistList } from "@/components/app/playlists/playlist-list";

const rows = [
  { id: "p1", name: "Lobby Loop", itemCount: 3, screenCount: 2, updatedLabel: "2 days ago" },
  { id: "p2", name: "Menu Rotation", itemCount: 1, screenCount: 0, updatedLabel: "1 hour ago" },
];

describe("PlaylistList", () => {
  it("renders a row per playlist with name, item count and screen count", () => {
    const { getByText, getAllByRole } = render(<PlaylistList rows={rows} />);

    expect(getByText("Lobby Loop")).toBeTruthy();
    expect(getByText("Menu Rotation")).toBeTruthy();

    expect(getByText("3 items")).toBeTruthy();
    expect(getByText("1 item")).toBeTruthy();

    expect(getByText("on 2 screens")).toBeTruthy();
    expect(getByText("on 0 screens")).toBeTruthy();

    const links = getAllByRole("link");
    expect(links.map((a) => a.getAttribute("href"))).toEqual([
      "/playlists/p1",
      "/playlists/p2",
    ]);
  });
});
