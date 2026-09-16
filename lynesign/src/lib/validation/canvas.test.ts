import { describe, it, expect } from "vitest";

import {
  idSchema,
  createCanvasSchema,
  updateCanvasSchema,
  panelSchema,
  createPanelSchema,
  updatePanelsSchema,
  frameSchema,
  createFrameSchema,
  reorderFramesSchema,
  setFrameDurationSchema,
  imageContentSchema,
  videoContentSchema,
  textContentSchema,
  clockContentSchema,
  webContentSchema,
  setScreenContentSourceSchema,
} from "./canvas";

const canvasId = "ccanvas000000000000000001";
const panelId = "cpanel0000000000000000001";
const frameId = "cframe0000000000000000001";
const screenId = "cscreen000000000000000001";
const playlistId = "cplaylist0000000000000001";
const mediaId = "cmedia0000000000000000001";
const imageId = "cimage0000000000000000001";

describe("idSchema", () => {
  it("accepts a cuid and rejects anything else", () => {
    expect(idSchema.safeParse({ id: panelId }).success).toBe(true);
    expect(idSchema.safeParse({ id: "nope" }).success).toBe(false);
    expect(idSchema.safeParse({}).success).toBe(false);
  });
});

describe("createCanvasSchema", () => {
  const base = { name: "Lobby", width: 1920, height: 1080 };

  it("accepts a minimal valid object", () => {
    expect(createCanvasSchema.safeParse(base).success).toBe(true);
  });

  it("accepts an optional hex colour and a background image id", () => {
    expect(
      createCanvasSchema.safeParse({ ...base, backgroundColor: "#0aF3Bc", backgroundImageId: imageId })
        .success,
    ).toBe(true);
  });

  it("rejects a width below 240", () => {
    expect(createCanvasSchema.safeParse({ ...base, width: 100 }).success).toBe(false);
  });

  it("rejects a width above 7680 and a non integer size", () => {
    expect(createCanvasSchema.safeParse({ ...base, width: 8000 }).success).toBe(false);
    expect(createCanvasSchema.safeParse({ ...base, height: 720.5 }).success).toBe(false);
  });

  it("rejects a blank name", () => {
    expect(createCanvasSchema.safeParse({ ...base, name: "" }).success).toBe(false);
    expect(createCanvasSchema.safeParse({ ...base, name: "   " }).success).toBe(false);
  });

  it("rejects a colour that is not a six digit hex", () => {
    expect(createCanvasSchema.safeParse({ ...base, backgroundColor: "red" }).success).toBe(false);
    expect(createCanvasSchema.safeParse({ ...base, backgroundColor: "#fff" }).success).toBe(false);
  });
});

describe("updateCanvasSchema", () => {
  it("accepts an empty patch and a single field patch", () => {
    expect(updateCanvasSchema.safeParse({}).success).toBe(true);
    expect(updateCanvasSchema.safeParse({ name: "New" }).success).toBe(true);
  });

  it("still enforces the field bounds when a field is present", () => {
    expect(updateCanvasSchema.safeParse({ width: 100 }).success).toBe(false);
  });
});

describe("panelSchema / createPanelSchema", () => {
  const panel = {
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    zIndex: 0,
    noScroll: false,
  };

  it("accepts a valid panel and an optional name", () => {
    expect(panelSchema.safeParse(panel).success).toBe(true);
    expect(panelSchema.safeParse({ ...panel, name: "Header" }).success).toBe(true);
  });

  it("rejects a zero width and an out of range zIndex", () => {
    expect(panelSchema.safeParse({ ...panel, width: 0 }).success).toBe(false);
    expect(panelSchema.safeParse({ ...panel, zIndex: 10000 }).success).toBe(false);
  });

  it("requires noScroll", () => {
    const { noScroll, ...rest } = panel;
    void noScroll;
    expect(panelSchema.safeParse(rest).success).toBe(false);
  });

  it("createPanelSchema also requires a canvasId cuid", () => {
    expect(createPanelSchema.safeParse({ ...panel, canvasId }).success).toBe(true);
    expect(createPanelSchema.safeParse(panel).success).toBe(false);
    expect(createPanelSchema.safeParse({ ...panel, canvasId: "x" }).success).toBe(false);
  });
});

describe("updatePanelsSchema", () => {
  it("accepts a batch of id plus partial panel entries", () => {
    expect(updatePanelsSchema.safeParse({ panels: [{ id: panelId, x: 10 }] }).success).toBe(true);
  });

  it("rejects an empty array", () => {
    expect(updatePanelsSchema.safeParse({ panels: [] }).success).toBe(false);
  });

  it("rejects more than 200 entries", () => {
    const many = Array.from({ length: 201 }, () => ({ id: panelId }));
    expect(updatePanelsSchema.safeParse({ panels: many }).success).toBe(false);
  });

  it("rejects an entry with no id", () => {
    expect(updatePanelsSchema.safeParse({ panels: [{ x: 10 }] }).success).toBe(false);
  });

  it("rejects an entry whose partial field is out of range", () => {
    expect(updatePanelsSchema.safeParse({ panels: [{ id: panelId, width: 0 }] }).success).toBe(false);
  });
});

