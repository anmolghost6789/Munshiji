import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { authSecret } from "@/lib/env";
import { one, withoutBusiness } from "@/lib/sql";
import { myBusinesses, activeMembership } from "@/lib/core/tenancy";
import { pendingRequests } from "@/lib/core/joining";
import { BUSINESS_COOKIE, permissionsFor, sessionStale } from "@/lib/authz";

/** Who is signed in, which businesses they belong to, and their role in the current one. */
export async function GET(req: NextRequest) {
  const token = await getToken({ req, secret: authSecret() });
  const id = (token as { id?: string } | null)?.id;
  if (!id) return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  const user = await withoutBusiness(() => one<{ id: string; name: string; email: string; phone: string; phone_pending: string; active: number; session_version: number; email_verified_at: string | null }>("SELECT id, name, email, phone, phone_pending, active, session_version, email_verified_at FROM users WHERE id = ?", [id]));
  if (!user?.active || sessionStale(token, user.session_version)) return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  const businesses = await myBusinesses(id);
  const current = await activeMembership(id, req.cookies.get(BUSINESS_COOKIE)?.value);
  const join_requests = current?.role === "owner" ? (await pendingRequests(current.id)).length : 0;
  return NextResponse.json({ join_requests, user: { id: user.id, name: user.name, email: user.email, phone: user.phone, phone_pending: user.phone_pending, email_verified: !!user.email_verified_at }, whatsapp_number: process.env.MUNSHIJI_WHATSAPP_NUMBER || "", businesses, current, role: current?.role || null, permissions: current ? permissionsFor(current.role) : [] });
}
