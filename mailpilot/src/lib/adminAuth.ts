import { NextRequest, NextResponse } from "next/server";
import { redirect } from "next/navigation";
import { ZodError } from "zod";
import { auth } from "@/lib/auth";

// Platform-admin status is an env-var allowlist, not a DB role column — it's
// infra-level configuration (who can see every customer's data and revenue),
// not application data any customer or the app itself should ever be able
// to reach or grant.
export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const allowed = (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return allowed.includes(email.toLowerCase());
}

type AdminHandler<TParams> = (
  req: NextRequest,
  ctx: { params: TParams; adminEmail: string }
) => Promise<Response>;

export function withAdminAuth<TParams = Record<string, string>>(handler: AdminHandler<TParams>) {
  return async (req: NextRequest, routeCtx?: { params: Promise<TParams> }) => {
    const session = await auth();
    if (!session?.user?.id || !isAdminEmail(session.user.email)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const params = routeCtx?.params ? await routeCtx.params : (undefined as TParams);
    try {
      return await handler(req, { params, adminEmail: session.user.email! });
    } catch (err) {
      if (err instanceof ZodError) {
        return NextResponse.json({ error: "Validation failed", issues: err.issues }, { status: 400 });
      }
      console.error(err);
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
  };
}

// For the (admin) route group's layout — page-level protection is a
// different concern from the API-level withAdminAuth above.
export async function requireAdmin(): Promise<void> {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }
  if (!isAdminEmail(session.user.email)) {
    redirect("/dashboard");
  }
}
