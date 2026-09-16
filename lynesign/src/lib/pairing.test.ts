import { describe, it, expect } from "vitest";
import { generatePairingCode, hashDeviceToken, newDeviceToken } from "@/lib/pairing";

describe("pairing", () => {
  it("codes are 8 chars and avoid ambiguous glyphs", () => {
    for (let i = 0; i < 50; i++) {
      const c = generatePairingCode();
      expect(c).toMatch(/^[A-Z2-9]{8}$/);
      expect(c).not.toMatch(/[O0I1]/);
    }
  });
  it("hash is stable and token round-trips", () => {
    const { raw, hash } = newDeviceToken();
    expect(hashDeviceToken(raw)).toBe(hash);
  });
});
