import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { authSecret } from "@/lib/env";
import { startPhoneLink, unlinkPhone } from "@/lib/core/accounts";
import { errorResponse } from "@/lib/api";

const me = async (req: NextRequest) => ((await getToken({ req, secret: authSecret() })) as { id?: string } | null)?.id;
/** { phone } → a code to send from that phone ("LINK 123456") to the Munshiji number. */
export async function POST(req: NextRequest) {
  try { const id = await me(req); if (!id) return NextResponse.json({ error: "Please sign in again." }, { status: 401 }); const b = (await req.json().catch(() => ({}))) as { phone?: string }; return NextResponse.json(await startPhoneLink(id, String(b.phone || ""))); }
  catch (e) { return errorResponse(e); }
}
export async function DELETE(req: NextRequest) {
  const id = await me(req); if (!id) return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  return NextResponse.json(await unlinkPhone(id));
}
