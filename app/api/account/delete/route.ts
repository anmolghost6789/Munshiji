import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { authSecret } from "@/lib/env";
import { deleteAccount } from "@/lib/core/privacy";
import { errorResponse } from "@/lib/api";
/** Delete your account: { password, confirm: "DELETE" } */
export async function POST(req: NextRequest) {
  try {
    const id = ((await getToken({ req, secret: authSecret() })) as { id?: string } | null)?.id;
    if (!id) return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
    const b = (await req.json().catch(() => ({}))) as { password?: string; confirm?: string };
    return NextResponse.json(await deleteAccount(id, String(b.password || ""), String(b.confirm || "")));
  } catch (e) { return errorResponse(e); }
}
