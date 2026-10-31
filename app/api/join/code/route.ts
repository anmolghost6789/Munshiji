import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { authSecret } from "@/lib/env";
import { errorResponse } from "@/lib/api";
import { isLocked, noteFailure, clearFailures } from "@/lib/login-guard";
import { withoutBusiness } from "@/lib/sql";
const me = async (req: NextRequest) => ((await getToken({ req, secret: authSecret() })) as { id?: string } | null)?.id;
const ip = (req: NextRequest) => req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
import { joinWithInvite } from "@/lib/core/tenancy";
import { setBusinessCookie } from "@/lib/business-cookie";

/** Signed in: join a team with an invite code (or link). Wrong guesses are limited. */
export async function POST(req: NextRequest) {
  try {
    const id = await me(req); if (!id) return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
    const keys = [`code:${id}`, `code-ip:${ip(req)}`];
    if (await withoutBusiness(() => isLocked(keys))) return NextResponse.json({ error: "Too many tries. Wait 15 minutes, or ask the owner to read the code again." }, { status: 429 });
    const { code } = (await req.json().catch(() => ({}))) as { code?: string };
    try {
      const r = await joinWithInvite(id, String(code || ""));
      await withoutBusiness(() => clearFailures(keys));
      return setBusinessCookie(NextResponse.json(r), r.business_id);
    } catch (e) { await withoutBusiness(() => noteFailure(keys)); throw e; }
  } catch (e) { return errorResponse(e); }
}
