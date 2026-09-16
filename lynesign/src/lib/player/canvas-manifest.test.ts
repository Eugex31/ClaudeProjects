import { describe, it, expect, vi } from "vitest";
import {
  assembleCanvasManifest,
  type CanvasTree,
  type CanvasManifest,
} from "@/lib/player/canvas-manifest";

type TreePanel = CanvasTree["panels"][number];
type TreeFrame = TreePanel["frames"][number];

function makeFrame(over: Partial<TreeFrame> = {}): TreeFrame {
  return {
    id: "frame-1",
    durationSeconds: 10,
    type: "MEMO",
    sortOrder: 0,
    content: { memo: { body: "hello" } },
    ...over,
  };
}

function makePanel(over: Partial<TreePanel> = {}): TreePanel {
  return {
    id: "panel-1",
    name: null,
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    zIndex: 0,
    noScroll: false,
    frames: [makeFrame()],
    ...over,
  };
}

function makeTree(over: Partial<CanvasTree> = {}): CanvasTree {
  return {
    id: "canvas-1",
    name: "Lobby",
    revision: 4,
    width: 1920,
    height: 1080,
    backgroundColor: "#000000",
    backgroundImage: null,
    panels: [makePanel()],
    ...over,
  };
}

const signUrl = (key: string) => `signed:${key}`;

function run(tree: CanvasTree, sign = signUrl): CanvasManifest {
  return assembleCanvasManifest(tree, sign);
}

