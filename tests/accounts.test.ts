/* Email (Resend) and WhatsApp linking. Outgoing calls to Resend and Meta are intercepted and checked. */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import crypto from "crypto";
import { NextRequest } from "next/server";
import { one, many, exec, withoutBusiness, withBusiness } from "@/lib/sql";
import { authorizeCredentials } from "@/lib/auth-options";
import { requestPasswordReset, resetPassword, verifyEmail, startPhoneLink } from "@/lib/core/accounts";
import { createInvite } from "@/lib/core/tenancy";
import { _resetGuard } from "@/lib/login-guard";
import * as Webhook from "@/app/api/whatsapp/webhook/route";
import * as Orders from "@/app/api/orders/route";
import { req, ctx } from "./request";

const realFetch = globalThis.fetch;
let sent: { url: string; body: Record<string, any> }[] = [];
beforeAll(() => {
  Object.assign(process.env, { RESEND_API_KEY: "re_test", MUNSHIJI_EMAIL_FROM: "Munshiji <hello@munshiji.test>", NEXTAUTH_URL: "https://app.munshiji.test",
    WHATSAPP_ACCESS_TOKEN: "wa_test", WHATSAPP_PHONE_NUMBER_ID: "PNID", WHATSAPP_APP_SECRET: "acct-secret", MUNSHIJI_WHATSAPP_NUMBER: "+91 90000 00000" });
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    if (String(url).startsWith("https://api.resend.com") || String(url).startsWith("https://graph.facebook.com")) {
      sent.push({ url: String(url), body: JSON.parse(String(init?.body || "{}")) });
      return new Response(JSON.stringify(String(url).includes("resend") ? { id: "em_1" } : { messages: [{ id: "wamid.out" }] }), { status: 200 });
    }
    return realFetch(url, init);
  });
});
afterAll(() => vi.unstubAllGlobals());
beforeEach(async () => { sent = []; await withoutBusiness(() => _resetGuard()); });
const emails = () => sent.filter((s) => s.url.includes("resend"));
const whatsapps = () => sent.filter((s) => s.url.includes("graph.facebook"));
const linkIn = (html: string, path: string) => html.match(new RegExp(`https://app\\.munshiji\\.test/${path}/([A-Za-z0-9_-]+)`))?.[1];
const wa = async (id: string, from: string, text: string) => {
  const body = JSON.stringify({ entry: [{ changes: [{ value: { metadata: { phone_number_id: "PNID" }, messages: [{ id, from, type: "text", text: { body: text } }] } }] }] });
  const r = await Webhook.POST(new NextRequest("http://x/api/whatsapp/webhook", { method: "POST", body, headers: { "x-hub-signature-256": "sha256=" + crypto.createHmac("sha256", "acct-secret").update(body).digest("hex") } }));
  await new Promise((r) => setTimeout(r, 150)); // replies are sent in the background
  return r.json();
};

