/* Two real businesses, created through sign-up, trying every way to reach each other's data.
   Runs as the app's ordinary database role, so Row-Level Security is genuinely in force. */
import { describe, it, expect, beforeAll } from "vitest";
import crypto from "crypto";
import { NextRequest } from "next/server";
import { one, many, exec, withBusiness, withoutBusiness, setTestBusiness } from "@/lib/sql";
import { authorizeCredentials } from "@/lib/auth-options";
import { createReceipt } from "@/lib/core/inventory";
import { createOrder, advanceOrder } from "@/lib/core/orders";
import { createProduct } from "@/lib/core/catalog";
import { createInvite, inviteInfo, acceptInvite } from "@/lib/core/tenancy";
import * as Orders from "@/app/api/orders/route";
import * as Customers from "@/app/api/customers/route";
import * as Session from "@/app/api/session/business/route";
import * as Me from "@/app/api/me/route";
import * as Team from "@/app/api/team/route";
import * as Webhook from "@/app/api/whatsapp/webhook/route";
import type { Actor } from "@/lib/authz";
import { req, ctx } from "./request";

let A: Actor, B: Actor;
const asA = <T,>(fn: () => Promise<T>) => withBusiness(A.businessId, fn);
const asB = <T,>(fn: () => Promise<T>) => withBusiness(B.businessId, fn);

async function setUp(actor: Actor, product: string) {
  return withBusiness(actor.businessId, async () => {
    const p = await createProduct({ name: product, unit: "piece", price: 10, hsn_code: "4819", gst_rate: 18 }, actor);
    await createReceipt({ supplier_name: "Supplier", bill_number: "S1", items: [{ item_id: p.id, qty: 1000, rate: 5 }] }, actor);
    const { order } = await createOrder({ customer: { name: `${product} Buyer` }, items: [{ product_id: p.id, qty: 10 }] }, actor, "same-key-in-both");
    for (const s of ["confirmed", "preparing", "dispatched", "delivered", "invoiced"]) await advanceOrder(order.id, s, { ...actor, role: "owner" });
    return { productId: p.id, order: (await one<{ id: string; customer_id: string }>("SELECT id, customer_id FROM orders WHERE id = ?", [order.id]))! };
  });
}

let dataA: Awaited<ReturnType<typeof setUp>>, dataB: Awaited<ReturnType<typeof setUp>>;
beforeAll(async () => {
  setTestBusiness(undefined);
  const a = await authorizeCredentials({ action: "register", accept_terms: "true", name: "Asha", email: "asha@alpha.in", password: "alpha-pass-1", business_name: "Alpha Plastics" }, "ip-a");
  const b = await authorizeCredentials({ action: "register", accept_terms: "true", name: "Bilal", email: "bilal@beta.in", password: "beta-pass-1", business_name: "Beta Boxes" }, "ip-b");
  const bid = async (u: string) => (await withoutBusiness(() => one<{ business_id: string }>("SELECT business_id FROM memberships WHERE user_id = ?", [u])))!.business_id;
  A = { ...a, role: "owner", businessId: await bid(a.id) };
  B = { ...b, role: "owner", businessId: await bid(b.id) };
  dataA = await setUp(A, "Alpha Tub");
  dataB = await setUp(B, "Beta Carton");
});

describe("each business sees only its own data", () => {
  it("numbers orders and bills independently: both start at ORD-1001 and 0001", async () => {
    expect(dataA.order.id).toBe("ORD-1001");
    expect(dataB.order.id).toBe("ORD-1001");
    const billA = await asA(() => one<{ n: string }>("SELECT invoice_number n FROM invoices"));
    const billB = await asB(() => one<{ n: string }>("SELECT invoice_number n FROM invoices"));
    expect(billA!.n).toMatch(/^INV\/\d\d-\d\d\/0001$/);
    expect(billB!.n).toBe(billA!.n);
  });
  it("the same order ID through the API returns each business its own order", async () => {
    const a = await (await Orders.GET(await req("GET", "/api/orders?id=ORD-1001", A.id), ctx)).json();
    const b = await (await Orders.GET(await req("GET", "/api/orders?id=ORD-1001", B.id), ctx)).json();
    expect(a.order.items[0].product_name).toBe("Alpha Tub");
    expect(b.order.items[0].product_name).toBe("Beta Carton");
    const listB = await (await Orders.GET(await req("GET", "/api/orders", B.id), ctx)).json();
    expect(listB.orders.map((o: { customer_name: string }) => o.customer_name)).toEqual(["Beta Carton Buyer"]);
    const custB = await (await Customers.GET(await req("GET", "/api/customers", B.id), ctx)).json();
    expect(custB.customers.map((c: { name: string }) => c.name)).toEqual(["Beta Carton Buyer"]);
  });
  it("a duplicate-save key used by both businesses creates two separate orders", async () => {
    expect(await asA(() => one<{ c: number }>("SELECT COUNT(*) c FROM orders WHERE idempotency_key = 'same-key-in-both'"))).toEqual({ c: 1 });
    expect(await asB(() => one<{ c: number }>("SELECT COUNT(*) c FROM orders WHERE idempotency_key = 'same-key-in-both'"))).toEqual({ c: 1 });
  });
});

