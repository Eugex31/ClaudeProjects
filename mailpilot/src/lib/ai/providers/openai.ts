import OpenAI from "openai";

const MODEL = "gpt-4o-mini";

export async function verifyOpenAiKey(apiKey: string): Promise<boolean> {
  try {
    await new OpenAI({ apiKey }).models.list();
    return true;
  } catch {
    return false;
  }
}

// Anthropic has no first-party image-generation endpoint, so image
// generation always routes through OpenAI's Images API regardless of which
// provider is connected for text — see resolveImageConnection in generate.ts.
export async function generateImage(apiKey: string, prompt: string): Promise<Uint8Array<ArrayBuffer>> {
  const client = new OpenAI({ apiKey });
  const response = await client.images.generate({ model: "gpt-image-1", prompt, size: "1024x1024" });
  const b64 = response.data?.[0]?.b64_json;
  if (!b64) throw new Error("OpenAI returned no image data");
  // Buffer.from(str, encoding) is typed Buffer<ArrayBufferLike> (it may be
  // backed by a SharedArrayBuffer), which Prisma's Bytes field
  // (Uint8Array<ArrayBuffer>) rejects. `new Uint8Array(length)` is the one
  // constructor overload TS pins to a plain ArrayBuffer, so allocate that
  // way and copy the decoded bytes in.
  const decoded = Buffer.from(b64, "base64");
  const out = new Uint8Array(decoded.length);
  out.set(decoded);
  return out;
}

export async function generateJson(apiKey: string, system: string, prompt: string): Promise<string> {
  const client = new OpenAI({ apiKey });
  const response = await client.chat.completions.create({
    model: MODEL,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: system },
      { role: "user", content: prompt },
    ],
  });
  const content = response.choices[0]?.message?.content;
  if (!content) throw new Error("OpenAI returned an empty response");
  return content;
}
