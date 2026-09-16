import { render, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

import { FrameContentEditor } from "@/components/app/canvas/frame-content-editor";
import type { CanvasEditorAsset } from "@/components/app/canvas/canvas-editor";
import type { FrameContentVM, FrameVM } from "@/components/app/canvas/canvas-stage";
import * as actions from "@/app/(app)/canvas/actions";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

vi.mock("@/app/(app)/canvas/actions", () => ({
  setImageContent: vi.fn(async () => ({ ok: true })),
  setVideoContent: vi.fn(async () => ({ ok: true })),
  setTextContent: vi.fn(async () => ({ ok: true })),
  setClockContent: vi.fn(async () => ({ ok: true })),
  setWebContent: vi.fn(async () => ({ ok: true })),
}));

function makeFrame(
  type: FrameVM["type"],
  content: Partial<FrameContentVM>,
): FrameVM {
  return {
    id: "frame-1",
    sortOrder: 0,
    durationSeconds: 10,
    type,
    locationScoped: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    content: {
      id: "content-1",
      name: null,
      clock: null,
      picture: null,
      video: null,
      memo: null,
      web: null,
      ...content,
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("FrameContentEditor", () => {
  it("rejects a non http URL inline and accepts a valid one", async () => {
    const frame = makeFrame("WEB", { web: { url: "" } });
    const { getByLabelText, queryByRole, getByRole } = render(
      <FrameContentEditor frame={frame} assets={[]} canManage />,
    );
    const input = getByLabelText("Web address");

    fireEvent.change(input, { target: { value: "notaurl" } });
    fireEvent.blur(input);

    expect(getByRole("alert")).toBeTruthy();
    expect(actions.setWebContent).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: "https://x.test" } });
    fireEvent.blur(input);

    await waitFor(() => {
      expect(actions.setWebContent).toHaveBeenCalledWith({
        frameId: "frame-1",
        url: "https://x.test",
      });
    });
    expect(queryByRole("alert")).toBeNull();
  });

  it("writes the clock when a toggle is switched off", async () => {
    const frame = makeFrame("CLOCK", {
      clock: {
        type: 0,
        showDate: false,
        showTime: true,
        showSeconds: true,
        label: null,
        timeZone: null,
      },
    });
    const { getByRole } = render(
      <FrameContentEditor frame={frame} assets={[]} canManage />,
    );

    fireEvent.click(getByRole("switch", { name: "Show seconds" }));

    await waitFor(() => {
      expect(actions.setClockContent).toHaveBeenCalledWith(
        expect.objectContaining({ frameId: "frame-1", showSeconds: false }),
      );
    });
  });

  it("sends null when a saved clock label and time zone are cleared", async () => {
    const frame = makeFrame("CLOCK", {
      clock: {
        type: 0,
        showDate: false,
        showTime: true,
        showSeconds: false,
        label: "Lobby",
        timeZone: "Europe/London",
      },
    });
    const { getByLabelText } = render(
      <FrameContentEditor frame={frame} assets={[]} canManage />,
    );

    const label = getByLabelText("Label");
    fireEvent.change(label, { target: { value: "" } });
    fireEvent.blur(label);

    await waitFor(() => {
      expect(actions.setClockContent).toHaveBeenCalledWith(
        expect.objectContaining({ frameId: "frame-1", label: null }),
      );
    });

    fireEvent.change(getByLabelText("Time zone"), { target: { value: "" } });

    await waitFor(() => {
      expect(actions.setClockContent).toHaveBeenLastCalledWith(
        expect.objectContaining({ frameId: "frame-1", timeZone: null }),
      );
    });
  });

  it("sets the image content from the library picker", async () => {
    const frame = makeFrame("PICTURE", {
      picture: { mediaRef: null, mode: null, mediaAssetId: null },
    });
    const assets: CanvasEditorAsset[] = [
      { id: "img-1", name: "Poster", kind: "IMAGE", thumbnailUrl: null },
      { id: "vid-1", name: "Clip", kind: "VIDEO", thumbnailUrl: null },
    ];
    const { getByRole, getByLabelText } = render(
      <FrameContentEditor frame={frame} assets={assets} canManage />,
    );

    fireEvent.click(getByRole("button", { name: "Choose image" }));
    fireEvent.click(getByLabelText("Select Poster"));

    await waitFor(() => {
      expect(actions.setImageContent).toHaveBeenCalledWith(
        expect.objectContaining({
          frameId: "frame-1",
          mediaAssetId: "img-1",
        }),
      );
    });
  });

  it("gates every mutating control behind canManage", () => {
    const frame = makeFrame("PICTURE", {
      picture: { mediaRef: null, mode: null, mediaAssetId: null },
    });
    const assets: CanvasEditorAsset[] = [
      { id: "img-1", name: "Poster", kind: "IMAGE", thumbnailUrl: null },
    ];
    const { getByRole } = render(
      <FrameContentEditor frame={frame} assets={assets} canManage={false} />,
    );

    const choose = getByRole("button", {
      name: "Choose image",
    }) as HTMLButtonElement;
    expect(choose.disabled).toBe(true);
    fireEvent.click(choose);
    expect(actions.setImageContent).not.toHaveBeenCalled();
  });
});
