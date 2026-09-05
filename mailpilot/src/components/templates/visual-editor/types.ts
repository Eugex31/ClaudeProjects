export type TemplateRecord = {
  id: string;
  name: string;
  subject: string;
  body: string;
  bodyFormat: "RICH_TEXT" | "HTML";
  editorSource: string | null;
  categoryId: string | null;
};

export type PaletteGroupKey = "content" | "body" | "images" | "more";

export const PALETTE_GROUP_LABELS: Record<PaletteGroupKey, string> = {
  content: "Content",
  body: "Body",
  images: "Images",
  more: "More",
};
