import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const schema = readFileSync("prisma/schema.prisma", "utf8");

describe("identity schema", () => {
  it("declares the tenant root models", () => {
    for (const m of ["model User", "model Organization", "model Membership", "model Invitation", "model Plan", "model Subscription", "model AuditLog"]) {
      expect(schema).toContain(m);
    }
  });
  it("Membership is unique per user+org", () => {
    expect(schema).toMatch(/@@unique\(\[userId, organizationId\]\)/);
  });
  it("User carries the platform super-admin flag", () => {
    expect(schema).toMatch(/isSuperAdmin\s+Boolean\s+@default\(false\)/);
  });
});
