import type { Screen } from "@prisma/client";
import type { NextRequest } from "next/server";

import { prisma } from "@/lib/db/root";
import { hashDeviceToken } from "@/lib/pairing";
import { UnauthorizedError } from "@/lib/errors";

/**
 * Resolve the `Screen` behind a player request from its `Authorization: Bearer`
 * device token. The token is never stored or compared in the clear: the bearer
 * is HMAC-hashed and matched against `deviceTokenHash`. A missing header or an
 * unknown hash is a 401, never a 404, so a caller cannot probe which tokens
 * exist.
 *
 * Device-authed, so it reads through the unscoped root client with an explicit
 * `where`: an unpaired-then-paired screen still has no session or org context.
 */
export async function authenticateDevice(req: NextRequest): Promise<Screen> {
  const header = req.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  const token = match?.[1]?.trim();
  if (!token) {
    throw new UnauthorizedError("A device token is required.");
  }

  const screen = await prisma.screen.findUnique({
    where: { deviceTokenHash: hashDeviceToken(token) },
  });
  if (!screen) {
    throw new UnauthorizedError("That device token was not recognized.");
  }
  return screen;
}
