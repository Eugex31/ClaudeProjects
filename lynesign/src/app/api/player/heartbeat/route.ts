import { NextResponse, type NextRequest } from "next/server";

import { prisma } from "@/lib/db/root";
import { authenticateDevice } from "@/lib/player/device-auth";
import { toProblem } from "@/lib/errors";
import { withRequestId } from "@/lib/logging";

/**
 * `POST /api/player/heartbeat` -- a paired player reports it is alive. Bearer
 * device token in, `{ ok: true }` out; the screen's `lastSeenAt` is bumped and
 * its status held at `ONLINE`. Unknown or missing token is a 401 problem.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  return withRequestId(async (log) => {
    try {
      const screen = await authenticateDevice(req);
      await prisma.screen.update({
        where: { id: screen.id },
        data: { lastSeenAt: new Date(), status: "ONLINE" },
      });
      return NextResponse.json({ ok: true });
    } catch (err) {
      const problem = toProblem(err);
      if (problem.status >= 500) log.error({ err }, "heartbeat failed");
      return NextResponse.json(problem.body, { status: problem.status });
    }
  });
}