let user: { id: string; email: string }, businessId: string;
describe("email with Resend", () => {
  it("sign-up sends a confirmation email; the link confirms once", async () => {
    const u = await authorizeCredentials({ action: "register", accept_terms: "true", name: "Meera Iyer", email: "meera@iyer.in", password: "meera-pass-1", business_name: "Iyer Foods" }, "ip-m");
    user = { id: u.id, email: u.email };
    businessId = (await withoutBusiness(() => one<{ business_id: string }>("SELECT business_id FROM memberships WHERE user_id = ?", [u.id])))!.business_id;
    expect(emails()).toHaveLength(1);
    expect(emails()[0].body).toMatchObject({ from: "Munshiji <hello@munshiji.test>", to: ["meera@iyer.in"], subject: "Confirm your email for Munshiji" });
    const token = linkIn(emails()[0].body.html, "verify")!;
    await verifyEmail(token);
    expect((await withoutBusiness(() => one<{ v: string | null }>("SELECT email_verified_at v FROM users WHERE id = ?", [u.id])))!.v).toBeTruthy();
    await expect(verifyEmail(token)).rejects.toThrow(/not valid any more/);
  });
  it("forgot password gives the same answer for unknown emails and sends nothing", async () => {
    expect(await requestPasswordReset("nobody@nowhere.in", "ip-1")).toEqual({ ok: true });
    expect(emails()).toHaveLength(0);
  });
  it("reset links are hashed, single-use, expire, and sign out every old session", async () => {
    const oldSession = await req("GET", "/api/orders", user.id, undefined, {}, businessId);
    expect((await Orders.GET(oldSession, ctx)).status).toBe(200);
    await requestPasswordReset("Meera@Iyer.in", "ip-2");
    const token = linkIn(emails()[0].body.html, "reset")!;
    expect(token.length).toBeGreaterThan(30);
    expect(JSON.stringify(await withoutBusiness(() => many("SELECT * FROM user_tokens")))).not.toContain(token);
    await expect(resetPassword(token, "short")).rejects.toThrow(/at least 8/);
    await resetPassword(token, "meera-new-pass-2");
    await expect(resetPassword(token, "meera-new-pass-3")).rejects.toThrow(/not valid any more/);
    expect((await Orders.GET(await req("GET", "/api/orders", user.id, undefined, {}, businessId), ctx)).status).toBe(401); // old session (sv=1) is dead
    expect(await authorizeCredentials({ email: "meera@iyer.in", password: "meera-new-pass-2" })).toMatchObject({ id: user.id });
    await requestPasswordReset("meera@iyer.in", "ip-3");
    const late = linkIn(emails()[0].body.html, "reset")!;
    await withoutBusiness(() => exec("UPDATE user_tokens SET expires_at = now() - interval '1 minute' WHERE purpose = 'reset_password' AND used_at IS NULL"));
    await expect(resetPassword(late, "meera-new-pass-4")).rejects.toThrow(/not valid any more/);
  });
  it("invites are emailed to the invited person with the join link", async () => {
    const inv = await withBusiness(businessId, () => createInvite({ email: "arjun@iyer.in", role: "staff" }, { id: user.id, name: "Meera Iyer", email: user.email, role: "owner", businessId }));
    expect(inv.emailed).toBe(true);
    expect(emails()[0].body.to).toEqual(["arjun@iyer.in"]);
    expect(emails()[0].body.subject).toBe("Meera Iyer invited you to Iyer Foods on Munshiji");
    expect(emails()[0].body.html).toContain(`https://app.munshiji.test/invite/${inv.token}`);
  });
});

describe("linking a WhatsApp number", () => {
  it("only a LINK code sent from that very phone links it; then forwarded orders are accepted and acknowledged", async () => {
    const l = await startPhoneLink(user.id, "98765 33333");
    expect(l).toMatchObject({ pending: "919876533333", message: expect.stringMatching(/^LINK \d{6}$/), send_to: "+91 90000 00000" });
    // before linking, forwarding is refused (with a polite, rate-limited reply)
    expect((await wa("wamid.A1", "919876533333", "10 boxes")).accepted).toBe(0);
    expect(whatsapps()[0].body).toMatchObject({ to: "919876533333", text: { body: expect.stringMatching(/isn't linked/) } });
    await wa("wamid.A2", "919876533333", "10 more boxes");
    expect(whatsapps().filter((w) => /isn't linked/.test(w.body.text.body))).toHaveLength(1); // once a day only
    // the right code from the wrong phone does nothing
    await wa("wamid.A3", "919999988888", l.message);
    expect((await withoutBusiness(() => one<{ phone: string }>("SELECT phone FROM users WHERE id = ?", [user.id])))!.phone).toBe("");
    // the right code from the right phone links it
    await wa("wamid.A4", "919876533333", l.message);
    expect((await withoutBusiness(() => one<{ phone: string }>("SELECT phone FROM users WHERE id = ?", [user.id])))!.phone).toBe("919876533333");
    expect(whatsapps().at(-1)!.body.text.body).toMatch(/^Linked ✓/);
    expect((await wa("wamid.A5", "919876533333", "20 boxes please")).accepted).toBe(1);
    expect(whatsapps().at(-1)!.body.text.body).toMatch(/^Mila ✓/);
  });
  it("nobody can claim a number that's already linked to someone else", async () => {
    const other = await authorizeCredentials({ action: "register", accept_terms: "true", name: "Imposter", email: "imp@x.in", password: "imposter-1", business_name: "X" }, "ip-x");
    await expect(startPhoneLink(other.id, "+91 98765 33333")).rejects.toThrow(/already linked/);
  });
});

describe("when email isn't set up", () => {
  it("nothing breaks: the attempt is logged as skipped", async () => {
    delete process.env.RESEND_API_KEY;
    expect(await requestPasswordReset("meera@iyer.in", "ip-9")).toEqual({ ok: true });
    expect(emails()).toHaveLength(0);
    expect((await withoutBusiness(() => one<{ status: string }>("SELECT status FROM outbound_messages WHERE channel = 'email' ORDER BY id DESC LIMIT 1")))!.status).toBe("skipped");
    process.env.RESEND_API_KEY = "re_test";
  });
});
