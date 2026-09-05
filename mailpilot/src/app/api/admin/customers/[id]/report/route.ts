import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withAdminAuth } from "@/lib/adminAuth";

function toCsv(rows: [string, string][]): string {
  return rows.map(([label, value]) => `${JSON.stringify(label)},${JSON.stringify(value)}`).join("\n");
}

export const GET = withAdminAuth<{ id: string }>(async (req, { params }) => {
  const user = await prisma.user.findUnique({
    where: { id: params.id },
    select: { id: true, name: true, email: true, createdAt: true, lastLoginAt: true },
  });
  if (!user) {
    return NextResponse.json({ error: "Customer not found" }, { status: 404 });
  }

  const [contactCount, sentCount, activeSequenceCount, events] = await Promise.all([
    prisma.contact.count({ where: { userId: user.id } }),
    prisma.campaignRecipient.count({ where: { status: "SENT", campaign: { userId: user.id } } }),
    prisma.sequence.count({ where: { userId: user.id, status: "ACTIVE" } }),
    // Same in-JS aggregation as GET /api/reports/campaigns — see that route
    // for why (no COUNT(DISTINCT) in Prisma's groupBy, and volumes here are
    // bounded by plan tier caps).
    prisma.emailEvent.findMany({
      where: { campaign: { userId: user.id } },
      select: { recipientId: true, type: true },
    }),
  ]);

  const uniqueOpens = new Set(events.filter((e) => e.type === "OPEN").map((e) => e.recipientId));
  const uniqueClicks = new Set(events.filter((e) => e.type === "CLICK").map((e) => e.recipientId));
  const openRate = sentCount > 0 ? Math.round((uniqueOpens.size / sentCount) * 1000) / 10 : null;
  const clickRate = sentCount > 0 ? Math.round((uniqueClicks.size / sentCount) * 1000) / 10 : null;
  const accountAgeDays = Math.floor((Date.now() - user.createdAt.getTime()) / 86_400_000);

  const report = {
    name: user.name,
    email: user.email,
    accountAgeDays,
    lastLoginAt: user.lastLoginAt,
    contactCount,
    campaignsSentCount: sentCount,
    activeSequenceCount,
    uniqueOpens: uniqueOpens.size,
    uniqueClicks: uniqueClicks.size,
    openRate,
    clickRate,
    // No unsubscribe mechanism exists anywhere in the app yet (only static
    // footer text, no real link/tracking) — reported honestly as null rather
    // than a fabricated number or a silently-omitted field.
    unsubscribeRate: null,
  };

  if (req.nextUrl.searchParams.get("format") === "csv") {
    const csv = toCsv([
      ["Name", report.name ?? ""],
      ["Email", report.email],
      ["Account age (days)", String(report.accountAgeDays)],
      ["Last login", report.lastLoginAt ? report.lastLoginAt.toISOString() : "Never"],
      ["Contacts", String(report.contactCount)],
      ["Campaigns sent", String(report.campaignsSentCount)],
      ["Active sequences", String(report.activeSequenceCount)],
      ["Unique opens", String(report.uniqueOpens)],
      ["Unique clicks", String(report.uniqueClicks)],
      ["Open rate (%)", report.openRate?.toString() ?? "N/A"],
      ["Click rate (%)", report.clickRate?.toString() ?? "N/A"],
      ["Unsubscribe rate", "Not tracked yet"],
    ]);
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": `attachment; filename="${user.email}-report.csv"`,
      },
    });
  }

  return NextResponse.json({ report });
});