describe("frameSchema / createFrameSchema", () => {
  it("accepts each Plan 1 frame type", () => {
    for (const type of ["CLOCK", "PICTURE", "VIDEO", "MEMO", "WEB"]) {
      expect(frameSchema.safeParse({ durationSeconds: 10, type }).success).toBe(true);
    }
  });

  it("rejects a type outside the Plan 1 enum", () => {
    expect(frameSchema.safeParse({ durationSeconds: 10, type: "YOUTUBE" }).success).toBe(false);
    expect(frameSchema.safeParse({ durationSeconds: 10, type: "HTML" }).success).toBe(false);
  });

  it("rejects a negative or oversized duration", () => {
    expect(frameSchema.safeParse({ durationSeconds: -1, type: "CLOCK" }).success).toBe(false);
    expect(frameSchema.safeParse({ durationSeconds: 86401, type: "CLOCK" }).success).toBe(false);
  });

  it("createFrameSchema requires a panelId cuid", () => {
    expect(
      createFrameSchema.safeParse({ panelId, type: "PICTURE", durationSeconds: 8 }).success,
    ).toBe(true);
    expect(createFrameSchema.safeParse({ type: "PICTURE", durationSeconds: 8 }).success).toBe(false);
    expect(
      createFrameSchema.safeParse({ panelId, type: "HTML", durationSeconds: 8 }).success,
    ).toBe(false);
  });
});

describe("reorderFramesSchema", () => {
  it("accepts a valid panelId with a list of frame cuids", () => {
    expect(
      reorderFramesSchema.safeParse({ panelId, frameIds: [frameId, frameId] }).success,
    ).toBe(true);
  });

  it("rejects an empty frameIds list", () => {
    expect(reorderFramesSchema.safeParse({ panelId, frameIds: [] }).success).toBe(false);
  });

  it("rejects a non cuid frame id", () => {
    expect(reorderFramesSchema.safeParse({ panelId, frameIds: ["nope"] }).success).toBe(false);
  });
});

describe("setFrameDurationSchema", () => {
  it("accepts a bounded duration and rejects a negative one", () => {
    expect(setFrameDurationSchema.safeParse({ id: frameId, durationSeconds: 0 }).success).toBe(true);
    expect(setFrameDurationSchema.safeParse({ id: frameId, durationSeconds: -1 }).success).toBe(false);
  });
});

describe("content schemas", () => {
  it("imageContentSchema accepts an optional mode and rejects an unknown one", () => {
    expect(imageContentSchema.safeParse({ frameId, mediaAssetId: mediaId }).success).toBe(true);
    expect(
      imageContentSchema.safeParse({ frameId, mediaAssetId: mediaId, mode: "contain" }).success,
    ).toBe(true);
    expect(
      imageContentSchema.safeParse({ frameId, mediaAssetId: mediaId, mode: "zoom" }).success,
    ).toBe(false);
  });

  it("videoContentSchema needs a frameId and a mediaAssetId", () => {
    expect(videoContentSchema.safeParse({ frameId, mediaAssetId: mediaId }).success).toBe(true);
    expect(videoContentSchema.safeParse({ frameId }).success).toBe(false);
  });

  it("textContentSchema caps the body at 5000 characters", () => {
    expect(textContentSchema.safeParse({ frameId, body: "hello" }).success).toBe(true);
    expect(textContentSchema.safeParse({ frameId, body: "x".repeat(5001) }).success).toBe(false);
  });

  it("clockContentSchema rejects style 4 and accepts style 0", () => {
    const base = { frameId, style: 0, showDate: true, showTime: true, showSeconds: false };
    expect(clockContentSchema.safeParse(base).success).toBe(true);
    expect(clockContentSchema.safeParse({ ...base, style: 4 }).success).toBe(false);
    expect(clockContentSchema.safeParse({ ...base, style: -1 }).success).toBe(false);
    expect(
      clockContentSchema.safeParse({ ...base, label: "Local", timeZone: "Europe/Rome" }).success,
    ).toBe(true);
  });

  it("webContentSchema rejects junk and ftp but accepts http and https", () => {
    expect(webContentSchema.safeParse({ frameId, url: "notaurl" }).success).toBe(false);
    expect(webContentSchema.safeParse({ frameId, url: "ftp://x.test" }).success).toBe(false);
    expect(webContentSchema.safeParse({ frameId, url: "https://x.test" }).success).toBe(true);
    expect(webContentSchema.safeParse({ frameId, url: "http://x.test" }).success).toBe(true);
  });
});

describe("setScreenContentSourceSchema", () => {
  it("requires the matching id for a playlist or canvas source", () => {
    expect(setScreenContentSourceSchema.safeParse({ screenId, source: "canvas" }).success).toBe(false);
    expect(
      setScreenContentSourceSchema.safeParse({ screenId, source: "canvas", canvasId }).success,
    ).toBe(true);
    expect(setScreenContentSourceSchema.safeParse({ screenId, source: "playlist" }).success).toBe(
      false,
    );
    expect(
      setScreenContentSourceSchema.safeParse({ screenId, source: "playlist", playlistId }).success,
    ).toBe(true);
  });

  it("forbids either id when the source is none", () => {
    expect(setScreenContentSourceSchema.safeParse({ screenId, source: "none" }).success).toBe(true);
    expect(
      setScreenContentSourceSchema.safeParse({ screenId, source: "none", playlistId }).success,
    ).toBe(false);
    expect(
      setScreenContentSourceSchema.safeParse({ screenId, source: "none", canvasId }).success,
    ).toBe(false);
  });

  it("rejects an unknown source", () => {
    expect(setScreenContentSourceSchema.safeParse({ screenId, source: "widget" }).success).toBe(false);
  });
});
