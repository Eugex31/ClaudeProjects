// Pure assembly of a canvas manifest from a loaded canvas tree. No I/O, no
// network, no database, no clock. The function never throws: any frame it
// cannot render is silently dropped, and a panel left with no frames is dropped
// with it. The output is fully serializable (no Date values).

import type { FrameType } from "@prisma/client";

export type CanvasTree = {
  id: string;
  name: string;
  revision: number;
  width: number;
  height: number;
  backgroundColor: string | null;
  backgroundImage: { storageKey: string | null } | null;
  panels: Array<{
    id: string;
    name: string | null;
    x: number;
    y: number;
    width: number;
    height: number;
    zIndex: number;
    noScroll: boolean;
    frames: Array<{
      id: string;
      durationSeconds: number;
      type: FrameType;
      sortOrder: number;
      content: {
        clock?: {
          type: number;
          showDate: boolean;
          showTime: boolean;
          showSeconds: boolean;
          label: string | null;
          timeZone: string | null;
        } | null;
        picture?: {
          mode: string | null;
          mediaAsset: {
            kind: "IMAGE";
            storageKey: string | null;
            status: string;
            archivedAt: Date | null;
          } | null;
        } | null;
        video?: {
          mediaAsset: {
            kind: "VIDEO";
            storageKey: string | null;
            durationSeconds: number | null;
            status: string;
            archivedAt: Date | null;
          } | null;
        } | null;
        memo?: { body: string } | null;
        web?: { url: string } | null;
      } | null;
    }>;
  }>;
};

export type CanvasManifestFrame = {
  id: string;
  durationSeconds: number;
  kind: "image" | "video" | "text" | "clock" | "web";
  image?: { url: string; mode: string | null };
  video?: { url: string; durationSeconds: number | null };
  text?: { body: string };
  clock?: {
    showDate: boolean;
    showTime: boolean;
    showSeconds: boolean;
    label: string | null;
    timeZone: string | null;
    style: number;
  };
  web?: { url: string };
};

export type CanvasManifestPanel = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
  noScroll: boolean;
  frames: CanvasManifestFrame[];
};

export type CanvasManifest = {
  id: string;
  name: string;
  revision: number;
  width: number;
  height: number;
  background: { color: string | null; imageUrl: string | null };
  panels: CanvasManifestPanel[];
};

type Panel = CanvasTree["panels"][number];
type Frame = Panel["frames"][number];
type Content = NonNullable<Frame["content"]>;

const RENDERABLE = new Set<FrameType>(["CLOCK", "PICTURE", "VIDEO", "MEMO", "WEB"]);

const CLOCK_DEFAULTS = {
  showDate: false,
  showTime: false,
  showSeconds: false,
  label: null,
  timeZone: null,
  style: 0,
} as const;

export function assembleCanvasManifest(
  tree: CanvasTree,
  signUrl: (storageKey: string) => string,
): CanvasManifest {
  const urlByKey = buildUrlByKey(tree, signUrl);
  const backgroundKey = nonEmpty(tree.backgroundImage?.storageKey ?? null);

  const panels: CanvasManifestPanel[] = [];
  for (const panel of [...tree.panels].sort(comparePanels)) {
    const frames: CanvasManifestFrame[] = [];
    for (const frame of [...panel.frames].sort(compareFrames)) {
      const assembled = assembleFrame(frame, urlByKey);
      if (assembled != null) frames.push(assembled);
    }
    if (frames.length === 0) continue;
    panels.push({
      id: panel.id,
      x: panel.x,
      y: panel.y,
      width: panel.width,
      height: panel.height,
      zIndex: panel.zIndex,
      noScroll: panel.noScroll,
      frames,
    });
  }

  return {
    id: tree.id,
    name: tree.name,
    revision: tree.revision,
    width: tree.width,
    height: tree.height,
    background: {
      color: tree.backgroundColor,
      imageUrl: backgroundKey == null ? null : urlByKey.get(backgroundKey) ?? null,
    },
    panels,
  };
}

