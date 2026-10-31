import { ZodError } from "zod";
import { one, exec, withoutBusiness } from "@/lib/sql";
import { signup, acceptInvite, MIN_PASSWORD } from "@/lib/core/tenancy";
import { recordConsent } from "@/lib/core/privacy";
import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { authSecret } from "@/lib/env";
import { isLocked, noteFailure, clearFailures } from "@/lib/login-guard";

export { MIN_PASSWORD };
const GENERIC = "Email or password is incorrect.";
let dummyHash: string | null = null; // compared against for unknown emails so every attempt takes the same time
const dummy = () => (dummyHash ??= bcrypt.hashSync("munshiji-timing-equaliser", 12));

/** Sign-in, sign-up (creates your business) and accepting an invite. Exported for tests. */
export async function authorizeCredentials(credentials: Record<string, string> | undefined, ip = "unknown") {
  if (!credentials?.email || !credentials?.password) throw new Error(GENERIC);
  const email = credentials.email.toLowerCase().trim();
  const password = credentials.password;
  const keys = [`e:${email}`, `ip:${ip}`];
  try {
    if (credentials.action === "register") {
      if (await isLocked([`signup:${ip}`])) throw new Error("Too many sign-ups from this network. Please try again later.");
      if (credentials.accept_terms !== "true") throw new Error("Please accept the Terms of Service and Privacy Policy to create an account.");
      await noteFailure([`signup:${ip}`]); // counts sign-ups per network (5 per 15 minutes)
      const u = await signup({ name: credentials.name, email, password, business_name: credentials.business_name, join: credentials.intent === "join" });
      await recordConsent(u.id);
      return { id: u.id, name: u.name, email: u.email };
    }
    if (credentials.action === "accept_invite") {
      if (await isLocked(keys)) throw new Error("Too many attempts. Please wait 15 minutes and try again.");
      try {
        const u = await acceptInvite(credentials.token, { email, password, name: credentials.name, acceptTerms: credentials.accept_terms === "true" });
        if (credentials.accept_terms === "true") await recordConsent(u.id);
        await clearFailures(keys); return { id: u.id, name: u.name, email: u.email };
      }
      catch (e) { await noteFailure(keys); throw e; }
    }
  } catch (e) {
    if (e instanceof ZodError) throw new Error(e.issues[0]?.message || "Some details are missing.");
    throw new Error((e as Error).message);
  }
  if (await isLocked(keys)) throw new Error("Too many attempts. Please wait 15 minutes and try again.");
  const user = await withoutBusiness(() => one<{ id: string; name: string; email: string; password_hash: string; active: number }>("SELECT id, name, email, password_hash, active FROM users WHERE email = ?", [email]));
  const ok = user ? await bcrypt.compare(password, user.password_hash) : (await bcrypt.compare(password, dummy()), false);
  if (!user || !ok || user.active === 0) { await noteFailure(keys); throw new Error(GENERIC); }
  await clearFailures(keys);
  await withoutBusiness(() => exec("UPDATE users SET last_login = now() WHERE id = ?", [user.id]));
  return { id: user.id, name: user.name, email: user.email };
}

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" }, password: { label: "Password", type: "password" },
        name: { label: "Name", type: "text" }, action: { label: "Action", type: "text" }, business_name: { label: "Business", type: "text" }, token: { label: "Invite", type: "text" }, intent: { label: "Intent", type: "text" }, accept_terms: { label: "Terms", type: "text" },
      },
      async authorize(credentials, req) {
        const fwd = (req?.headers?.["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim();
        return await authorizeCredentials(credentials as Record<string, string>, fwd || "unknown");
      },
    }),
  ],
  pages: { signIn: "/login", error: "/login" },
  session: { strategy: "jwt", maxAge: 12 * 60 * 60 }, // 12 hours: a working day
  // Secure cookies follow NEXTAUTH_URL (https in production), matching how the session is read back.
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        const u = await withoutBusiness(() => one<{ session_version: number }>("SELECT session_version FROM users WHERE id = ?", [user.id]));
        token.sv = u?.session_version ?? 1; // a password reset bumps this and signs out every device
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user && token.id) Object.assign(session.user, { id: token.id });
      return session;
    },
  },
  secret: authSecret(),
};
