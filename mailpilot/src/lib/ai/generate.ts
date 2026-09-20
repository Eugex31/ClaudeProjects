import { prisma } from "@/lib/prisma";
import { decryptToken } from "@/lib/crypto/tokenCipher";
import { generateJson as generateJsonOpenAi, generateImage } from "@/lib/ai/providers/openai";
import { generateJson as generateJsonAnthropic } from "@/lib/ai/providers/anthropic";
import type { AiConnection } from "@prisma/client";

export class NoAiConnectionError extends Error {
  constructor() {
    super("No connected AI provider for this user");
    this.name = "NoAiConnectionError";
  }
}

// Resolves the user's default connection, or a specific one if connectionId
// is given (e.g. a picker in the generation panel). Mirrors getGmailClient's
// "throw a typed not-connected error, let the caller decide how to surface
// it" shape rather than returning null.
export async function resolveAiConnection(userId: string, connectionId?: string): Promise<AiConnection> {
  const connection = connectionId
    ? await prisma.aiConnection.findFirst({ where: { id: connectionId, userId } })
    : await prisma.aiConnection.findFirst({ where: { userId, isDefault: true } }) ??
      (await prisma.aiConnection.findFirst({ where: { userId }, orderBy: { createdAt: "asc" } }));

  if (!connection) throw new NoAiConnectionError();
  return connection;
}

const EMAIL_KIND_GUIDANCE: Record<string, string> = {
  campaign: "a one-off marketing email campaign",
  template: "a reusable email template",
  "sequence-step": "one step in a multi-week automated email sequence — keep it feeling like a short, personal note, not a heavy newsletter",
  newsletter: "a recurring newsletter email",
};

export type GenerateEmailInput = {
  prompt: string;
  kind: "campaign" | "template" | "sequence-step" | "newsletter";
  existingSubject?: string;
  existingBody?: string;
  connectionId?: string;
};

export type GenerateEmailResult = { subject: string; bodyHtml: string };

// Output is plain HTML (paragraphs, basic formatting, a merge var like
// {{first_name}} where natural) — NOT a full branded template with tables/
// inline CSS. It is sanitized through the exact same composeEmail.ts
// pipeline as any other body before ever reaching an editor or a save, so
// model output is treated with the same distrust as a customer's own pasted
// HTML, never as a second trust boundary.
export async function generateEmailContent(userId: string, input: GenerateEmailInput): Promise<GenerateEmailResult> {
  const connection = await resolveAiConnection(userId, input.connectionId);
  const apiKey = decryptToken(connection.apiKey);

  const kindGuidance = EMAIL_KIND_GUIDANCE[input.kind] ?? EMAIL_KIND_GUIDANCE.campaign;
  const system = [
    `You write marketing email copy. The user is writing ${kindGuidance}.`,
    "Respond with ONLY a JSON object of the shape {\"subject\": string, \"bodyHtml\": string} — no other text.",
    "bodyHtml should be plain HTML using only <p>, <br>, <b>, <strong>, <i>, <em>, <ul>, <ol>, <li>, <a href=\"...\"> — no <html>/<head>/<style>/<table>, those are added separately by the app.",
    "Use {{first_name}} where a personal greeting is natural. Keep it concise and free of filler.",
    input.existingSubject || input.existingBody
      ? `Revise this existing draft rather than starting from scratch — Subject: ${input.existingSubject ?? "(none)"} Body: ${input.existingBody ?? "(none)"}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  const raw =
    connection.provider === "OPENAI"
      ? await generateJsonOpenAi(apiKey, system, input.prompt)
      : await generateJsonAnthropic(apiKey, system, input.prompt);

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("AI provider returned invalid JSON");
  }
  const { subject, bodyHtml } = parsed as { subject?: unknown; bodyHtml?: unknown };
  if (typeof subject !== "string" || typeof bodyHtml !== "string") {
    throw new Error("AI provider response was missing subject/bodyHtml");
  }

  return { subject, bodyHtml };
}

export type GenerateCaptionInput = { prompt: string; connectionId?: string };

// Reuses the same generateJson provider functions as generateEmailContent —
// only the system prompt differs (short, platform-appropriate, plain text,
// no HTML) — rather than a separate text-generation code path.
export async function generateSocialCaption(userId: string, input: GenerateCaptionInput): Promise<{ caption: string }> {
  const connection = await resolveAiConnection(userId, input.connectionId);
  const apiKey = decryptToken(connection.apiKey);

  const system = [
    "You write short, engaging social media captions for Facebook and Instagram posts.",
    "Respond with ONLY a JSON object of the shape {\"caption\": string} — no other text.",
    "Keep it concise (a few sentences at most), plain text only (no HTML/markdown), and include 2-5 relevant hashtags at the end where natural.",
  ].join("\n");

  const raw =
    connection.provider === "OPENAI"
      ? await generateJsonOpenAi(apiKey, system, input.prompt)
      : await generateJsonAnthropic(apiKey, system, input.prompt);

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("AI provider returned invalid JSON");
  }
  const { caption } = parsed as { caption?: unknown };
  if (typeof caption !== "string") {
    throw new Error("AI provider response was missing caption");
  }
  return { caption };
}

// Anthropic connections can't generate images (see providers/openai.ts) — if
// the user's resolved connection is Anthropic, this falls back to their
// oldest OPENAI connection instead of failing outright, since "generate an
// image" is a reasonable ask regardless of which provider is set as default
// for text. Still throws NoAiConnectionError if they have no OpenAI
// connection at all.
async function resolveImageConnection(userId: string, connectionId?: string): Promise<AiConnection> {
  const connection = await resolveAiConnection(userId, connectionId);
  if (connection.provider === "OPENAI") return connection;

  const openAiConnection = await prisma.aiConnection.findFirst({
    where: { userId, provider: "OPENAI" },
    orderBy: { createdAt: "asc" },
  });
  if (!openAiConnection) throw new NoAiConnectionError();
  return openAiConnection;
}

// Stores the result in TemplateImage (src/app/api/template-images/[id]/route.ts's
// public GET route already serves any row in that table by id) — the same
// shared, publicly-reachable image store the visual template editor's
// AssetManager uploads into, reused here rather than inventing a second
// image table, per the "unify template and social image storage" call in
// the AI-powered platform plan.
export async function generateImageAsset(
  userId: string,
  input: { prompt: string; connectionId?: string }
): Promise<{ id: string; contentType: string }> {
  const connection = await resolveImageConnection(userId, input.connectionId);
  const apiKey = decryptToken(connection.apiKey);
  const bytes = await generateImage(apiKey, input.prompt);

  const image = await prisma.templateImage.create({
    data: { userId, data: bytes, contentType: "image/png", filename: null },
  });
  return { id: image.id, contentType: image.contentType };
}
