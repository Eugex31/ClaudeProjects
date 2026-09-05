import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeAll } from "vitest";

import {
  ScreenContentSourceDialog,
  type ScreenContentSourceDialogProps,
} from "@/components/app/screens/screen-content-source-dialog";
import * as actions from "@/app/(app)/screens/actions";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

vi.mock("@/app/(app)/screens/actions", () => ({
  setScreenContentSource: vi.fn(async () => ({ ok: true })),
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

function props(
  overrides: Partial<ScreenContentSourceDialogProps> = {},
): ScreenContentSourceDialogProps {
  return {
    open: true,
    onOpenChange: vi.fn(),
    screen: { id: "screen-1", name: "Lobby Wall", playlistId: "p1", canvasId: null },
    playlists: [{ id: "p1", name: "Lobby Loop" }],
    canvases: [{ id: "c1", name: "Lobby Canvas" }],
    ...overrides,
  };
}

describe("ScreenContentSourceDialog", () => {
  it("starts on the playlist source when the screen already follows a playlist", () => {
    render(<ScreenContentSourceDialog {...props()} />);
    expect((screen.getByLabelText("Playlist") as HTMLInputElement).checked).toBe(
      true,
    );
    expect(
      (screen.getByLabelText("Playlist to follow") as HTMLSelectElement).value,
    ).toBe("p1");
  });

  it("switches to the canvas source and submits the chosen canvas", async () => {
    render(<ScreenContentSourceDialog {...props()} />);

    fireEvent.click(screen.getByLabelText("Canvas"));
    fireEvent.change(screen.getByLabelText("Canvas to show"), {
      target: { value: "c1" },
    });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => {
      expect(actions.setScreenContentSource).toHaveBeenCalledWith({
        screenId: "screen-1",
        source: "canvas",
        canvasId: "c1",
      });
    });
  });

  it("submits a none source that carries no companion id", async () => {
    render(<ScreenContentSourceDialog {...props()} />);

    fireEvent.click(screen.getByLabelText("None"));
    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => {
      expect(actions.setScreenContentSource).toHaveBeenCalledWith({
        screenId: "screen-1",
        source: "none",
      });
    });
  });
});
