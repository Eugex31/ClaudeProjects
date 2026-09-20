import { prisma } from "@/lib/prisma";

// Same shape as src/lib/dailyLimit.ts's SendCounter helpers — one row per
// user per day, summed across a billing period by checkAiUsageLimit
// (src/lib/billing.ts). Counts generations only, never cost, since BYOK
// means the platform never pays per token.
function todayUtc(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export async function incrementTodayAiUsage(userId: string): Promise<void> {
  await prisma.aiUsageCounter.upsert({
    where: { userId_date: { userId, date: todayUtc() } },
    create: { userId, date: todayUtc(), count: 1 },
    update: { count: { increment: 1 } },
  });
}
