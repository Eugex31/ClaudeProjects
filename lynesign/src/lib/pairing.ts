import { createHmac, randomBytes, randomInt } from "node:crypto";

/**
 * Device pairing primitives.
 *
 * A screen is provisioned with a short human-readable `pairingCode` that a
 * person types into the player. On a successful pair the server issues a
 * `deviceToken` (a long random bearer string) and stores only its HMAC-SHA256
 * digest, so a database leak never yields a usable token. `APP_ENCRYPTION_KEY`
 * is the HMAC key; it is required, and a missing value fails loud rather than
 * silently hashing under an empty key.
 */

// No O, 0, I, or 1: those glyphs are indistinguishable on a low-resolution
// screen read from across a room.
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** An 8-character pairing code drawn from an unambiguous alphabet (`^[A-Z2-9]{8}$`). */
export function generatePairingCode(): string {
  let out = "";
  for (let i = 0; i < 8; i++) out += ALPHABET[randomInt(ALPHABET.length)];
  return out;
}

/** HMAC-SHA256 hex digest of a raw device token, keyed by `APP_ENCRYPTION_KEY`. */
export function hashDeviceToken(raw: string): string {
  const key = process.env.APP_ENCRYPTION_KEY;
  if (!key) throw new Error("APP_ENCRYPTION_KEY is not set");
  return createHmac("sha256", key).update(raw).digest("hex");
}

/** A fresh device token: the `raw` bearer string and the `hash` to persist. */
export function newDeviceToken(): { raw: string; hash: string } {
  const raw = randomBytes(32).toString("base64url");
  return { raw, hash: hashDeviceToken(raw) };
}
