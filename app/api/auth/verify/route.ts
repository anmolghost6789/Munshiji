import { NextRequest, NextResponse } from "next/server";
import { verifyEmail } from "@/lib/core/accounts";
import { errorResponse } from "@/lib/api";
/** { token } from the confirmation email. */
export async function POST(req: NextRequest) {
  try { const b = (await req.json().catch(() => ({}))) as { token?: string }; return NextResponse.json(await verifyEmail(String(b.token || ""))); }
  catch (e) { return errorResponse(e); }
}
