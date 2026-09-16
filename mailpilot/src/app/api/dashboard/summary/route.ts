import { NextResponse } from "next/server";
import { withAuth } from "@/lib/apiHandler";
import { getDashboardSummary } from "@/lib/dashboardSummary";

export const GET = withAuth(async (_req, { userId }) => {
  const summary = await getDashboardSummary(userId);
  return NextResponse.json(summary);
});
