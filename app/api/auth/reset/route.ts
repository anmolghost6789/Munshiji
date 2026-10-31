import { NextRequest, NextResponse } from "next/server";
import { resetPassword } from "@/lib/core/accounts";
import { errorResponse } from "@/lib/api";
/** { token, password } → new password; every existing session is signed out. */
export async function POST(req: NextRequest) {
  try { const b = (await req.json().catch(() => ({}))) as { token?: string; password?: string }; return NextResponse.json(await resetPassword(String(b.token || ""), String(b.password || ""))); }
  catch (e) { return errorResponse(e); }
}
