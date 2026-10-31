import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { authSecret } from "@/lib/env";
import { sendVerification } from "@/lib/core/accounts";
/** Send the confirmation email again (signed-in user). */
export async function POST(req: NextRequest) {
  const id = ((await getToken({ req, secret: authSecret() })) as { id?: string } | null)?.id;
  if (!id) return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  const r = await sendVerification(id);
  return NextResponse.json(r, { status: r.sent || r.already ? 200 : 503 });
}
