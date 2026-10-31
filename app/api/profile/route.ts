import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { authSecret } from "@/lib/env";
import { updateProfile, changePassword } from "@/lib/core/tenancy";
import { errorResponse } from "@/lib/api";

async function me(req: NextRequest) { return ((await getToken({ req, secret: authSecret() })) as { id?: string } | null)?.id; }
/** Your name and WhatsApp number: { name?, phone? } */
export async function PATCH(req: NextRequest) {
  try { const id = await me(req); if (!id) return NextResponse.json({ error: "Please sign in again." }, { status: 401 }); return NextResponse.json(await updateProfile(id, await req.json())); }
  catch (e) { return errorResponse(e); }
}
/** Change your password: { current, next } */
export async function POST(req: NextRequest) {
  try { const id = await me(req); if (!id) return NextResponse.json({ error: "Please sign in again." }, { status: 401 }); const b = await req.json(); return NextResponse.json(await changePassword(id, b.current, b.next)); }
  catch (e) { return errorResponse(e); }
}
