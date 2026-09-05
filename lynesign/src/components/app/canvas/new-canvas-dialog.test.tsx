import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeAll } from "vitest";

import { NewCanvasDialog } from "@/components/app/canvas/new-canvas-dialog";
import * as actions from "@/app/(app)/canvas/actions";

vi.mock("@/app/(app)/canvas/actions", () => ({
  createCanvas: vi.fn(async () => ({ id: "new-canvas" })),
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

function open() {
  render(<NewCanvasDialog />);
  fireEvent.click(screen.getByRole("button", { name: /new canvas/i }));
}

describe("NewCanvasDialog", () => {
  it("submits the portrait preset size with the name", async () => {
    open();

    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Lobby Portrait" },
    });
    fireEvent.click(screen.getByLabelText(/Portrait/i));
    fireEvent.click(screen.getByRole("button", { name: /create canvas/i }));

    await waitFor(() => {
      expect(actions.createCanvas).toHaveBeenCalledWith({
        name: "Lobby Portrait",
        width: 1080,
        height: 1920,
      });
    });
  });

  it("reveals the width and height inputs when Custom is chosen", () => {
    open();

    expect(screen.queryByLabelText("Width")).toBeNull();
    expect(screen.queryByLabelText("Height")).toBeNull();

    fireEvent.click(screen.getByLabelText("Custom"));

    expect(screen.getByLabelText("Width")).toBeTruthy();
    expect(screen.getByLabelText("Height")).toBeTruthy();
  });

  it("submits a custom width and height", async () => {
    open();

    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Wall" },
    });
    fireEvent.click(screen.getByLabelText("Custom"));
    fireEvent.change(screen.getByLabelText("Width"), {
      target: { value: "1200" },
    });
    fireEvent.change(screen.getByLabelText("Height"), {
      target: { value: "800" },
    });
    fireEvent.click(screen.getByRole("button", { name: /create canvas/i }));

    await waitFor(() => {
      expect(actions.createCanvas).toHaveBeenCalledWith({
        name: "Wall",
        width: 1200,
        height: 800,
      });
    });
  });
});
