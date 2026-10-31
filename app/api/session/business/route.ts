import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { authSecret } from "@/lib/env";
import { myBusinesses, rememberBusiness } from "@/lib/core/tenancy";
import { setBusinessCookie } from "@/lib/business-cookie";

/** Switch the business you're working in: { business_id }. Only businesses you belong to. */
export async function POST(req: NextRequest) {
  const token = await getToken({ req, secret: authSecret() });
  const id = (token as { id?: string } | null)?.id;
  if (!id) return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  const { business_id } = (await req.json().catch(() => ({}))) as { business_id?: string };
  const b = (await myBusinesses(id)).find((x) => x.id === business_id);
  if (!b) return NextResponse.json({ error: "You're not part of that business." }, { status: 403 });
  await rememberBusiness(id, b.id);
  return setBusinessCookie(NextResponse.json({ ok: true, current: b }), b.id);
}
