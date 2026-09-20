import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { resolveEffectiveUserId, type ActiveProfile } from "@/lib/activeProfile";
import { ZodError } from "zod";

type Handler<TParams> = (
  req: NextRequest,
  ctx: { userId: string; activeProfile: ActiveProfile | null; params: TParams }
) => Promise<Response>;

type RealHandler<TParams> = (req: NextRequest, ctx: { userId: string; params: TParams }) => Promise<Response>;

async function runHandler(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json({ error: "Validation failed", issues: err.issues }, { status: 400 });
    }
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export function withAuth<TParams = Record<string, string>>(handler: Handler<TParams>) {
  return async (req: NextRequest, routeCtx?: { params: Promise<TParams> }) => {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const { userId, activeProfile } = await resolveEffectiveUserId(session.user.id);
    const params = routeCtx?.params ? await routeCtx.params : (undefined as TParams);
    return runHandler(() => handler(req, { userId, activeProfile, params }));
  };
}

// Like withAuth, but deliberately skips the active-profile resolution — for
// routes that must always operate on the real, logged-in account and can
// never themselves run "as" a managed client profile: creating/listing/
// switching/exiting profiles (src/app/api/profiles/**). Using withAuth here
// by mistake would mean managing profiles while acting as one operates on
// the wrong tenant.
export function withRealAuth<TParams = Record<string, string>>(handler: RealHandler<TParams>) {
  return async (req: NextRequest, routeCtx?: { params: Promise<TParams> }) => {
    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const params = routeCtx?.params ? await routeCtx.params : (undefined as TParams);
    return runHandler(() => handler(req, { userId, params }));
  };
}
