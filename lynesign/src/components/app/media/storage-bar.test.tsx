import { render } from "@testing-library/react";
import { describe, it, expect } from "vitest";

import { StorageBar } from "@/components/app/media/storage-bar";

describe("StorageBar", () => {
  it("shows the percentage and an amber fill when usage is at or above 80 percent", () => {
    const { getByText, container } = render(
      <StorageBar used="9000000000" limit="10000000000" />,
    );

    expect(getByText("90%")).toBeTruthy();
    expect(container.querySelector(".bg-amber-500")).toBeTruthy();
    expect(container.querySelector(".bg-red-500")).toBeNull();
  });

  it("renders Unlimited and no progress track when there is no limit", () => {
    const { getByText, container } = render(
      <StorageBar used="9000000000" limit={null} />,
    );

    expect(getByText("Unlimited")).toBeTruthy();
    expect(container.querySelector('[data-slot="storage-bar-track"]')).toBeNull();
  });

  it("renders a red fill and an over indicator when usage exceeds the limit", () => {
    const { getByText, container } = render(
      <StorageBar used="11000000000" limit="10000000000" />,
    );

    expect(container.querySelector(".bg-red-500")).toBeTruthy();
    expect(getByText("over")).toBeTruthy();
  });
});
