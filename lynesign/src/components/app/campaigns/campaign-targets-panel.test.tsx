import { render, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeAll } from "vitest";

import {
  CampaignTargetsPanel,
  type CampaignTargetsPanelProps,
} from "@/components/app/campaigns/campaign-targets-panel";
import * as actions from "@/app/(app)/campaigns/actions";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

vi.mock("@/app/(app)/campaigns/actions", () => ({
  setCampaignTargets: vi.fn(async () => ({})),
}));

beforeAll(() => {
  const proto = window.Element.prototype as unknown as Record<string, unknown>;
  proto.scrollIntoView = vi.fn();
  proto.hasPointerCapture = vi.fn(() => false);
  proto.releasePointerCapture = vi.fn();
});

function renderPanel(overrides: Partial<CampaignTargetsPanelProps> = {}) {
  const props: CampaignTargetsPanelProps = {
    campaignId: "campaign-1",
    screens: [
      { id: "s1", name: "Screen A", locationId: "loc1", locationName: "Warehouse" },
    ],
    locations: [{ id: "loc1", name: "Warehouse" }],
    targetedScreenIds: ["s1"],
    targetedLocationIds: [],
    canUpdate: true,
    ...overrides,
  };
  return render(<CampaignTargetsPanel {...props} />);
}

describe("CampaignTargetsPanel", () => {
  it("rolls the checkbox back when setCampaignTargets rejects", async () => {
    vi.mocked(actions.setCampaignTargets).mockResolvedValueOnce({
      error: "Choose at least one screen or location.",
    });
    const toast = (await import("sonner")).toast;

    const { getByLabelText } = renderPanel();
    const box = getByLabelText("Target Screen A");
    expect(box.getAttribute("aria-checked")).toBe("true");

    fireEvent.click(box);

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(
        "Choose at least one screen or location.",
      );
    });
    await waitFor(() => {
      expect(
        getByLabelText("Target Screen A").getAttribute("aria-checked"),
      ).toBe("true");
    });
  });
});
