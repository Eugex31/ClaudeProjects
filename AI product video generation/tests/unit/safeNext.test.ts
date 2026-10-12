import { describe, it, expect } from "vitest";
import { safeNext } from "@/lib/safeNext";

describe("safeNext", () => {
  it("keeps same-origin relative paths", () => {
    expect(safeNext("/app/x?y=1")).toBe("/app/x?y=1");
  });
  it("falls back for null/undefined", () => {
    expect(safeNext(null)).toBe("/app");
    expect(safeNext(undefined)).toBe("/app");
  });
  it.each(["https://evil.com", "//evil.com", "/\\evil.com", "/%09/evil.com", "/\t/evil.com", "/%5Cevil.com", "/%zz"].map((v) => [JSON.stringify(v), v]))(
    "rejects %s",
    (_n, v) => expect(safeNext(v)).toBe("/app"),
  );
  it("uses custom fallback", () => {
    expect(safeNext("//x", "/home")).toBe("/home");
  });
});

import { authHref } from "@/lib/safeNext";
describe("authHref", () => {
  it("omits the default destination", () => expect(authHref("/signup", "/app")).toBe("/signup"));
  it("carries a safe next", () => expect(authHref("/login", "/app/projects/1?x=1")).toBe("/login?next=%2Fapp%2Fprojects%2F1%3Fx%3D1"));
  it("drops unsafe next", () => expect(authHref("/login", "//evil.com")).toBe("/login"));
});
