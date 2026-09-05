import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  /**
   * The app runs database sessions and enriches `session.user` in the `session`
   * callback (see `src/lib/auth/config.ts`) with the row's `id` and the
   * `isSuperAdmin` flag, so route handlers can authorize without a second query.
   */
  interface Session {
    user: {
      id: string;
      isSuperAdmin: boolean;
    } & DefaultSession["user"];
  }
}
