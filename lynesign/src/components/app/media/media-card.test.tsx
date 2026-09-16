import { render, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeAll } from "vitest";

import { formatBytes } from "@/lib/format";
import { MediaCard, type MediaCardAsset } from "@/components/app/media/media-card";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

vi.mock("@/app/(app)/media/actions", () => ({
  updateAsset: vi.fn(async () => ({})),
  deleteAssets: vi.fn(async () => ({ archived: 1 })),
  moveFolder: vi.fn(async () => ({})),
  createFolder: vi.fn(async () => ({})),
  createWebContent: vi.fn(async () => ({})),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
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

function makeAsset(overrides: Partial<MediaCardAsset> = {}): MediaCardAsset {
  return {
    id: "asset-1",
    name: "Lobby loop",
    kind: "IMAGE",
    status: "READY",
    sizeBytes: "1572864",
    mimeType: "image/png",
    thumbnailUrl: null,
    width: 1920,
    height: 1080,
    durationSeconds: null,
    url: null,
    tags: [],
    usedCount: 0,
    createdAtLabel: "2 days ago",
    ...overrides,
  };
}

type RenderProps = Partial<Omit<React.ComponentProps<typeof MediaCard>, "asset">> & {
  asset?: Partial<MediaCardAsset>;
};

function renderCard(props: RenderProps = {}) {
  const { asset, ...rest } = props;
  return render(
    <MediaCard
      asset={makeAsset(asset)}
      folders={[]}
      canUpdate
      canDelete
      canManageFolders
      selected={false}
      onToggleSelected={() => {}}
      {...rest}
    />,
  );
}

describe("MediaCard", () => {
  it("renders the asset name and formatted size", () => {
    const { getByText } = renderCard();
    expect(getByText("Lobby loop")).toBeTruthy();
    expect(getByText(formatBytes(BigInt("1572864")))).toBeTruthy();
  });

  it("shows the kind label for each media kind", () => {
    const image = renderCard({ asset: { kind: "IMAGE" } });
    expect(image.getByText("Image")).toBeTruthy();
    image.unmount();

    const video = renderCard({ asset: { kind: "VIDEO" } });
    expect(video.getByText("Video")).toBeTruthy();
    video.unmount();

    const web = renderCard({ asset: { kind: "WEB" } });
    expect(web.getByText("Web")).toBeTruthy();
  });

  it("shows a usage chip only when the asset is used somewhere", () => {
    const unused = renderCard({ asset: { usedCount: 0 } });
    expect(unused.queryByText(/Used in/)).toBeNull();
    unused.unmount();

    const used = renderCard({ asset: { usedCount: 2 } });
    expect(used.getByText("Used in 2")).toBeTruthy();
  });

  it("offers Delete in the menu only when the caller can delete", () => {
    const withDelete = renderCard({ canDelete: true });
    fireEvent.keyDown(withDelete.getByLabelText("Actions for Lobby loop"), {
      key: "Enter",
    });
    expect(withDelete.queryByText("Delete")).toBeTruthy();
    withDelete.unmount();

    const noDelete = renderCard({ canDelete: false });
    fireEvent.keyDown(noDelete.getByLabelText("Actions for Lobby loop"), {
      key: "Enter",
    });
    expect(noDelete.queryByText("Delete")).toBeNull();
  });
});
