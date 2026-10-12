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
