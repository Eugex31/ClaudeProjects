"use server";

import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Prisma, PlanKey, Role } from "@prisma/client";
import { prisma } from "@/lib/db/root";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import {
  createCredentialsSession,
  SESSION_COOKIE,
  sessionCookieOptions,
} from "@/lib/auth/session";
import { uniqueOrgSlug } from "@/lib/slug";
import { writeAudit } from "@/lib/audit";
import { sendMail } from "@/lib/email";
import { passwordResetEmail } from "@/lib/email/templates";
import { getPlanForOrg } from "@/lib/plan-limits";
import { ACTIVE_ORG_COOKIE } from "@/lib/auth/context";
import { signInSchema, signUpSchema, resetPasswordSchema } from "@/lib/validation/auth";
import { acceptInviteSchema } from "@/lib/validation/members";

const TRIAL_LENGTH_MS = 14 * 24 * 60 * 60 * 1000;
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;

/** Same generic result for every sign-in failure, so a caller cannot tell an
 * unknown email from a wrong password from an account with no password set. */
const SIGN_IN_FAILED = { error: "That email or password is not correct." } as const;

/**
 * Registers a new account. Validates the form, then atomically creates the
 * `User`, their `Organization`, an `OWNER` `Membership`, and a trialing
 * `Subscription` in one transaction. A duplicate email is reported as a returned
 * error rather than thrown. On success the session cookie is set and the request
 * is redirected to the dashboard.
 */
export async function signUp(formData: FormData): Promise<{ error?: string }> {
  const parsed = signUpSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check your details." };
  }
  const { name, email, password, organizationName } = parsed.data;

  const slug = await uniqueOrgSlug(organizationName);
  const hashedPassword = await hashPassword(password);

  let userId: string;
  try {
    userId = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          name,
          email: email.toLowerCase(),
          hashedPassword,
          emailVerified: new Date(),
        },
      });
      const org = await tx.organization.create({
        data: { name: organizationName, slug },
      });
      await tx.membership.create({
        data: { userId: user.id, organizationId: org.id, role: Role.OWNER },
      });
      await tx.subscription.create({
        data: {
          organizationId: org.id,
          planKey: PlanKey.TRIAL,
          status: "TRIALING",
          trialEndsAt: new Date(Date.now() + TRIAL_LENGTH_MS),
        },
      });
      return user.id;
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return { error: "An account with that email already exists." };
    }
    throw e;
  }

  await writeAudit({
    actorType: "USER",
    actorId: userId,
    action: "auth.signup",
    targetType: "User",
    targetId: userId,
  });

  const token = await createCredentialsSession(userId);
  (await cookies()).set(SESSION_COOKIE, token, sessionCookieOptions);

  redirect("/dashboard");
}

/**
 * Signs a user in with email and password. Every failure path returns the exact
 * same `SIGN_IN_FAILED` object with no thrown error, so the response cannot be
 * used to enumerate accounts. A correct password on an account flagged
 * `mustResetPassword` is bounced to the forced reset flow instead of getting a
 * session. On success: audit entry, `Session` row, session cookie, dashboard.
 */
export async function signInWithPassword(
  formData: FormData,
): Promise<{ error?: string }> {
  const parsed = signInSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ...SIGN_IN_FAILED };

  const user = await prisma.user.findUnique({
    where: { email: parsed.data.email.toLowerCase() },
  });
  if (
    !user?.hashedPassword ||
    !(await verifyPassword(parsed.data.password, user.hashedPassword))
  ) {
    return { ...SIGN_IN_FAILED };
  }

  if (user.mustResetPassword) redirect("/forgot-password?forced=1");

  await writeAudit({
    actorType: "USER",
    actorId: user.id,
    action: "auth.signin",
    targetType: "User",
    targetId: user.id,
  });

  const token = await createCredentialsSession(user.id);
  (await cookies()).set(SESSION_COOKIE, token, sessionCookieOptions);

  redirect("/dashboard");
}

/**
 * Signs the current user out. Deletes the `Session` row for the cookie's token
 * so the session cannot be replayed, clears the cookie, and returns to /login.
 */
export async function signOutAction(): Promise<void> {
  const jar = await cookies();
  const sessionToken = jar.get(SESSION_COOKIE)?.value;
  if (sessionToken) {
    await prisma.session.deleteMany({ where: { sessionToken } });
  }
  jar.delete(SESSION_COOKIE);
  // The active-org cookie outlives the session by a year. On a shared browser
  // that leaks the last organization id to whoever signs in next, so it goes
  // with the session rather than lingering.
  jar.delete(ACTIVE_ORG_COOKIE);
  redirect("/login");
}

/**
 * Starts a password reset. Always resolves to `{ ok: true }` with the same
 * shape whether or not the email is registered, so the response cannot confirm
 * an account. When the user does exist, a single-use `VerificationToken`
 * (1 hour TTL) is written and the reset link emailed.
 */
export async function requestPasswordReset(
  formData: FormData,
): Promise<{ ok: true }> {
  const parsed = signInSchema
    .pick({ email: true })
    .safeParse(Object.fromEntries(formData));

  if (parsed.success) {
    const email = parsed.data.email.toLowerCase();
    const user = await prisma.user.findUnique({ where: { email } });
    if (user) {
      const token = randomUUID();
      await prisma.verificationToken.create({
        data: {
          identifier: `pwreset:${email}`,
          token,
          expires: new Date(Date.now() + RESET_TOKEN_TTL_MS),
        },
      });
      const url = `${process.env.AUTH_URL}/reset-password?token=${token}&email=${encodeURIComponent(
        email,
      )}`;
      await sendMail({
        to: email,
        subject: "Reset your LyneSign password",
        html: passwordResetEmail(url),
      });
    }
  }

  return { ok: true };
}

