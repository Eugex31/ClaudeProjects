import { describe, it, expect } from "vitest";
import bcrypt from "bcryptjs";
import { hashPassword, verifyPassword } from "@/lib/auth/password";

describe("password hashing", () => {
  it("verifies a correct password and rejects a wrong one", async () => {
    const hash = await hashPassword("s3cret-passw0rd");
    expect(await verifyPassword("s3cret-passw0rd", hash)).toBe(true);
    expect(await verifyPassword("wrong", hash)).toBe(false);
  });

  it("uses a bcrypt hash with cost factor 12", async () => {
    const hash = await hashPassword("another-passw0rd");
    // bcrypt hash format: $2<x>$<cost>$<22-char salt><31-char digest>
    expect(hash).toMatch(/^\$2[aby]\$12\$/);
    expect(bcrypt.getRounds(hash)).toBe(12);
  });
});
