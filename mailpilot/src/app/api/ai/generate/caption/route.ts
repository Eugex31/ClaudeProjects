import { NextResponse } from "next/server";
import { withAuth } from "@/lib/apiHandler";
import { generateCaptionInputSchema } from "@/lib/validation/ai.schema";
import { checkAiUsageLimit } from "@/lib/billing";
import { generateSocialCaption, NoAiConnectionError } from "@/lib/ai/generate";
import { incrementTodayAiUsage } from "@/lib/aiUsage";

export const POST = withAuth(async (req, { userId }) => {
  const input = generateCaptionInputSchema.parse(await req.json());

  const usageCheck = await checkAiUsageLimit(userId);
  if (!usageCheck.allowed) {
    return NextResponse.json({ error: usageCheck.message, upgradeRequired: true }, { status: 402 });
  }

  try {
    const result = await generateSocialCaption(userId, input);
    await incrementTodayAiUsage(userId);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof NoAiConnectionError) {
      return NextResponse.json({ error: err.message, noConnection: true }, { status: 400 });
    }
    throw err;
  }
});
