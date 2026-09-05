import { NextResponse } from "next/server";

import { prisma } from "@/lib/db/root";

/**
 * `GET /api/health` -- liveness plus a database round trip. `SELECT 1` proves
 * the pool can hand out a connection and Postgres answers; any failure is a 503
 * so a load balancer takes this instance out of rotation.
 */
export async function GET(): Promise<NextResponse> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({ status: "ok" });
  } catch {
    return NextResponse.json({ status: "error" }, { status: 503 });
  }
}
