import Anthropic from "@anthropic-ai/sdk";

const MODEL = "claude-sonnet-4-5";

export async function verifyAnthropicKey(apiKey: string): Promise<boolean> {
  try {
    await new Anthropic({ apiKey }).messages.create({
      model: MODEL,
      max_tokens: 1,
      messages: [{ role: "user", content: "hi" }],
    });
    return true;
  } catch {
    return false;
  }
}

// Anthropic has no OpenAI-style `response_format: json_object` mode — the
// system prompt instructs the model to return ONLY a JSON object, and this
// strips any stray prose around it (a model occasionally wraps JSON in a
// code fence or a one-line preamble despite instructions) before the caller
// parses it. This is the one place Anthropic's output needs extra handling
// that OpenAI's generateJson doesn't.
export async function generateJson(apiKey: string, system: string, prompt: string): Promise<string> {
  const client = new Anthropic({ apiKey });
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 4096,
    system,
    messages: [{ role: "user", content: prompt }],
  });
  const block = response.content.find((b) => b.type === "text");
  if (!block || block.type !== "text") throw new Error("Anthropic returned an empty response");

  const match = block.text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("Anthropic response did not contain a JSON object");
  return match[0];
}
