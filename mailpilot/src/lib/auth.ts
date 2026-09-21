import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "@/lib/prisma";
import { encryptToken } from "@/lib/crypto/tokenCipher";

// Minimal scope: identity + permission to send mail as the user. Never request
// broader Gmail scopes (readonly/modify/full mail access) than the app needs.
// Exported for src/app/api/profile-gmail/**, which needs the identical scope
// for its own hand-rolled OAuth dance (a managed client profile has no
// Auth.js session of its own to run signIn("google") through — see that
// route's comments for why).
export const GMAIL_SCOPE = "openid email profile https://www.googleapis.com/auth/gmail.send";

const baseAdapter = PrismaAdapter(prisma);

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: {
    ...baseAdapter,
    // Encrypt OAuth tokens before they ever touch the database.
    async linkAccount(account) {
      await baseAdapter.linkAccount!({
        ...account,
        access_token: account.access_token ? encryptToken(account.access_token) : account.access_token,
        refresh_token: account.refresh_token ? encryptToken(account.refresh_token) : account.refresh_token,
        id_token: account.id_token ? encryptToken(account.id_token) : account.id_token,
      });
    },
  },
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      // Safe here specifically because Google is the app's only identity
      // provider and only source of truth for email verification — disconnect
      // intentionally keeps the User row (so contacts/campaigns aren't
      // orphaned), so reconnecting the same Google account must relink to it
      // rather than being blocked as a potential account-takeover attempt.
      allowDangerousEmailAccountLinking: true,
      authorization: {
        params: {
          scope: GMAIL_SCOPE,
          // Force Google to always hand back a refresh_token, including on
          // re-consent after a user disconnects and reconnects their account.
          access_type: "offline",
          prompt: "consent",
        },
      },
    }),
  ],
  session: { strategy: "database" },
  pages: {
    signIn: "/login",
  },
  callbacks: {
    async signIn({ user }) {
      // Blocks both a suspended customer's first sign-in of the session and
      // any attempt to reconnect Google after an admin suspends them —
      // `user.status` reflects the current DB row via the adapter's lookup.
      if ((user as { status?: string }).status === "SUSPENDED") {
        return false;
      }
      return true;
    },
    async session({ session, user }) {
      if (session.user) {
        session.user.id = user.id;
      }
      return session;
    },
  },
  events: {
    // adapter.linkAccount only fires the first time an account is linked.
    // On repeat sign-ins (e.g. after disconnect -> reconnect) Google issues
    // fresh tokens that we must persist (encrypted) ourselves.
    async signIn({ user, account }) {
      if (user.id) {
        await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
      }

      if (!account?.provider || !account.providerAccountId) return;
      await prisma.account.updateMany({
        where: {
          provider: account.provider,
          providerAccountId: account.providerAccountId,
        },
        data: {
          access_token: account.access_token ? encryptToken(account.access_token as string) : undefined,
          refresh_token: account.refresh_token ? encryptToken(account.refresh_token as string) : undefined,
          expires_at: typeof account.expires_at === "number" ? account.expires_at : undefined,
          scope: account.scope,
          token_type: account.token_type,
          id_token: account.id_token ? encryptToken(account.id_token as string) : undefined,
        },
      });
    },
  },
});
