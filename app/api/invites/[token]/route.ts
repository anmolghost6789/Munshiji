import { NextRequest, NextResponse } from "next/server";
import { inviteInfo } from "@/lib/core/tenancy";

/** Public: what an invite link is for. Reveals nothing unless you hold the link. */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const info = await inviteInfo(token);
  if (!info) return NextResponse.json({ error: "This invite link is not valid any more. Ask for a new one." }, { status: 404 });
  return NextResponse.json(info);
}
