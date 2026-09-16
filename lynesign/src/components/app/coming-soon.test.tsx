import { render } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { ComingSoon } from "@/components/app/coming-soon";

describe("ComingSoon", () => {
  it("renders the feature name and a plain sentence", () => {
    const { getByText, container } = render(
      <ComingSoon
        feature="Media"
        description="upload and organize your images and videos"
      />
    );
    expect(getByText("Media")).toBeTruthy();
    expect(container.textContent).not.toMatch(/!/);
  });

  it("builds the coming-in-a-later-release sentence from the description", () => {
    const { container } = render(
      <ComingSoon feature="Playlists" description="group screens into playlists" />
    );
    expect(container.textContent).toContain(
      "This is where you will group screens into playlists. It is coming in a later release."
    );
  });
});
