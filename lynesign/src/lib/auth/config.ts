import type { NextAuthConfig } from "next-auth";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "@/lib/db/root";

const THIRTY_DAYS_SECONDS = 60 * 60 * 24 * 30;

/**
 * Auth.js configuration for LyneSign.
 *
 * Database sessions only, never JWT. Credential (email + password) login does
 * NOT go through a NextAuth `CredentialsProvider` (that provider forces JWT
 * sessions); instead `src/lib/auth/session.ts#createCredentialsSession` writes a
 * `Session` row directly, identical to what `PrismaAdapter` writes for any other
 * sign-in, so `auth()` reads both the same way. This mirrors the sibling
 * mailpilot project.
 *
 * `providers` is intentionally empty for this increment. Auth.js v5 accepts an
 * adapter-only config and may log a benign "no providers" notice on boot.
 */
export const authConfig: NextAuthConfig = {
  adapter: PrismaAdapter(prisma),
  session: { strategy: "database", maxAge: THIRTY_DAYS_SECONDS },
  pages: { signIn: "/login" },
  providers: [],
  callbacks: {
    async session({ session, user }) {
      if (session.user) {
        session.user.id = user.id;
        session.user.isSuperAdmin =
          (user as { isSuperAdmin?: boolean }).isSuperAdmin ?? false;
      }
      return session;
    },
  },
};
