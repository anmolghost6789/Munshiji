import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { authSecret } from "@/lib/env";
import { errorResponse } from "@/lib/api";
import { isLocked, noteFailure, clearFailures } from "@/lib/login-guard";
import { withoutBusiness } from "@/lib/sql";
const me = async (req: NextRequest) => ((await getToken({ req, secret: authSecret() })) as { id?: string } | null)?.id;
const ip = (req: NextRequest) => req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
import { requestToJoin, myJoinRequests, cancelJoinRequest } from "@/lib/core/joining";

/** Your requests to join a team. */
export async function GET(req: NextRequest) {
  const id = await me(req); if (!id) return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  return NextResponse.json({ requests: await myJoinRequests(id) });
}
/** Ask to join: { contact } = the owner's phone or email. */
export async function POST(req: NextRequest) {
  try {
    const id = await me(req); if (!id) return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
    const { contact } = (await req.json().catch(() => ({}))) as { contact?: string };
    return NextResponse.json(await requestToJoin(id, String(contact || "")));
  } catch (e) { return errorResponse(e); }
}
/** Cancel: ?contact=... */
export async function DELETE(req: NextRequest) {
  const id = await me(req); if (!id) return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  return NextResponse.json(await cancelJoinRequest(id, req.nextUrl.searchParams.get("contact") || ""));
}
