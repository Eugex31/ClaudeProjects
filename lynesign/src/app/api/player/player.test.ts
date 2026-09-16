import { describe, it, expect, vi } from "vitest";
import { prisma } from "@/lib/db/root";
import { NextRequest } from "next/server";

vi.stubEnv("APP_ENCRYPTION_KEY", "test-key-please-change");

describe("player protocol", () => {
  it("pairs a screen by code, then heartbeats with the token", async () => {
    const org = await prisma.organization.create({ data: { name: "P", slug: `p-${Date.now()}` } });
    const loc = await prisma.location.create({ data: { organizationId: org.id, name: "L" } });
    const screen = await prisma.screen.create({
      data: {
        organizationId: org.id,
        locationId: loc.id,
        name: "Lobby",
        pairingCode: "ABCD2345",
        status: "UNPAIRED",
      },
    });

    const { POST: pair } = await import("@/app/api/player/pair/route");
    const pairRes = await pair(
      new NextRequest("http://x/api/player/pair", {
        method: "POST",
        body: JSON.stringify({ pairingCode: "ABCD2345" }),
      }),
    );
    const pairBody = await pairRes.json();
    expect(pairRes.status).toBe(200);
    expect(pairBody.screenId).toBe(screen.id);

    const { POST: hb } = await import("@/app/api/player/heartbeat/route");
    const hbRes = await hb(
      new NextRequest("http://x/api/player/heartbeat", {
        method: "POST",
        headers: { authorization: `Bearer ${pairBody.deviceToken}` },
      }),
    );
    expect(hbRes.status).toBe(200);
    const after = await prisma.screen.findUnique({ where: { id: screen.id } });
    expect(after?.status).toBe("ONLINE");
    expect(after?.pairingCode).toBeNull();
  });

  it("rejects an unknown pairing code with 404", async () => {
    const { POST: pair } = await import("@/app/api/player/pair/route");
    const res = await pair(
      new NextRequest("http://x/api/player/pair", {
        method: "POST",
        body: JSON.stringify({ pairingCode: "ZZZZ9999" }),
      }),
    );
    expect(res.status).toBe(404);
  });
});
