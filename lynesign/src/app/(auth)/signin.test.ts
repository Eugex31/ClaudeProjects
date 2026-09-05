import { describe, it, expect, vi } from "vitest";
import { prisma } from "@/lib/db/root";
import { hashPassword } from "@/lib/auth/password";

vi.mock("next/headers", () => ({
  cookies: async () => ({ set: vi.fn(), get: vi.fn(), delete: vi.fn() }),
}));
vi.mock("next/navigation", () => ({
  redirect: vi.fn(() => {
    throw new Error("REDIRECT");
  }),
}));

describe("signInWithPassword", () => {
  it("accepts a correct password", async () => {
    const email = `si-${Date.now()}@x.com`;
    await prisma.user.create({
      data: { email, hashedPassword: await hashPassword("correcthorsebattery") },
    });
    const { signInWithPassword } = await import("@/app/(auth)/actions");
    const fd = new FormData();
    fd.set("email", email);
    fd.set("password", "correcthorsebattery");
    await expect(signInWithPassword(fd)).rejects.toThrow("REDIRECT");
  });

  it("rejects a wrong password with a generic message", async () => {
    const email = `si2-${Date.now()}@x.com`;
    await prisma.user.create({
      data: { email, hashedPassword: await hashPassword("correcthorsebattery") },
    });
    const { signInWithPassword } = await import("@/app/(auth)/actions");
    const fd = new FormData();
    fd.set("email", email);
    fd.set("password", "nope");
    expect((await signInWithPassword(fd)).error).toMatch(/not correct/);
  });

  it("rejects an unknown email with the same generic message", async () => {
    const { signInWithPassword } = await import("@/app/(auth)/actions");
    const fd = new FormData();
    fd.set("email", `ghost-${Date.now()}@x.com`);
    fd.set("password", "whatever12345");
    expect((await signInWithPassword(fd)).error).toMatch(/not correct/);
  });
});
