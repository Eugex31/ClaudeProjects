import { describe, it, expect } from "vitest";
import { classifyKind, extForMime, deriveName, MEDIA_MAX_BYTES } from "@/lib/media/mime";
describe("mime helpers", () => {
  it("classifies the allowlist", () => {
    expect(classifyKind("image/png")).toBe("IMAGE");
    expect(classifyKind("video/mp4")).toBe("VIDEO");
    expect(classifyKind("application/pdf")).toBeNull();
    expect(classifyKind("image/svg+xml")).toBeNull();
  });
  it("maps mime to extension", () => {
    expect(extForMime("image/jpeg")).toBe(".jpg");
    expect(extForMime("video/webm")).toBe(".webm");
  });
  it("derives a display name", () => {
    expect(deriveName("Fall Promo 2026.final.PNG")).toBe("Fall Promo 2026.final");
    expect(deriveName("")).toBe("Untitled");
  });
  it("caps: image < video", () => {
    expect(MEDIA_MAX_BYTES.IMAGE).toBe(25 * 1024 * 1024);
    expect(MEDIA_MAX_BYTES.VIDEO).toBe(500 * 1024 * 1024);
  });
});
