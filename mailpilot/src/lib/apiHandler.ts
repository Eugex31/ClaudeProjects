import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { ZodError } from "zod";

type Handler<TParams> = (req: NextRequest, ctx: { userId: string; params: TParams }) => Promise<Response>;

export function withAuth<TParams = Record<string, string>>(handler: Handler<TParams>) {
  return async (req: NextRequest, routeCtx?: { params: Promise<TParams> }) => {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const params = routeCtx?.params ? await routeCtx.params : (undefined as TParams);
    try {
      return await handler(req, { userId: session.user.id, params });
    } catch (err) {
      if (err instanceof ZodError) {
        return NextResponse.json({ error: "Validation failed", issues: err.issues }, { status: 400 });
      }
      console.error(err);
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
  };
}
