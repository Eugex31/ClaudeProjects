import { render, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeAll } from "vitest";

import {
  CampaignEditor,
  type CampaignEditorProps,
} from "@/components/app/campaigns/campaign-editor";
import * as actions from "@/app/(app)/campaigns/actions";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

vi.mock("@/app/(app)/campaigns/actions", () => ({
  updateCampaign: vi.fn(async () => ({})),
  setCampaignEnabled: vi.fn(async () => ({})),
  deleteCampaign: vi.fn(async () => ({})),
  archiveCampaign: vi.fn(async () => ({})),
  restoreCampaign: vi.fn(async () => ({})),
  setCampaignTargets: vi.fn(async () => ({})),
}));

beforeAll(() => {
  const proto = window.Element.prototype as unknown as Record<string, unknown>;
  proto.scrollIntoView = vi.fn();
  proto.hasPointerCapture = vi.fn(() => false);
  proto.releasePointerCapture = vi.fn();
  if (!("ResizeObserver" in window)) {
    (window as unknown as Record<string, unknown>).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
  global.fetch = vi.fn(async () => ({
    ok: true,
    json: async () => ({ id: "p1", name: "Promos", revision: 1, items: [] }),
  })) as unknown as typeof fetch;
});

function renderEditor(overrides: Partial<CampaignEditorProps> = {}) {
  const props: CampaignEditorProps = {
    campaign: {
      id: "campaign-1",
      name: "Fall Sale",
      description: "Lobby rotation",
      playlistId: "p1",
      startsAt: "2026-09-01T09:00:00.000Z",
      endsAt: "2026-09-15T09:00:00.000Z",
      priority: 5,
      enabled: true,
      isArchived: false,
      playlist: { id: "p1", name: "Promos", isArchived: false },
    },
    playlists: [
      { id: "p1", name: "Promos" },
      { id: "p2", name: "Evergreen" },
    ],
    screens: [
      {
        id: "s1",
        name: "Screen A",
        locationId: "loc1",
        locationName: "Warehouse",
      },
      {
        id: "s2",
        name: "Screen B",
        locationId: "loc2",
        locationName: "Storefront",
      },
    ],
    locations: [
      { id: "loc1", name: "Warehouse" },
      { id: "loc2", name: "Storefront" },
    ],
    targetedScreenIds: ["s1"],
    targetedLocationIds: [],
    affectedScreenCount: 1,
    canUpdate: true,
    canDelete: true,
    ...overrides,
  };
  return render(<CampaignEditor {...props} />);
}

describe("CampaignEditor", () => {
  it("seeds the name and priority inputs from props", () => {
    const { getByLabelText } = renderEditor();
    expect((getByLabelText("Name") as HTMLInputElement).value).toBe("Fall Sale");
    expect((getByLabelText("Priority") as HTMLInputElement).value).toBe("5");
  });

  it("toggles enabled immediately through setCampaignEnabled", async () => {
    const { getByLabelText } = renderEditor();
    fireEvent.click(getByLabelText("Campaign enabled"));
    await waitFor(() => {
      expect(actions.setCampaignEnabled).toHaveBeenCalledWith("campaign-1", false);
    });
  });

  it("saves only the changed field", async () => {
    const { getByLabelText, getByRole } = renderEditor();
    fireEvent.change(getByLabelText("Name"), { target: { value: "Winter promo" } });
    fireEvent.click(getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(actions.updateCampaign).toHaveBeenCalledWith("campaign-1", {
        name: "Winter promo",
      });
    });
  });

  it("shows how many screens the campaign affects", () => {
    const { getByText } = renderEditor();
    expect(getByText("This campaign currently affects 1 screen.")).toBeTruthy();
  });

  it("targets a whole location from the targets panel", async () => {
    const { getByLabelText } = renderEditor();
    fireEvent.click(getByLabelText("Target all screens at Warehouse"));
    await waitFor(() => {
      expect(actions.setCampaignTargets).toHaveBeenCalledWith(
        "campaign-1",
        expect.objectContaining({
          locationIds: expect.arrayContaining(["loc1"]),
        }),
      );
    });
  });

  it("hides the delete control when the caller cannot delete", () => {
    const withDelete = renderEditor({ canDelete: true });
    expect(withDelete.queryByText("Delete campaign")).toBeTruthy();
    withDelete.unmount();

    const noDelete = renderEditor({ canDelete: false });
    expect(noDelete.queryByText("Delete campaign")).toBeNull();
  });
});
