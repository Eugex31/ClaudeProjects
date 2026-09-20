import { NextResponse } from "next/server";
import { withAuth } from "@/lib/apiHandler";
import { generateEmailInputSchema } from "@/lib/validation/ai.schema";
import { checkAiUsageLimit } from "@/lib/billing";
import { generateEmailContent, NoAiConnectionError } from "@/lib/ai/generate";
import { incrementTodayAiUsage } from "@/lib/aiUsage";

export const POST = withAuth(async (req, { userId }) => {
  const input = generateEmailInputSchema.parse(await req.json());

  const usageCheck = await checkAiUsageLimit(userId);
  if (!usageCheck.allowed) {
    return NextResponse.json({ error: usageCheck.message, upgradeRequired: true }, { status: 402 });
  }

  try {
    const result = await generateEmailContent(userId, input);
    await incrementTodayAiUsage(userId); // only on success — a failed generation shouldn't count against the cap
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof NoAiConnectionError) {
      return NextResponse.json({ error: err.message, noConnection: true }, { status: 400 });
    }
    throw err;
  }
});
