import { NextResponse } from "next/server";
import { withRealAuth } from "@/lib/apiHandler";
import { ACTIVE_PROFILE_COOKIE } from "@/lib/activeProfile";

export const POST = withRealAuth(async () => {
  const res = NextResponse.json({ ok: true });
  res.cookies.delete(ACTIVE_PROFILE_COOKIE);
  return res;
});
