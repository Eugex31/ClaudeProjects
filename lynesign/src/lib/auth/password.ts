import bcrypt from "bcryptjs";

/**
 * Cost factor for every password hash in the app. 12 is the current OWASP
 * baseline for bcrypt; changing it only affects newly created hashes, existing
 * ones keep their embedded cost.
 */
const BCRYPT_COST = 12;

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_COST);
}

export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}
