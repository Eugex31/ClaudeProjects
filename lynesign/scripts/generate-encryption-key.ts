import { randomBytes } from "node:crypto";

const key = randomBytes(32).toString("base64");
console.log(key);
console.log("\nSet this as AUTH_SECRET and/or APP_ENCRYPTION_KEY in your .env");
