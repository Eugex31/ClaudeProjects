import { render, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeAll } from "vitest";

import {
  PlaylistEditor,
  type PlaylistEditorProps,
} from "@/components/app/playlists/playlist-editor";
import type { PlaylistRowItem } from "@/components/app/playlists/playlist-item-row";
import * as actions from "@/app/(app)/playlists/actions";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

vi.mock("@/app/(app)/playlists/actions", () => ({
  updatePlaylist: vi.fn(async () => ({})),
  deletePlaylist: vi.fn(async () => ({})),
  addItems: vi.fn(async () => ({ added: 1 })),
  removeItem: vi.fn(async () => ({})),
  reorderItems: vi.fn(async () => ({})),
  setItemDuration: vi.fn(async () => ({})),
  setItemEnabled: vi.fn(async () => ({})),
  assignPlaylistToScreen: vi.fn(async () => ({})),
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
});

const ITEMS: PlaylistRowItem[] = [
  {
    id: "id0",
    position: 0,
    durationSeconds: null,
    enabled: true,
    resolvedDurationSeconds: 90,
    mediaAsset: {
      id: "a0",
      name: "First",
      kind: "IMAGE",
      status: "READY",
      isArchived: false,
      thumbnailUrl: null,
    },
  },
  {
    id: "id1",
    position: 1,
    durationSeconds: null,
    enabled: true,
    resolvedDurationSeconds: 30,
    mediaAsset: {
      id: "a1",
      name: "Second",
      kind: "VIDEO",
      status: "READY",
      isArchived: true,
      thumbnailUrl: null,
    },
  },
  {
    id: "id2",
    position: 2,
    durationSeconds: null,
    enabled: false,
    resolvedDurationSeconds: 45,
    mediaAsset: {
      id: "a2",
      name: "Third",
      kind: "WEB",
      status: "READY",
      isArchived: false,
      thumbnailUrl: null,
    },
  },
];

function renderEditor(overrides: Partial<PlaylistEditorProps> = {}) {
  const props: PlaylistEditorProps = {
    playlist: {
      id: "playlist-1",
      name: "Lobby loop",
      description: null,
      defaultImageDurationSeconds: 10,
      defaultWebDurationSeconds: 30,
      isArchived: false,
    },
    items: ITEMS,
    screens: [],
    libraryAssets: [],
    assignedScreenIds: [],
    canUpdate: true,
    canDelete: true,
    canAssign: true,
    ...overrides,
  };
  return render(<PlaylistEditor {...props} />);
}

describe("PlaylistEditor", () => {
  it("renders one row per item in position order", () => {
    const { getByText } = renderEditor();
    const first = getByText("First");
    const second = getByText("Second");
    const third = getByText("Third");
    expect(
      first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      second.compareDocumentPosition(third) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("marks an archived asset as unavailable", () => {
    const { getByText, getAllByText } = renderEditor();
    // The archived row is the only Unavailable badge.
    expect(getAllByText("Unavailable")).toHaveLength(1);
    const badge = getByText("Unavailable");
    const row = badge.closest("li");
    expect(row?.textContent).toContain("Second");
  });

  it("reorders by moving row 0 down, sending the full swapped id order", async () => {
    const { getByLabelText } = renderEditor();
    fireEvent.click(getByLabelText("Move First down"));
    await waitFor(() => {
      expect(actions.reorderItems).toHaveBeenCalledWith("playlist-1", {
        itemIds: ["id1", "id0", "id2"],
      });
    });
  });

  it("removes the clicked row", async () => {
    const { getByLabelText } = renderEditor();
    fireEvent.click(getByLabelText("Remove Second"));
    await waitFor(() => {
      expect(actions.removeItem).toHaveBeenCalledWith("id1");
    });
  });

  it("totals only the enabled, available items", () => {
    // id0 enabled+available (90); id1 archived (excluded); id2 disabled (excluded).
    const { getByText } = renderEditor();
    expect(getByText("Total 1m 30s")).toBeTruthy();
  });

  it("shows the delete control only when the caller can delete", () => {
    const withDelete = renderEditor({ canDelete: true });
    expect(withDelete.queryByText("Delete playlist")).toBeTruthy();
    withDelete.unmount();

    const noDelete = renderEditor({ canDelete: false });
    expect(noDelete.queryByText("Delete playlist")).toBeNull();
  });
});
