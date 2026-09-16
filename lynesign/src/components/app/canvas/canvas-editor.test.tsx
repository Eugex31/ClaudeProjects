import { render, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";

import {
  CanvasEditor,
  type CanvasEditorProps,
} from "@/components/app/canvas/canvas-editor";
import type { PanelVM } from "@/components/app/canvas/canvas-stage";
import * as actions from "@/app/(app)/canvas/actions";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

vi.mock("@/app/(app)/canvas/actions", () => ({
  createPanel: vi.fn(async () => ({ id: "panel-new" })),
  updatePanels: vi.fn(async () => ({ ok: true })),
  deletePanel: vi.fn(async () => ({ ok: true })),
  duplicatePanel: vi.fn(async () => ({ id: "panel-dup" })),
}));

/**
 * The canvas is 800 wide so `scale` resolves to exactly 1 (min(1, 900 / 800)),
 * which keeps the pointer-delta maths 1:1 with canvas pixels. Both panels sit on
 * multiples of the default grid (8) so they start already snapped.
 */
function makePanels(): PanelVM[] {
  return [
    {
      id: "a",
      name: null,
      x: 100,
      y: 48,
      width: 160,
      height: 120,
      zIndex: 0,
      noScroll: false,
      frames: [],
    },
    {
      id: "b",
      name: null,
      x: 300,
      y: 200,
      width: 160,
      height: 120,
      zIndex: 1,
      noScroll: false,
      frames: [],
    },
  ];
}

function renderEditor(overrides: Partial<CanvasEditorProps> = {}) {
  const props: CanvasEditorProps = {
    tree: {
      id: "canvas-1",
      name: "Lobby wall",
      width: 800,
      height: 600,
      backgroundColor: "#101828",
      backgroundImageUrl: null,
      revision: 1,
      panels: makePanels(),
    },
    assets: [],
    canManage: true,
    ...overrides,
  };
  return render(<CanvasEditor {...props} />);
}

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

beforeEach(() => {
  vi.clearAllMocks();
});

describe("CanvasEditor", () => {
  it("renders each panel at its scaled left and top", () => {
    const { container } = renderEditor();
    const panelA = container.querySelector(
      '[data-panel-id="a"]',
    ) as HTMLElement;
    const panelB = container.querySelector(
      '[data-panel-id="b"]',
    ) as HTMLElement;

    expect(panelA.style.left).toBe("100px");
    expect(panelA.style.top).toBe("48px");
    expect(panelB.style.left).toBe("300px");
    expect(panelB.style.top).toBe("200px");
  });

  it("commits panel A's grid-snapped x and y after a pointer drag", async () => {
    const { container } = renderEditor();
    const panelA = container.querySelector(
      '[data-panel-id="a"]',
    ) as HTMLElement;

    fireEvent.pointerDown(panelA, { clientX: 0, clientY: 0 });
    fireEvent.pointerMove(window, { clientX: 13, clientY: 5 });
    fireEvent.pointerUp(window, { clientX: 13, clientY: 5 });

    await waitFor(() => {
      expect(actions.updatePanels).toHaveBeenCalledWith("canvas-1", {
        panels: [{ id: "a", x: 112, y: 56 }],
      });
    });
  });

  it("snaps panel A's left edge to panel B and draws an alignment guide", async () => {
    const { container } = renderEditor();
    const panelA = container.querySelector(
      '[data-panel-id="a"]',
    ) as HTMLElement;

    fireEvent.pointerDown(panelA, { clientX: 0, clientY: 0 });
    fireEvent.pointerMove(window, { clientX: 200, clientY: 0 });

    expect(panelA.style.left).toBe("300px");
    expect(container.querySelector('[data-guide="x"]')).not.toBeNull();

    fireEvent.pointerUp(window, { clientX: 200, clientY: 0 });

    await waitFor(() => {
      expect(actions.updatePanels).toHaveBeenLastCalledWith("canvas-1", {
        panels: [{ id: "a", x: 300, y: 48 }],
      });
    });
    expect(container.querySelector('[data-guide="x"]')).toBeNull();
  });

  it("calls createPanel from the Add panel button", async () => {
    const { getByRole } = renderEditor();
    fireEvent.click(getByRole("button", { name: "Add panel" }));

    await waitFor(() => {
      expect(actions.createPanel).toHaveBeenCalledWith(
        expect.objectContaining({
          canvasId: "canvas-1",
          x: 24,
          y: 24,
          width: 160,
          height: 120,
          zIndex: 2,
          noScroll: false,
        }),
      );
    });
  });

  it("does not commit a press and release with no pointer movement", () => {
    const { container } = renderEditor();
    const panelA = container.querySelector(
      '[data-panel-id="a"]',
    ) as HTMLElement;

    fireEvent.pointerDown(panelA, { clientX: 40, clientY: 40 });
    fireEvent.pointerUp(window, { clientX: 40, clientY: 40 });

    expect(actions.updatePanels).not.toHaveBeenCalled();
  });

  it("reverts panel A to its origin when updatePanels fails", async () => {
    vi.mocked(actions.updatePanels).mockResolvedValueOnce({
      error: "That change is not valid.",
    });
    const { container } = renderEditor();
    const panelA = container.querySelector(
      '[data-panel-id="a"]',
    ) as HTMLElement;

    fireEvent.pointerDown(panelA, { clientX: 0, clientY: 0 });
    fireEvent.pointerMove(window, { clientX: 13, clientY: 5 });
    fireEvent.pointerUp(window, { clientX: 13, clientY: 5 });

    await waitFor(() => {
      expect(actions.updatePanels).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(panelA.style.left).toBe("100px");
      expect(panelA.style.top).toBe("48px");
    });
  });

  it("nudges the selected panel by 1px on ArrowRight and commits it", async () => {
    const { getByLabelText } = renderEditor();
    fireEvent.click(getByLabelText("Select Panel 1"));
    fireEvent.keyDown(window, { key: "ArrowRight" });

    await waitFor(() => {
      expect(actions.updatePanels).toHaveBeenCalledWith("canvas-1", {
        panels: [{ id: "a", x: 101, y: 48 }],
      });
    });
  });

  it("persists the inspector noScroll switch in the same tick it toggles", async () => {
    const { getByLabelText } = renderEditor();
    fireEvent.click(getByLabelText("Select Panel 1"));
    fireEvent.click(getByLabelText("Clip content to the panel"));

    await waitFor(() => {
      expect(actions.updatePanels).toHaveBeenCalledWith(
        "canvas-1",
        expect.objectContaining({
          panels: [expect.objectContaining({ id: "a", noScroll: true })],
        }),
      );
    });
  });

  it("commits integer geometry when the grid is off and the drag lands on a fraction", async () => {
    // 1200 wide gives scale 0.75 (min(1, 900 / 1200)), so a 5px pointer delta is
    // 6.666... canvas pixels. With the grid off `snap` is a passthrough and no
    // alignment target is within tolerance, so nothing else rounds it. Without
    // the round in `savePanels` the payload would carry 106.666... and fail
    // `panelSchema`'s `.int()`.
    const { container, getByRole } = renderEditor({
      tree: {
        id: "canvas-1",
        name: "Lobby wall",
        width: 1200,
        height: 900,
        backgroundColor: "#101828",
        backgroundImageUrl: null,
        revision: 1,
        panels: makePanels(),
      },
    });
    fireEvent.click(getByRole("button", { name: "Off" }));

    const panelA = container.querySelector(
      '[data-panel-id="a"]',
    ) as HTMLElement;
    fireEvent.pointerDown(panelA, { clientX: 0, clientY: 0 });
    fireEvent.pointerMove(window, { clientX: 5, clientY: 5 });
    fireEvent.pointerUp(window, { clientX: 5, clientY: 5 });

    await waitFor(() => {
      expect(actions.updatePanels).toHaveBeenCalled();
    });
    const [, payload] = vi.mocked(actions.updatePanels).mock.calls[0];
    const patch = payload.panels[0] as { id: string; x: number; y: number };
    expect(patch.id).toBe("a");
    expect(Number.isInteger(patch.x)).toBe(true);
    expect(Number.isInteger(patch.y)).toBe(true);
    expect(patch.x).toBe(107);
    expect(patch.y).toBe(55);
  });

  it("does not delete the selected panel on Backspace while the preview dialog is open", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 500,
        json: async () => ({}),
      })),
    );
    try {
      const { getByLabelText, getByRole, findByRole } = renderEditor();
      fireEvent.click(getByLabelText("Select Panel 1"));
      fireEvent.click(getByRole("button", { name: "Play" }));
      await findByRole("dialog");

      fireEvent.keyDown(window, { key: "Backspace" });

      expect(actions.deletePanel).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("ignores an arrow key aimed at a select element", () => {
    const { getByLabelText } = renderEditor();
    fireEvent.click(getByLabelText("Select Panel 1"));

    const select = document.createElement("select");
    document.body.appendChild(select);
    try {
      select.focus();
      fireEvent.keyDown(select, { key: "ArrowDown" });
      expect(actions.updatePanels).not.toHaveBeenCalled();
    } finally {
      document.body.removeChild(select);
    }
  });

  it("still nudges when the panel-list button that selected the panel has focus", async () => {
    // Clicking a left-rail row is a primary way to select a panel, and it leaves
    // focus on that row's button. Arrow-nudge has to keep working there, so
    // buttons are not in the keydown ignore list.
    const { getByLabelText } = renderEditor();
    const row = getByLabelText("Select Panel 1") as HTMLButtonElement;
    fireEvent.click(row);
    row.focus();
    expect(document.activeElement).toBe(row);

    fireEvent.keyDown(row, { key: "ArrowRight" });

    await waitFor(() => {
      expect(actions.updatePanels).toHaveBeenCalledWith("canvas-1", {
        panels: [{ id: "a", x: 101, y: 48 }],
      });
    });
  });

  it("drops the selection on Escape", () => {
    const { getByLabelText, queryByLabelText } = renderEditor();
    fireEvent.click(getByLabelText("Select Panel 1"));
    expect(queryByLabelText("Clip content to the panel")).not.toBeNull();

    fireEvent.keyDown(window, { key: "Escape" });

    expect(queryByLabelText("Clip content to the panel")).toBeNull();
  });

  it("renders the duplicate optimistically at the source offset and selects it", async () => {
    const { container, getByLabelText, getByRole } = renderEditor();
    fireEvent.click(getByLabelText("Select Panel 1"));
    fireEvent.click(getByRole("button", { name: "Duplicate panel" }));

    await waitFor(() => {
      expect(actions.duplicatePanel).toHaveBeenCalledWith("a");
    });
    await waitFor(() => {
      expect(
        container.querySelector('[data-panel-id="panel-dup"]'),
      ).not.toBeNull();
    });

    const copy = container.querySelector(
      '[data-panel-id="panel-dup"]',
    ) as HTMLElement;
    // Source panel a sits at 100, 48; the server offsets the copy by one grid
    // step, so the optimistic clone has to land on 108, 56.
    expect(copy.style.left).toBe("108px");
    expect(copy.style.top).toBe("56px");
    expect(getByLabelText("Select Panel 3").getAttribute("aria-current")).toBe(
      "true",
    );
  });
});