/**
 * One signed URL per distinct storage key, resolved up front. Keys are gathered
 * from every picture asset, every video asset, and the background image, so
 * `signUrl` runs exactly once per distinct key.
 */
function buildUrlByKey(
  tree: CanvasTree,
  signUrl: (storageKey: string) => string,
): Map<string, string> {
  const keys = new Set<string>();

  const backgroundKey = nonEmpty(tree.backgroundImage?.storageKey ?? null);
  if (backgroundKey != null) keys.add(backgroundKey);

  for (const panel of tree.panels) {
    for (const frame of panel.frames) {
      const content = frame.content;
      if (content == null) continue;
      const pictureKey = nonEmpty(content.picture?.mediaAsset?.storageKey ?? null);
      if (pictureKey != null) keys.add(pictureKey);
      const videoKey = nonEmpty(content.video?.mediaAsset?.storageKey ?? null);
      if (videoKey != null) keys.add(videoKey);
    }
  }

  const map = new Map<string, string>();
  for (const key of keys) map.set(key, signUrl(key));
  return map;
}

function assembleFrame(
  frame: Frame,
  urlByKey: Map<string, string>,
): CanvasManifestFrame | null {
  if (!RENDERABLE.has(frame.type)) return null;
  const content = frame.content;
  if (content == null) return null;

  switch (frame.type) {
    case "CLOCK":
      return {
        id: frame.id,
        durationSeconds: frame.durationSeconds,
        kind: "clock",
        clock: assembleClock(content),
      };
    case "PICTURE": {
      const picture = content.picture;
      const asset = picture?.mediaAsset ?? null;
      if (!isRenderableAsset(asset)) return null;
      const url = urlByKey.get(asset.storageKey);
      if (url == null) return null;
      return {
        id: frame.id,
        durationSeconds: frame.durationSeconds,
        kind: "image",
        image: { url, mode: picture?.mode ?? null },
      };
    }
    case "VIDEO": {
      const asset = content.video?.mediaAsset ?? null;
      if (!isRenderableAsset(asset)) return null;
      const url = urlByKey.get(asset.storageKey);
      if (url == null) return null;
      return {
        id: frame.id,
        durationSeconds: frame.durationSeconds,
        kind: "video",
        video: { url, durationSeconds: asset.durationSeconds ?? null },
      };
    }
    case "MEMO": {
      const body = content.memo?.body ?? "";
      if (body === "") return null;
      return {
        id: frame.id,
        durationSeconds: frame.durationSeconds,
        kind: "text",
        text: { body },
      };
    }
    case "WEB": {
      const url = content.web?.url ?? "";
      if (url === "") return null;
      return {
        id: frame.id,
        durationSeconds: frame.durationSeconds,
        kind: "web",
        web: { url },
      };
    }
    default:
      return null;
  }
}

function assembleClock(content: Content): NonNullable<CanvasManifestFrame["clock"]> {
  const clock = content.clock;
  if (clock == null) return { ...CLOCK_DEFAULTS };
  return {
    showDate: clock.showDate,
    showTime: clock.showTime,
    showSeconds: clock.showSeconds,
    label: clock.label,
    timeZone: clock.timeZone,
    style: clock.type,
  };
}

type AssetLike = { storageKey: string | null; status: string; archivedAt: Date | null };

function isRenderableAsset<T extends AssetLike>(
  asset: T | null,
): asset is T & { storageKey: string } {
  if (asset == null) return false;
  if (asset.status !== "READY") return false;
  if (asset.archivedAt != null) return false;
  return nonEmpty(asset.storageKey) != null;
}

function nonEmpty(value: string | null): string | null {
  return value == null || value === "" ? null : value;
}

function comparePanels(a: Panel, b: Panel): number {
  if (a.zIndex !== b.zIndex) return a.zIndex - b.zIndex;
  return compareIds(a.id, b.id);
}

function compareFrames(a: Frame, b: Frame): number {
  if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
  return compareIds(a.id, b.id);
}

function compareIds(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}
