import { render, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";

import { MediaLibrary } from "@/components/app/media/media-library";
import { requestUpload, finalizeUpload } from "@/app/(app)/media/actions";

const refresh = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, push: vi.fn() }),
  usePathname: () => "/media",
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/app/(app)/media/actions", () => ({
  requestUpload: vi.fn(),
  finalizeUpload: vi.fn(),
  deleteAssets: vi.fn(async () => ({ archived: 0 })),
  deleteFolder: vi.fn(async () => ({})),
  renameFolder: vi.fn(async () => ({})),
  createFolder: vi.fn(async () => ({})),
  createWebContent: vi.fn(async () => ({})),
  updateAsset: vi.fn(async () => ({})),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

// The upload pipeline PUTs bytes with a bare XMLHttpRequest. Swap it for a fake
// that resolves onload/onerror on a macrotask, with the resulting HTTP status
// driven by a mutable module var so each case can steer it. `putHeaders` and
// `putUrl` record what the PUT was handed so the tests can assert on it without
// aliasing the instance.
let xhrStatus = 200;
let putUrl: string | undefined;
const putHeaders = vi.fn();

class FakeXHR {
  status = 0;
  upload: { onprogress: ((e: unknown) => void) | null } = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  setRequestHeader = putHeaders;

  open(_method: string, url: string) {
    putUrl = url;
  }

  send() {
    setTimeout(() => {
      this.status = xhrStatus;
      if (xhrStatus === 0) this.onerror?.();
      else this.onload?.();
    }, 0);
  }
}

beforeAll(() => {
  (globalThis as unknown as Record<string, unknown>).XMLHttpRequest = FakeXHR;

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
  xhrStatus = 200;
  putUrl = undefined;
});

function renderLib(over: Partial<React.ComponentProps<typeof MediaLibrary>> = {}) {
  return render(
    <MediaLibrary
      currentFolderId={null}
      crumbs={[]}
      childFolders={[]}
      assets={[]}
      allFolders={[]}
      query={{ q: "", kind: "", sort: "newest", page: 1, hasMore: false }}
      canCreate
      canDelete
      canUpdate
      canManageFolders
      {...over}
    />,
  );
}

function pickFile(container: HTMLElement, file: File) {
  const input = container.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [file] } });
}

const photo = () => new File(["x"], "photo.png", { type: "image/png" });

const okUpload = {
  assetId: "a1",
  upload: {
    url: "https://s3.test/put",
    headers: { "content-type": "image/png", "x-amz-meta-k": "v" },
    expiresAt: new Date(),
  },
};

describe("MediaLibrary upload pipeline", () => {
  it("runs the happy path: request, PUT with headers, finalize, refresh", async () => {
    vi.mocked(requestUpload).mockResolvedValue(okUpload);
    vi.mocked(finalizeUpload).mockResolvedValue({ status: "READY" });

    const { container } = renderLib();
    pickFile(container, photo());

    await waitFor(() => expect(finalizeUpload).toHaveBeenCalledWith("a1"));

    expect(requestUpload).toHaveBeenCalledWith({
      folderId: undefined,
      filename: "photo.png",
      mimeType: "image/png",
      sizeBytes: expect.any(Number),
    });
    expect(putUrl).toBe("https://s3.test/put");
    expect(putHeaders).toHaveBeenCalledWith("content-type", "image/png");
    expect(putHeaders).toHaveBeenCalledWith("x-amz-meta-k", "v");

    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("stops at a rejected request: toast, no PUT, no finalize, still refreshes", async () => {
    const { toast } = await import("sonner");
    vi.mocked(requestUpload).mockResolvedValue({
      error: "That file type is not supported.",
    });

    const { container } = renderLib();
    pickFile(container, photo());

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("That file type is not supported."),
    );
    expect(finalizeUpload).not.toHaveBeenCalled();
    expect(putHeaders).not.toHaveBeenCalled();
    expect(putUrl).toBeUndefined();
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
  });

  it("surfaces a duplicate as an info toast", async () => {
    const { toast } = await import("sonner");
    vi.mocked(requestUpload).mockResolvedValue(okUpload);
    vi.mocked(finalizeUpload).mockResolvedValue({
      status: "READY",
      duplicateOf: "old-1",
    });

    const { container } = renderLib();
    pickFile(container, photo());

    await waitFor(() =>
      expect(toast.info).toHaveBeenCalledWith("Looks like a copy of an existing asset."),
    );
  });

  it("marks the row failed when finalize reports FAILED", async () => {
    const { toast } = await import("sonner");
    vi.mocked(requestUpload).mockResolvedValue(okUpload);
    vi.mocked(finalizeUpload).mockResolvedValue({ status: "FAILED" });

    const { container } = renderLib();
    pickFile(container, photo());

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("That upload could not be verified."),
    );
  });

  it("survives a thrown finalize: row failed, toast, still refreshes", async () => {
    const { toast } = await import("sonner");
    vi.mocked(requestUpload).mockResolvedValue(okUpload);
    vi.mocked(finalizeUpload).mockRejectedValue(new Error("boom"));

    const { container, findAllByText } = renderLib();
    pickFile(container, photo());

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("That upload could not be completed."),
    );
    expect((await findAllByText("Failed")).length).toBeGreaterThan(0);
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("reports a non-2xx PUT and does not finalize", async () => {
    const { toast } = await import("sonner");
    xhrStatus = 500;
    vi.mocked(requestUpload).mockResolvedValue(okUpload);
    vi.mocked(finalizeUpload).mockResolvedValue({ status: "READY" });

    const { container } = renderLib();
    pickFile(container, photo());

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("That upload could not be sent."),
    );
    expect(finalizeUpload).not.toHaveBeenCalled();
  });
});
