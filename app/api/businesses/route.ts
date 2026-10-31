import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { z } from "zod";
import { authSecret } from "@/lib/env";
import { createBusiness, myBusinesses } from "@/lib/core/tenancy";
import { setBusinessCookie } from "@/lib/business-cookie";
import { errorResponse } from "@/lib/api";

/** Create another business (you become its owner) and switch to it: { name } */
export async function POST(req: NextRequest) {
  try {
    const token = await getToken({ req, secret: authSecret() });
    const id = (token as { id?: string } | null)?.id;
    if (!id) return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
    const { name } = z.object({ name: z.string().trim().min(2, "Enter the business name").max(120) }).parse(await req.json().catch(() => ({})));
    if ((await myBusinesses(id)).filter((b) => b.role === "owner").length >= 20) return NextResponse.json({ error: "You can own up to 20 businesses." }, { status: 409 });
    const businessId = await createBusiness(name, id);
    return setBusinessCookie(NextResponse.json({ ok: true, id: businessId }, { status: 201 }), businessId);
  } catch (e) { return errorResponse(e); }
}