describe("one business can't reach another's data", () => {
  it("can't order another business's product or bill another business's customer", async () => {
    await expect(asB(() => createOrder({ customer: { id: dataB.order.customer_id }, items: [{ product_id: dataA.productId, qty: 1 }] }, B))).rejects.toThrow(/isn't in your catalog/);
    await expect(asB(() => createOrder({ customer: { id: dataA.order.customer_id }, items: [{ product_id: dataB.productId, qty: 1 }] }, B))).rejects.toThrow(/no longer exists/);
  });
  it("database links refuse cross-business rows even if application code had a bug", async () => {
    // A hand-written insert in B pointing at A's customer: the composite foreign key rejects it.
    await expect(asB(() => exec("INSERT INTO orders (id, customer_id) VALUES ('ORD-X', ?)", [dataA.order.customer_id]))).rejects.toThrow(/foreign key/);
  });
  it("Row-Level Security hides and protects rows even from queries with no business filter", async () => {
    const seen = await asB(() => many<{ business_id: string }>("SELECT business_id FROM orders"));
    expect(new Set(seen.map((r) => r.business_id))).toEqual(new Set([B.businessId]));
    expect(await asB(() => exec("UPDATE invoices SET grand_total = 0 WHERE business_id = ?", [A.businessId]))).toBe(0);
    expect(await asB(() => exec("DELETE FROM products WHERE business_id = ?", [A.businessId]))).toBe(0);
    await expect(asB(() => exec("INSERT INTO customers (id, name, business_id) VALUES ('c-plant', 'x', ?)", [A.businessId]))).rejects.toThrow(/row-level security/);
    expect(await withoutBusiness(() => many("SELECT id FROM orders"))).toEqual([]); // no business chosen: nothing at all
  });
  it("a forged business cookie is ignored: you act only where you're a member", async () => {
    const r = await (await Orders.GET(await req("GET", "/api/orders", A.id, undefined, {}, B.businessId), ctx)).json();
    expect(r.orders.map((o: { customer_name: string }) => o.customer_name)).toEqual(["Alpha Tub Buyer"]);
    expect((await Session.POST(await req("POST", "/api/session/business", A.id, { business_id: B.businessId }))).status).toBe(403);
  });
  it("an owner can't manage another business's team", async () => {
    expect((await Team.PATCH(await req("PATCH", "/api/team", A.id, { user_id: B.id, active: false }), ctx)).status).toBe(404);
  });
});

describe("invitations", () => {
  it("invite links are single-use, stored only as a hash, and tied to the invited email", async () => {
    const inv = await asA(() => createInvite({ email: "chetan@alpha.in", role: "staff", phone: "9876511111" }, A));
    const stored = await withoutBusiness(() => one<{ token_hash: string }>("SELECT token_hash FROM invites WHERE id = ?", [inv.id]));
    expect(stored!.token_hash).toBe(crypto.createHash("sha256").update(inv.token).digest("hex"));
    expect(JSON.stringify(await withoutBusiness(() => many("SELECT * FROM invites")))).not.toContain(inv.token);
    expect(await inviteInfo(inv.token)).toMatchObject({ business_name: "Alpha Plastics", role: "staff", has_account: false });
    await expect(acceptInvite(inv.token, { email: "someone@else.in", password: "chetan-pass-1", name: "Chetan", acceptTerms: true })).rejects.toThrow(/email address the invite was sent to/);
    const u = await acceptInvite(inv.token, { email: "chetan@alpha.in", password: "chetan-pass-1", name: "Chetan", acceptTerms: true });
    expect(u.businessId).toBe(A.businessId);
    await expect(acceptInvite(inv.token, { email: "chetan@alpha.in", password: "chetan-pass-1", name: "Chetan", acceptTerms: true })).rejects.toThrow(/not valid any more/);
    expect(await inviteInfo(inv.token)).toBeNull();
    expect(await inviteInfo("not-a-real-token-but-long-enough-xyz")).toBeNull();
  });
  it("expired and revoked links don't work", async () => {
    const e = await asA(() => createInvite({ email: "late@alpha.in", role: "staff" }, A));
    await withoutBusiness(() => exec("UPDATE invites SET expires_at = now() - interval '1 minute' WHERE id = ?", [e.id]));
    await expect(acceptInvite(e.token, { email: "late@alpha.in", password: "late-pass-12", name: "Late", acceptTerms: true })).rejects.toThrow(/not valid/);
    const r = await (await Team.POST(await req("POST", "/api/team", A.id, { email: "gone@alpha.in", role: "staff" }), ctx)).json();
    expect(r.url).toMatch(/\/invite\//);
    expect((await Team.DELETE(await req("DELETE", `/api/team?invite_id=${r.id}`, A.id), ctx)).status).toBe(200);
    await expect(acceptInvite(r.token, { email: "gone@alpha.in", password: "gone-pass-12", name: "Gone", acceptTerms: true })).rejects.toThrow(/not valid/);
  });
  it("one person can work in two businesses with a different role in each, and switch between them", async () => {
    const inv = await asB(() => createInvite({ email: "asha@alpha.in", role: "staff" }, B));
    await expect(acceptInvite(inv.token, { email: "asha@alpha.in", password: "wrong-password" })).rejects.toThrow(/incorrect/);
    await acceptInvite(inv.token, { email: "asha@alpha.in", password: "alpha-pass-1" });
    const me = await (await Me.GET(await req("GET", "/api/me", A.id))).json();
    expect(me.businesses.map((b: { name: string; role: string }) => `${b.name}:${b.role}`)).toEqual(["Alpha Plastics:owner", "Beta Boxes:staff"]);
    const sw = await Session.POST(await req("POST", "/api/session/business", A.id, { business_id: B.businessId }));
    expect(sw.status).toBe(200);
    expect(sw.headers.get("set-cookie")).toMatch(/mj_business=.*HttpOnly/i);
    // in Beta, Asha is staff: Beta's team settings are off-limits, Beta's orders are visible
    expect((await Team.GET(await req("GET", "/api/team", A.id, undefined, {}, B.businessId), ctx)).status).toBe(403);
    const inB = await (await Orders.GET(await req("GET", "/api/orders", A.id, undefined, {}, B.businessId), ctx)).json();
    expect(inB.orders[0].customer_name).toBe("Beta Carton Buyer");
  });
});

describe("WhatsApp goes to the right business", () => {
  it("a forwarded order lands in the sender's business only", async () => {
    process.env.WHATSAPP_APP_SECRET = "tenancy-secret";
    await withoutBusiness(() => exec("UPDATE users SET phone = '919876522222', phone_verified_at = now() WHERE id = ?", [B.id]));
    const body = JSON.stringify({ entry: [{ changes: [{ value: { metadata: { phone_number_id: "SHARED" }, messages: [{ id: "wamid.T1", from: "919876522222", type: "text", text: { body: "10 Beta Carton" } }] } }] }] });
    const sig = "sha256=" + crypto.createHmac("sha256", "tenancy-secret").update(body).digest("hex");
    expect((await (await Webhook.POST(new NextRequest("http://x/api/whatsapp/webhook", { method: "POST", body, headers: { "x-hub-signature-256": sig } }))).json()).accepted).toBe(1);
    const inB = await asB(() => one<{ id: string }>("SELECT id FROM inbound_messages WHERE external_id = 'wamid.T1'"));
    expect(inB).toBeTruthy();
    expect(await asA(() => one("SELECT id FROM inbound_messages WHERE external_id = 'wamid.T1'"))).toBeUndefined();
    // the webhook reads it in the background; wait for that to finish
    let status = "";
    for (let i = 0; i < 40 && status !== "needs_approval"; i++) { status = (await asB(() => one<{ status: string }>("SELECT status FROM inbound_messages WHERE id = ?", [inB!.id])))!.status; await new Promise((r) => setTimeout(r, 50)); }
    expect(status).toBe("needs_approval");
  });
});
