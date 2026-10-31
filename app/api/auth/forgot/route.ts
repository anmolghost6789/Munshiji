import { NextRequest, NextResponse } from "next/server";
import { requestPasswordReset } from "@/lib/core/accounts";
import { errorResponse } from "@/lib/api";
/** { email } → always the same answer, whether or not the email has an account. */
export async function POST(req: NextRequest) {
  try {
    const { email } = (await req.json().catch(() => ({}))) as { email?: string };
    await requestPasswordReset(String(email || ""), req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown");
    return NextResponse.json({ ok: true, message: "If that email has a Munshiji account, a reset link is on its way." });
  } catch (e) { return errorResponse(e); }
}
