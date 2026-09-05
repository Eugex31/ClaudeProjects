import { NextResponse, type NextRequest } from "next/server";

import { prisma } from "@/lib/db/root";
import { newDeviceToken } from "@/lib/pairing";
import { NotFoundError, ValidationError, toProblem } from "@/lib/errors";
import { withRequestId } from "@/lib/logging";

/**
 * `POST /api/player/pair` -- a player exchanges a one-time pairing code for a
 * long-lived device token.
 *
 * This route is device-authed, not session-authed: an unpaired screen has no
 * organization context, so it legitimately reads through the unscoped root
 * client with an explicit `where: { pairingCode }`. On success the pairing code
 * is consumed (set to null), `deviceTokenHash` is stored (never the raw token),
 * and the screen goes `ONLINE`. An unrecognized code is a 404 problem.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  return withRequestId(async (log) => {
    try {
      const body: unknown = await req.json().catch(() => null);
      const pairingCode =
        body && typeof body === "object" && typeof (body as { pairingCode?: unknown }).pairingCode === "string"
          ? (body as { pairingCode: string }).pairingCode.trim()
          : "";
      if (!pairingCode) {
        throw new ValidationError("A pairing code is required.");
      }

      const screen = await prisma.screen.findUnique({ where: { pairingCode } });
      if (!screen) {
        throw new NotFoundError("That pairing code was not recognized.");
      }

      const { raw, hash } = newDeviceToken();
      await prisma.screen.update({
        where: { id: screen.id },
        data: {
          deviceTokenHash: hash,
          pairingCode: null,
          status: "ONLINE",
          lastSeenAt: new Date(),
        },
      });

      log.info({ screenId: screen.id }, "screen paired");
      return NextResponse.json({
        deviceToken: raw,
        screenId: screen.id,
        pollIntervalSeconds: screen.pollIntervalSeconds,
      });
    } catch (err) {
      const problem = toProblem(err);
      if (problem.status >= 500) log.error({ err }, "pair failed");
      return NextResponse.json(problem.body, { status: problem.status });
    }
  });
}
