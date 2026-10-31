import { NextRequest } from "next/server";
import { encode } from "next-auth/jwt";
import { authSecret } from "@/lib/env";

/** A request carrying a real signed session for a user, optionally choosing a business (the switcher cookie). */
export async function req(method: string, url: string, userId?: string, body?: unknown, headers: Record<string, string> = {}, businessId?: string) {
  const h = new Headers({ "content-type": "application/json", ...headers });
  const cookies: string[] = [];
  // NextAuth uses the __Secure- cookie name when NEXTAUTH_URL is https, exactly as in production.
  const name = (process.env.NEXTAUTH_URL || "").startsWith("https://") ? "__Secure-next-auth.session-token" : "next-auth.session-token";
  if (userId) cookies.push(`${name}=${await encode({ token: { id: userId }, secret: authSecret() })}`);
  if (businessId) cookies.push(`mj_business=${businessId}`);
  if (cookies.length) h.set("cookie", cookies.join("; "));
  return new NextRequest(new URL(url, "http://localhost"), { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
}
export const ctx = { params: Promise.resolve({}) };
