import { render, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  FrameStrip,
  type FrameStripProps,
} from "@/components/app/canvas/frame-strip";
import type { FrameVM } from "@/components/app/canvas/canvas-stage";
import * as actions from "@/app/(app)/canvas/actions";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

vi.mock("@/app/(app)/canvas/actions", () => ({
  createFrame: vi.fn(async () => ({ id: "frame-new" })),
  reorderFrames: vi.fn(async () => ({ ok: true })),
  setFrameDuration: vi.fn(async () => ({ ok: true })),
  deleteFrame: vi.fn(async () => ({ ok: true })),
}));

/** Three empty frames in sort order, ids `f0` / `f1` / `f2`. */
function makeFrames(): FrameVM[] {
  return [0, 1, 2].map((index) => ({
    id: `f${index}`,
    sortOrder: index,
    durationSeconds: 10,
    type: "MEMO" as const,
    locationScoped: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    content: {
      id: `c${index}`,
      name: null,
      clock: null,
      picture: null,
      video: null,
      memo: { body: "" },
      web: null,
    },
  }));
}

function renderStrip(overrides: Partial<FrameStripProps> = {}) {
  const props: FrameStripProps = {
    panelId: "panel-1",
    frames: makeFrames(),
    selectedFrameId: null,
    onSelectFrame: vi.fn(),
    canManage: true,
    ...overrides,
  };
  return { props, ...render(<FrameStrip {...props} />) };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("FrameStrip", () => {
  it("renders one chip per frame", () => {
    const { getByLabelText } = renderStrip();
    expect(getByLabelText("Select Text frame 1")).toBeTruthy();
    expect(getByLabelText("Select Text frame 2")).toBeTruthy();
    expect(getByLabelText("Select Text frame 3")).toBeTruthy();
  });

  it("reorders through reorderFrames when the last chip is dropped on the first", async () => {
    const { container } = renderStrip();
    const chips = container.querySelectorAll("li[draggable='true']");
    expect(chips).toHaveLength(3);

    fireEvent.dragStart(chips[2]);
    fireEvent.dragOver(chips[0]);
    fireEvent.drop(chips[0]);

    await waitFor(() => {
      expect(actions.reorderFrames).toHaveBeenCalledWith({
        panelId: "panel-1",
        frameIds: ["f2", "f0", "f1"],
      });
    });
  });

  it("creates a WEB frame from the Add frame menu with the default duration", async () => {
    const { getByRole, getByText } = renderStrip();
    fireEvent.click(getByRole("button", { name: "Add frame" }));
    fireEvent.click(getByText("Web"));

    await waitFor(() => {
      expect(actions.createFrame).toHaveBeenCalledWith({
        panelId: "panel-1",
        type: "WEB",
        durationSeconds: 10,
      });
    });
  });

  it("commits a changed duration through setFrameDuration", async () => {
    const { getAllByLabelText } = renderStrip();
    const input = getAllByLabelText("Frame duration in seconds")[0];

    fireEvent.change(input, { target: { value: "25" } });
    fireEvent.blur(input);

    await waitFor(() => {
      expect(actions.setFrameDuration).toHaveBeenCalledWith({
        id: "f0",
        durationSeconds: 25,
      });
    });
  });
});
