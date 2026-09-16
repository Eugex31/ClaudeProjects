import { render } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { StatusDot } from "@/components/app/status-dot";

describe("StatusDot", () => {
  it("always shows a text label alongside the color", () => {
    const { getByText } = render(<StatusDot status="OFFLINE" />);
    expect(getByText("Offline")).toBeTruthy();
  });

  it("labels every status with a word, not only a color", () => {
    const cases: Array<[Parameters<typeof StatusDot>[0]["status"], string]> = [
      ["ONLINE", "Online"],
      ["OFFLINE", "Offline"],
      ["UNPAIRED", "Unpaired"],
      ["DISABLED", "Disabled"],
    ];
    for (const [status, label] of cases) {
      const { getByText } = render(<StatusDot status={status} />);
      expect(getByText(label)).toBeTruthy();
    }
  });
});
