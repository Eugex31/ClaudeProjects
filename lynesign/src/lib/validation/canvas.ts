import { z } from "zod";

/**
 * Input schemas for the visual canvas editor server actions. Each action
 * safe-parses its argument straight after the role check as a front gate: it
 * rejects a malformed id, an out of range size or position, a colour that is not
 * a six digit hex, a frame type outside the Plan 1 set, a non http(s) web URL
 * and a screen content source whose companion id is missing or forbidden before
 * any of that reaches the database. Sizes and positions are integer pixels.
 * This module is pure; there is no database or timezone handling here.
 */

const cuid = z.string().cuid();
const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const frameType = z.enum(["CLOCK", "PICTURE", "VIDEO", "MEMO", "WEB"]);
const durationSeconds = z.number().int().min(0).max(86400);

export const idSchema = z.object({ id: cuid });

const canvasFields = {
  name: z.string().trim().min(1).max(120),
  width: z.number().int().min(240).max(7680),
  height: z.number().int().min(240).max(7680),
  backgroundColor: hexColor.optional(),
  backgroundImageId: cuid.optional(),
};

export const createCanvasSchema = z.object(canvasFields);

export const updateCanvasSchema = z.object({
  name: canvasFields.name.optional(),
  width: canvasFields.width.optional(),
  height: canvasFields.height.optional(),
  backgroundColor: canvasFields.backgroundColor,
  backgroundImageId: canvasFields.backgroundImageId,
});

export const panelSchema = z.object({
  name: z.string().max(80).optional(),
  x: z.number().int().min(-10000).max(20000),
  y: z.number().int().min(-10000).max(20000),
  width: z.number().int().min(1).max(20000),
  height: z.number().int().min(1).max(20000),
  zIndex: z.number().int().min(0).max(9999),
  noScroll: z.boolean(),
});

export const createPanelSchema = panelSchema.extend({ canvasId: cuid });

export const updatePanelsSchema = z.object({
  panels: z
    .array(z.object({ id: cuid }).and(panelSchema.partial()))
    .min(1)
    .max(200),
});

export const frameSchema = z.object({
  durationSeconds,
  type: frameType,
});

export const createFrameSchema = z.object({
  panelId: cuid,
  type: frameType,
  durationSeconds,
});

export const reorderFramesSchema = z.object({
  panelId: cuid,
  frameIds: z.array(cuid).min(1).max(500),
});

export const setFrameDurationSchema = z.object({
  id: cuid,
  durationSeconds,
});

export const imageContentSchema = z.object({
  frameId: cuid,
  mediaAssetId: cuid,
  mode: z.enum(["cover", "contain", "fill", "none"]).optional(),
});

export const videoContentSchema = z.object({
  frameId: cuid,
  mediaAssetId: cuid,
});

export const textContentSchema = z.object({
  frameId: cuid,
  body: z.string().max(5000),
});

export const clockContentSchema = z.object({
  frameId: cuid,
  style: z.number().int().min(0).max(3),
  showDate: z.boolean(),
  showTime: z.boolean(),
  showSeconds: z.boolean(),
  // Nullable as well as optional: an explicit null is how the editor clears a
  // saved caption or time zone. Absent leaves the column alone only on the
  // create path; `setClockContent` maps both absent and null to null on update.
  label: z.string().max(40).nullable().optional(),
  timeZone: z.string().max(64).nullable().optional(),
});

export const webContentSchema = z
  .object({
    frameId: cuid,
    url: z.string().url().max(2048),
  })
  .refine((v) => /^https?:\/\//i.test(v.url), {
    message: "The URL must start with http or https.",
    path: ["url"],
  });

export const setScreenContentSourceSchema = z
  .object({
    screenId: cuid,
    source: z.enum(["playlist", "canvas", "none"]),
    playlistId: cuid.optional(),
    canvasId: cuid.optional(),
  })
  .refine(
    (v) => {
      if (v.source === "playlist") return v.playlistId != null;
      if (v.source === "canvas") return v.canvasId != null;
      return v.playlistId == null && v.canvasId == null;
    },
    {
      message:
        "A playlist source needs a playlistId, a canvas source needs a canvasId, and a none source must carry neither.",
    },
  );
