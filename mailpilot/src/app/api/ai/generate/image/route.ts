import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/apiHandler";
import { generateImageInputSchema } from "@/lib/validation/ai.schema";
import { checkAiUsageLimit } from "@/lib/billing";
import { generateImageAsset, NoAiConnectionError } from "@/lib/ai/generate";
import { incrementTodayAiUsage } from "@/lib/aiUsage";

export const POST = withAuth(async (req: NextRequest, { userId }) => {
  const input = generateImageInputSchema.parse(await req.json());

  const usageCheck = await checkAiUsageLimit(userId);
  if (!usageCheck.allowed) {
    return NextResponse.json({ error: usageCheck.message, upgradeRequired: true }, { status: 402 });
  }

  try {
    const image = await generateImageAsset(userId, input);
    await incrementTodayAiUsage(userId);
    // Same absolute-URL convention as POST /api/template-images — this gets
    // embedded in outgoing HTML (campaigns, templates, and eventually social
    // posts), so it must resolve for an external fetch, not just same-origin.
    const baseUrl = process.env.NEXTAUTH_URL ?? new URL(req.url).origin;
    return NextResponse.json({ id: image.id, url: `${baseUrl}/api/template-images/${image.id}` });
  } catch (err) {
    if (err instanceof NoAiConnectionError) {
      return NextResponse.json(
        { error: "Connect an OpenAI API key to generate images (Anthropic has no image generation).", noConnection: true },
        { status: 400 }
      );
    }
    throw err;
  }
});
