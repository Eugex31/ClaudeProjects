import { describe, it, expect } from "vitest";

describe("scaffold", () => {
  it("cn merges classes", async () => {
    const { cn } = await import("@/lib/utils");
    expect(cn("a", false && "b", "c")).toBe("a c");
  });
});
