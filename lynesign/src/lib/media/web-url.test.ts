import { describe, it, expect } from "vitest";
import { validateWebUrl } from "@/lib/media/web-url";
describe("validateWebUrl", () => {
  it("accepts http and https", () => {
    expect(validateWebUrl("https://example.com/menu")).toEqual({ ok: true, url: "https://example.com/menu" });
  });
  it("rejects other schemes and credentials", () => {
    expect(validateWebUrl("javascript:alert(1)").ok).toBe(false);
    expect(validateWebUrl("data:text/html,x").ok).toBe(false);
    expect(validateWebUrl("https://user:pass@example.com").ok).toBe(false);
    expect(validateWebUrl("not a url").ok).toBe(false);
  });
  it("rejects private, loopback and link-local hosts", () => {
    expect(validateWebUrl("http://localhost:3000").ok).toBe(false);
    expect(validateWebUrl("http://192.168.1.5").ok).toBe(false);
    expect(validateWebUrl("http://127.0.0.1").ok).toBe(false);
    expect(validateWebUrl("http://10.0.0.1").ok).toBe(false);
    expect(validateWebUrl("http://169.254.169.254").ok).toBe(false);
    expect(validateWebUrl("http://[::1]/").ok).toBe(false);
  });
  it("still accepts a public https URL", () => {
    expect(validateWebUrl("https://example.com")).toEqual({
      ok: true,
      url: "https://example.com/",
    });
  });
});
