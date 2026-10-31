import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { authSecret } from "@/lib/env";
import { exportMe } from "@/lib/core/privacy";
/** Anyone: download what Munshiji holds about you. */
export async function GET(req: NextRequest) {
  const id = ((await getToken({ req, secret: authSecret() })) as { id?: string } | null)?.id;
  if (!id) return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  return new Response(JSON.stringify(await exportMe(id), null, 2), { headers: { "Content-Type": "application/json", "Content-Disposition": `attachment; filename="munshiji-my-data-${new Date().toISOString().slice(0, 10)}.json"` } });
}