/**
 * Completes a password reset. Verifies the token exists, matches the emailed
 * identifier, and has not expired; then in one transaction sets the new hash,
 * clears `mustResetPassword`, consumes the token, and deletes every `Session`
 * for the user so any existing login is invalidated. Redirects to /login on
 * success. The token only ever appears in the reset URL and is never logged.
 */
export async function resetPassword(
  formData: FormData,
): Promise<{ error?: string }> {
  const parsed = resetPasswordSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    if (first?.path[0] === "password") {
      return { error: first.message };
    }
    return { error: "That reset link is invalid or has expired." };
  }

  const { token, password } = parsed.data;
  const email = parsed.data.email.toLowerCase();
  const record = await prisma.verificationToken.findUnique({ where: { token } });
  if (
    !record ||
    record.identifier !== `pwreset:${email}` ||
    record.expires <= new Date()
  ) {
    return { error: "That reset link is invalid or has expired." };
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    return { error: "That reset link is invalid or has expired." };
  }

  const hashedPassword = await hashPassword(password);
  await prisma.$transaction([
    prisma.user.update({
      where: { id: user.id },
      data: { hashedPassword, mustResetPassword: false },
    }),
    prisma.verificationToken.delete({ where: { token } }),
    prisma.session.deleteMany({ where: { userId: user.id } }),
  ]);

  redirect("/login?reset=1");
}

const SEAT_LIMIT_REACHED =
  "This organization has reached its member limit. Contact an administrator.";

/** Rolls the accept transaction back when the org has no seat left. */
class SeatLimitReached extends Error {}

/**
 * Accepts an organization invitation identified by its opaque token.
 *
 * Rejects a token that does not exist, has already been accepted, or has
 * expired, with one generic message that never reveals whether the invited
 * email already had an account. When the email is new, a `User` is created from
 * the submitted name and password (min 12); when it already exists, those form
 * fields are ignored.
 *
 * Membership creation and marking the invite accepted happen in one
 * transaction; an existing membership is treated as success. The plan's seat
 * ceiling is re-checked inside that transaction, because the invitation may have
 * been issued when the org still had room: an over-cap accept creates nothing
 * and leaves the invitation open. The invitation being accepted is excluded from
 * the count -- it is the seat being claimed, not a second one.
 *
 * A pre-existing user flagged `mustResetPassword` becomes a member but gets no
 * session: they are bounced to the forced-reset flow, exactly as
 * `signInWithPassword` bounces them. Otherwise the session cookie is set and the
 * request is redirected to the dashboard.
 */
export async function acceptInvite(
  token: string,
  formData: FormData,
): Promise<{ error?: string }> {
  const invitation = await prisma.invitation.findUnique({ where: { token } });
  if (
    !invitation ||
    invitation.acceptedAt ||
    invitation.expiresAt <= new Date()
  ) {
    return { error: "That invitation is invalid or has expired." };
  }

  const email = invitation.email.toLowerCase();
  let user = await prisma.user.findUnique({ where: { email } });

  if (!user) {
    const parsed = acceptInviteSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message ?? "Check your details." };
    }
    const hashedPassword = await hashPassword(parsed.data.password);
    user = await prisma.user.create({
      data: {
        name: parsed.data.name,
        email,
        hashedPassword,
        emailVerified: new Date(),
      },
    });
  }

  const userId = user.id;
  const { organizationId, role, id: invitationId } = invitation;
  const plan = await getPlanForOrg(organizationId);

  try {
    await prisma.$transaction(async (tx) => {
      const existing = await tx.membership.findUnique({
        where: { userId_organizationId: { userId, organizationId } },
      });
      if (!existing) {
        // Counted on `tx` rather than through assertCanAddUser: this invitation
        // already holds a reserved seat, so counting it again would reject the
        // very accept it was issued for.
        if (plan.maxUsers !== null) {
          const [members, openInvites] = await Promise.all([
            tx.membership.count({ where: { organizationId, status: "ACTIVE" } }),
            tx.invitation.count({
              where: {
                organizationId,
                acceptedAt: null,
                expiresAt: { gt: new Date() },
                id: { not: invitationId },
              },
            }),
          ]);
          if (members + openInvites >= plan.maxUsers) throw new SeatLimitReached();
        }
        await tx.membership.create({
          data: { userId, organizationId, role },
        });
      }
      await tx.invitation.update({
        where: { id: invitationId },
        data: { acceptedAt: new Date() },
      });
    });
  } catch (e) {
    if (e instanceof SeatLimitReached) return { error: SEAT_LIMIT_REACHED };
    throw e;
  }

  await writeAudit({
    organizationId,
    actorType: "USER",
    actorId: userId,
    action: "member.acceptInvite",
    targetType: "Invitation",
    targetId: invitationId,
  });

  // Same gate as signInWithPassword: an account the platform has flagged for a
  // forced reset must not receive a session by any route, invitation included.
  if (user.mustResetPassword) redirect("/forgot-password?forced=1");

  const sessionToken = await createCredentialsSession(userId);
  (await cookies()).set(SESSION_COOKIE, sessionToken, sessionCookieOptions);

  redirect("/dashboard");
}