describe("assembleCanvasManifest", () => {
  it("carries the canvas scalars and background color through", () => {
    const out = run(makeTree());
    expect(out).toMatchObject({
      id: "canvas-1",
      name: "Lobby",
      revision: 4,
      width: 1920,
      height: 1080,
      background: { color: "#000000", imageUrl: null },
    });
  });

  it("orders panels by zIndex asc then id asc", () => {
    const tree = makeTree({
      panels: [
        makePanel({ id: "p-c", zIndex: 2 }),
        makePanel({ id: "p-a", zIndex: 0 }),
        makePanel({ id: "p-b", zIndex: 1 }),
      ],
    });
    const out = run(tree);
    expect(out.panels.map((p) => p.id)).toEqual(["p-a", "p-b", "p-c"]);
  });

  it("breaks a zIndex tie with id asc", () => {
    const tree = makeTree({
      panels: [
        makePanel({ id: "p-z", zIndex: 1 }),
        makePanel({ id: "p-a", zIndex: 1 }),
      ],
    });
    const out = run(tree);
    expect(out.panels.map((p) => p.id)).toEqual(["p-a", "p-z"]);
  });

  it("orders frames by sortOrder asc then id asc", () => {
    const tree = makeTree({
      panels: [
        makePanel({
          frames: [
            makeFrame({ id: "f-b", sortOrder: 1 }),
            makeFrame({ id: "f-a", sortOrder: 0 }),
            makeFrame({ id: "f-c", sortOrder: 2 }),
          ],
        }),
      ],
    });
    const out = run(tree);
    expect(out.panels[0].frames.map((f) => f.id)).toEqual(["f-a", "f-b", "f-c"]);
  });

  it("breaks a sortOrder tie with id asc", () => {
    const tree = makeTree({
      panels: [
        makePanel({
          frames: [
            makeFrame({ id: "f-z", sortOrder: 3 }),
            makeFrame({ id: "f-a", sortOrder: 3 }),
          ],
        }),
      ],
    });
    const out = run(tree);
    expect(out.panels[0].frames.map((f) => f.id)).toEqual(["f-a", "f-z"]);
  });

  it("drops a frame whose type has no Plan-1 renderer", () => {
    const tree = makeTree({
      panels: [
        makePanel({
          frames: [
            makeFrame({ id: "keep", type: "MEMO", content: { memo: { body: "x" } } }),
            makeFrame({ id: "html", type: "HTML", content: { memo: { body: "x" } } }),
            makeFrame({ id: "youtube", type: "YOUTUBE", content: { memo: { body: "x" } } }),
          ],
        }),
      ],
    });
    const out = run(tree);
    expect(out.panels[0].frames.map((f) => f.id)).toEqual(["keep"]);
  });

  it("drops a frame with null content", () => {
    const tree = makeTree({
      panels: [
        makePanel({
          frames: [
            makeFrame({ id: "keep" }),
            makeFrame({ id: "empty", content: null }),
          ],
        }),
      ],
    });
    const out = run(tree);
    expect(out.panels[0].frames.map((f) => f.id)).toEqual(["keep"]);
  });

  it("drops a PICTURE frame that is not renderable", () => {
    const pic = (id: string, content: TreeFrame["content"]) =>
      makeFrame({ id, type: "PICTURE", content });
    const tree = makeTree({
      panels: [
        makePanel({
          frames: [
            pic("ok", {
              picture: {
                mode: "fit",
                mediaAsset: { kind: "IMAGE", storageKey: "img-key", status: "READY", archivedAt: null },
              },
            }),
            pic("no-picture", { picture: null }),
            pic("no-asset", { picture: { mode: null, mediaAsset: null } }),
            pic("processing", {
              picture: {
                mode: null,
                mediaAsset: { kind: "IMAGE", storageKey: "k", status: "PROCESSING", archivedAt: null },
              },
            }),
            pic("archived", {
              picture: {
                mode: null,
                mediaAsset: { kind: "IMAGE", storageKey: "k", status: "READY", archivedAt: new Date("2026-01-01T00:00:00Z") },
              },
            }),
            pic("no-key", {
              picture: {
                mode: null,
                mediaAsset: { kind: "IMAGE", storageKey: null, status: "READY", archivedAt: null },
              },
            }),
            pic("empty-key", {
              picture: {
                mode: null,
                mediaAsset: { kind: "IMAGE", storageKey: "", status: "READY", archivedAt: null },
              },
            }),
          ],
        }),
      ],
    });
    const out = run(tree);
    expect(out.panels[0].frames.map((f) => f.id)).toEqual(["ok"]);
    expect(out.panels[0].frames[0].image).toEqual({ url: "signed:img-key", mode: "fit" });
  });

  it("drops a VIDEO frame that is not renderable and keeps a duration of 0", () => {
    const tree = makeTree({
      panels: [
        makePanel({
          frames: [
            makeFrame({
              id: "ok",
              type: "VIDEO",
              durationSeconds: 0,
              content: {
                video: {
                  mediaAsset: {
                    kind: "VIDEO",
                    storageKey: "vid-key",
                    durationSeconds: 42,
                    status: "READY",
                    archivedAt: null,
                  },
                },
              },
            }),
            makeFrame({ id: "no-asset", type: "VIDEO", content: { video: { mediaAsset: null } } }),
            makeFrame({
              id: "processing",
              type: "VIDEO",
              content: {
                video: {
                  mediaAsset: { kind: "VIDEO", storageKey: "k", durationSeconds: null, status: "PROCESSING", archivedAt: null },
                },
              },
            }),
            makeFrame({
              id: "archived",
              type: "VIDEO",
              content: {
                video: {
                  mediaAsset: {
                    kind: "VIDEO",
                    storageKey: "k",
                    durationSeconds: null,
                    status: "READY",
                    archivedAt: new Date("2026-01-01T00:00:00Z"),
                  },
                },
              },
            }),
            makeFrame({
              id: "no-key",
              type: "VIDEO",
              content: {
                video: {
                  mediaAsset: { kind: "VIDEO", storageKey: null, durationSeconds: null, status: "READY", archivedAt: null },
                },
              },
            }),
          ],
        }),
      ],
    });
    const out = run(tree);
    expect(out.panels[0].frames.map((f) => f.id)).toEqual(["ok"]);
    expect(out.panels[0].frames[0].durationSeconds).toBe(0);
    expect(out.panels[0].frames[0].video).toEqual({ url: "signed:vid-key", durationSeconds: 42 });
  });

  it("drops a WEB frame with a null content.web or an empty url", () => {
    const tree = makeTree({
      panels: [
        makePanel({
          frames: [
            makeFrame({ id: "ok", type: "WEB", content: { web: { url: "https://example.com" } } }),
            makeFrame({ id: "no-web", type: "WEB", content: { web: null } }),
            makeFrame({ id: "empty", type: "WEB", content: { web: { url: "" } } }),
          ],
        }),
      ],
    });
    const out = run(tree);
    expect(out.panels[0].frames.map((f) => f.id)).toEqual(["ok"]);
    expect(out.panels[0].frames[0]).toMatchObject({ kind: "web", web: { url: "https://example.com" } });
  });

  it("drops a MEMO frame with a null content.memo or an empty body", () => {
    const tree = makeTree({
      panels: [
        makePanel({
          frames: [
            makeFrame({ id: "ok", type: "MEMO", content: { memo: { body: "note" } } }),
            makeFrame({ id: "no-memo", type: "MEMO", content: { memo: null } }),
            makeFrame({ id: "empty", type: "MEMO", content: { memo: { body: "" } } }),
          ],
        }),
      ],
    });
    const out = run(tree);
    expect(out.panels[0].frames.map((f) => f.id)).toEqual(["ok"]);
    expect(out.panels[0].frames[0]).toMatchObject({ kind: "text", text: { body: "note" } });
  });

  it("never drops a CLOCK frame and emits defaults when content.clock is null", () => {
    const tree = makeTree({
      panels: [
        makePanel({
          frames: [makeFrame({ id: "clk", type: "CLOCK", content: { clock: null } })],
        }),
      ],
    });
    const out = run(tree);
    expect(out.panels[0].frames).toEqual([
      {
        id: "clk",
        durationSeconds: 10,
        kind: "clock",
        clock: {
          showDate: false,
          showTime: false,
          showSeconds: false,
          label: null,
          timeZone: null,
          style: 0,
        },
      },
    ]);
  });

  it("maps clock.style from content.clock.type and passes the flags through", () => {
    const tree = makeTree({
      panels: [
        makePanel({
          frames: [
            makeFrame({
              id: "clk",
              type: "CLOCK",
              content: {
                clock: {
                  type: 3,
                  showDate: true,
                  showTime: true,
                  showSeconds: false,
                  label: "Reception",
                  timeZone: "Europe/Rome",
                },
              },
            }),
          ],
        }),
      ],
    });
    const out = run(tree);
    expect(out.panels[0].frames[0].clock).toEqual({
      showDate: true,
      showTime: true,
      showSeconds: false,
      label: "Reception",
      timeZone: "Europe/Rome",
      style: 3,
    });
  });

  it("omits a panel whose every frame is dropped", () => {
    const tree = makeTree({
      panels: [
        makePanel({ id: "keep", zIndex: 0 }),
        makePanel({
          id: "gone",
          zIndex: 1,
          frames: [
            makeFrame({ id: "a", type: "HTML" }),
            makeFrame({ id: "b", content: null }),
          ],
        }),
      ],
    });
    const out = run(tree);
    expect(out.panels.map((p) => p.id)).toEqual(["keep"]);
  });

  it("calls signUrl once per distinct storageKey across pictures, videos, and the background", () => {
    const sign = vi.fn((key: string) => `signed:${key}`);
    const tree = makeTree({
      backgroundImage: { storageKey: "bg-key" },
      panels: [
        makePanel({
          id: "p1",
          frames: [
            makeFrame({
              id: "img-a",
              type: "PICTURE",
              content: { picture: { mode: null, mediaAsset: { kind: "IMAGE", storageKey: "shared", status: "READY", archivedAt: null } } },
            }),
            makeFrame({
              id: "img-b",
              type: "PICTURE",
              content: { picture: { mode: null, mediaAsset: { kind: "IMAGE", storageKey: "shared", status: "READY", archivedAt: null } } },
            }),
          ],
        }),
        makePanel({
          id: "p2",
          zIndex: 1,
          frames: [
            makeFrame({
              id: "vid",
              type: "VIDEO",
              content: { video: { mediaAsset: { kind: "VIDEO", storageKey: "vid-key", durationSeconds: 5, status: "READY", archivedAt: null } } },
            }),
          ],
        }),
      ],
    });
    const out = run(tree, sign);
    expect(sign).toHaveBeenCalledTimes(3);
    expect(sign.mock.calls.map((c) => c[0]).sort()).toEqual(["bg-key", "shared", "vid-key"]);
    expect(out.background.imageUrl).toBe("signed:bg-key");
    expect(out.panels[0].frames.map((f) => f.image?.url)).toEqual(["signed:shared", "signed:shared"]);
    expect(out.panels[1].frames[0].video?.url).toBe("signed:vid-key");
  });

  it("leaves imageUrl null when the background image storageKey is null", () => {
    const tree = makeTree({ backgroundImage: { storageKey: null } });
    const out = run(tree);
    expect(out.background.imageUrl).toBeNull();
  });

  it("lowercases the kind for all five renderable types", () => {
    const tree = makeTree({
      panels: [
        makePanel({
          frames: [
            makeFrame({ id: "a", sortOrder: 0, type: "CLOCK", content: { clock: null } }),
            makeFrame({
              id: "b",
              sortOrder: 1,
              type: "PICTURE",
              content: { picture: { mode: null, mediaAsset: { kind: "IMAGE", storageKey: "k1", status: "READY", archivedAt: null } } },
            }),
            makeFrame({
              id: "c",
              sortOrder: 2,
              type: "VIDEO",
              content: { video: { mediaAsset: { kind: "VIDEO", storageKey: "k2", durationSeconds: 1, status: "READY", archivedAt: null } } },
            }),
            makeFrame({ id: "d", sortOrder: 3, type: "MEMO", content: { memo: { body: "m" } } }),
            makeFrame({ id: "e", sortOrder: 4, type: "WEB", content: { web: { url: "https://e.com" } } }),
          ],
        }),
      ],
    });
    const out = run(tree);
    expect(out.panels[0].frames.map((f) => f.kind)).toEqual(["clock", "image", "video", "text", "web"]);
  });

  it("produces a manifest with no Date anywhere in its JSON", () => {
    const tree = makeTree({
      backgroundImage: { storageKey: "bg" },
      panels: [
        makePanel({
          frames: [
            makeFrame({
              id: "pic",
              type: "PICTURE",
              content: {
                picture: {
                  mode: "fill",
                  mediaAsset: { kind: "IMAGE", storageKey: "k", status: "READY", archivedAt: new Date("2020-01-01T00:00:00Z") },
                },
              },
            }),
            makeFrame({
              id: "pic-ok",
              sortOrder: 1,
              type: "PICTURE",
              content: {
                picture: {
                  mode: "fill",
                  mediaAsset: { kind: "IMAGE", storageKey: "k", status: "READY", archivedAt: null },
                },
              },
            }),
          ],
        }),
      ],
    });
    const json = JSON.stringify(run(tree));
    expect(json).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
    expect(json).not.toContain("archivedAt");
  });
});
