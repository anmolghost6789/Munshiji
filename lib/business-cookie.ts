import { NextResponse } from "next/server";
import { BUSINESS_COOKIE } from "./authz";
/** Remembers which business the browser is working in. Only a preference: membership is checked on every request. */
export function setBusinessCookie(res: NextResponse, businessId: string) {
  res.cookies.set(BUSINESS_COOKIE, businessId, { httpOnly: true, sameSite: "lax", secure: (process.env.NEXTAUTH_URL || "").startsWith("https://"), path: "/", maxAge: 60 * 60 * 24 * 365 });
  return res;
}
