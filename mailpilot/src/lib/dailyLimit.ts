import { prisma } from "@/lib/prisma";

function todayUtc(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export async function getTodaySentCount(userId: string): Promise<number> {
  const row = await prisma.sendCounter.findUnique({
    where: { userId_date: { userId, date: todayUtc() } },
  });
  return row?.sentCount ?? 0;
}

export async function incrementTodaySentCount(userId: string): Promise<void> {
  await prisma.sendCounter.upsert({
    where: { userId_date: { userId, date: todayUtc() } },
    create: { userId, date: todayUtc(), sentCount: 1 },
    update: { sentCount: { increment: 1 } },
  });
}
