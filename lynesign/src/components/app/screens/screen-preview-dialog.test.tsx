import { render, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";

import { ScreenPreviewDialog } from "@/components/app/screens/screen-preview-dialog";

// Mock both sub-dialogs so the test asserts the props this component hands them
// rather than driving their own fetch and playback.
const canvasProps = vi.fn();
const playlistProps = vi.fn();

vi.mock("@/components/app/canvas/canvas-preview-dialog", () => ({
  CanvasPreviewDialog: (props: Record<string, unknown>) => {
    canvasProps(props);
    return <div data-testid="canvas-preview-dialog" />;
  },
}));

vi.mock("@/components/app/playlists/playlist-preview-dialog", () => ({
  PlaylistPreviewDialog: (props: Record<string, unknown>) => {
    playlistProps(props);
    return <div data-testid="playlist-preview-dialog" />;
  },
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

afterEach(() => {
  vi.unstubAllGlobals();
  canvasProps.mockReset();
  playlistProps.mockReset();
});

function mockResolution(body: unknown, ok = true) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok, json: async () => body })),
  );
}

function renderDialog(screenId = "s1", screenName = "Lobby") {
  return render(
    <ScreenPreviewDialog
      open
      onOpenChange={vi.fn()}
      screenId={screenId}
      screenName={screenName}
    />,
  );
}

describe("ScreenPreviewDialog", () => {
  it("plays a canvas source through CanvasPreviewDialog with a demo watermark", async () => {
    mockResolution({ source: "canvas", canvasId: "c1", screenName: "Lobby" });
    renderDialog();

    await waitFor(() => expect(canvasProps).toHaveBeenCalled());
    const props = canvasProps.mock.calls.at(-1)![0] as Record<string, unknown>;
    expect(props.canvasId).toBe("c1");
    expect(props.demoWatermark).toBe(true);
    expect(props.headerNote).toBe("Playing: canvas");
    expect(fetch).toHaveBeenCalledWith("/api/screens/s1/preview");
  });

  it("plays a campaign source through PlaylistPreviewDialog with the campaign label and a demo watermark", async () => {
    mockResolution({
      source: "campaign",
      playlistId: "p1",
      label: "Holiday push",
      screenName: "Lobby",
    });
    renderDialog();

    await waitFor(() => expect(playlistProps).toHaveBeenCalled());
    const props = playlistProps.mock.calls.at(-1)![0] as Record<string, unknown>;
    expect(props.playlistId).toBe("p1");
    expect(props.demoWatermark).toBe(true);
    expect(props.headerNote).toBe('Playing: campaign "Holiday push"');
  });

  it("plays a base playlist source through PlaylistPreviewDialog", async () => {
    mockResolution({ source: "playlist", playlistId: "p9", screenName: "Hall" });
    renderDialog("s9", "Hall");

    await waitFor(() => expect(playlistProps).toHaveBeenCalled());
    const props = playlistProps.mock.calls.at(-1)![0] as Record<string, unknown>;
    expect(props.playlistId).toBe("p9");
    expect(props.headerNote).toBe("Playing: this screen's playlist");
  });

  it("shows an empty state for a screen with nothing to play", async () => {
    mockResolution({ source: "none", screenName: "Dark screen" });
    const { findByText } = renderDialog("s2", "Dark screen");

    expect(await findByText(/nothing to play right now/i)).toBeTruthy();
    expect(canvasProps).not.toHaveBeenCalled();
    expect(playlistProps).not.toHaveBeenCalled();
  });

  it("shows an error state when the resolution cannot be loaded", async () => {
    mockResolution({}, false);
    const { findByText } = renderDialog();

    expect(await findByText(/could not be loaded/i)).toBeTruthy();
    expect(canvasProps).not.toHaveBeenCalled();
    expect(playlistProps).not.toHaveBeenCalled();
  });
});
