import { render, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";

import { PlaylistPreviewDialog } from "@/components/app/playlists/playlist-preview-dialog";

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

afterEach(() => {
  vi.restoreAllMocks();
});

function mockManifest(items: unknown[]) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      json: async () => ({ id: "p1", name: "Lobby", revision: 3, items }),
    })),
  );
}

const IMAGE = {
  id: "i1",
  kind: "IMAGE",
  url: "https://cdn.test/a.png",
  durationSeconds: 9,
  mimeType: "image/png",
  width: 100,
  height: 100,
};
const WEB = {
  id: "w1",
  kind: "WEB",
  url: "https://example.com",
  durationSeconds: 14,
  mimeType: null,
  width: null,
  height: null,
};

function renderDialog() {
  return render(
    <PlaylistPreviewDialog
      open
      onOpenChange={vi.fn()}
      playlistId="p1"
      playlistName="Lobby"
    />,
  );
}

describe("PlaylistPreviewDialog", () => {
  // Radix Dialog renders into a portal on document.body, so query the document.
  const img = () => document.querySelector("img") as HTMLImageElement | null;
  const frame = () => document.querySelector("iframe") as HTMLIFrameElement | null;

  it("fetches the preview manifest on open and shows the first item and counter", async () => {
    mockManifest([IMAGE, WEB]);
    const { getByText } = renderDialog();

    await waitFor(() => {
      expect(img()).not.toBeNull();
      expect(img()!.src).toBe(IMAGE.url);
    });
    expect(getByText("1 of 2")).toBeTruthy();
    expect(fetch).toHaveBeenCalledWith("/api/playlists/p1/preview");
  });

  it("steps forward and back through the items", async () => {
    mockManifest([IMAGE, WEB]);
    const { getByText, getByLabelText } = renderDialog();

    await waitFor(() => expect(img()).not.toBeNull());

    fireEvent.click(getByLabelText("Next item"));
    await waitFor(() => {
      expect(img()).toBeNull();
      expect(frame()).not.toBeNull();
      expect(frame()!.src).toBe(`${WEB.url}/`);
    });
    expect(getByText("2 of 2")).toBeTruthy();

    fireEvent.click(getByLabelText("Previous item"));
    await waitFor(() => expect(img()).not.toBeNull());
    expect(getByText("1 of 2")).toBeTruthy();
  });

  it("fetches the fetchPath override instead of the default playlist path", async () => {
    mockManifest([IMAGE, WEB]);
    render(
      <PlaylistPreviewDialog
        open
        onOpenChange={vi.fn()}
        playlistId="p1"
        playlistName="Lobby"
        fetchPath="/api/campaigns/c1/preview"
      />,
    );

    await waitFor(() => expect(img()).not.toBeNull());
    expect(fetch).toHaveBeenCalledWith("/api/campaigns/c1/preview");
    expect(fetch).not.toHaveBeenCalledWith("/api/playlists/p1/preview");
  });

  it("shows an empty state when nothing is playable", async () => {
    mockManifest([]);
    const { getByText, queryByLabelText } = renderDialog();

    await waitFor(() => {
      expect(getByText(/Nothing to preview/)).toBeTruthy();
    });
    expect(queryByLabelText("Next item")).toBeNull();
  });

  it("shows an error state when the manifest cannot be loaded", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, json: async () => ({}) })),
    );
    const { getByText } = renderDialog();

    await waitFor(() => {
      expect(getByText(/could not be loaded/)).toBeTruthy();
    });
  });
});
