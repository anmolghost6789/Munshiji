import { many, one, exec, tx, scalar, withoutBusiness } from "@/lib/sql";
import { describe, it, expect, beforeAll } from "vitest";
import crypto from "crypto";
import { NextRequest } from "next/server";
import { verifySignature, processInbound } from "@/lib/whatsapp";
import { createOrder } from "@/lib/core/orders";
import * as Webhook from "@/app/api/whatsapp/webhook/route";
import { seedPilotBusiness, staff, TELIX } from "./helpers";

process.env.WHATSAPP_APP_SECRET = "test-app-secret-123";
process.env.WHATSAPP_VERIFY_TOKEN = "verify-me";
const sign = (b: string) => "sha256=" + crypto.createHmac("sha256", "test-app-secret-123").update(b).digest("hex");
const payload = (id: string, from: string, text: string) => JSON.stringify({ object: "whatsapp_business_account", entry: [{ changes: [{ field: "messages", value: { messaging_product: "whatsapp", metadata: { phone_number_id: "PNID" }, messages: [{ id, from, timestamp: "1761475200", type: "text", text: { body: text }, context: { forwarded: true } }] } }] }] });
const post = (b: string, sig?: string) => Webhook.POST(new NextRequest("http://x/api/whatsapp/webhook", { method: "POST", body: b, headers: sig ? { "x-hub-signature-256": sig } : {} }));
const row = async (ext: string) => (await one("SELECT * FROM inbound_messages WHERE external_id=?", [ext])) as { id: string; status: string; parsed_json: string; order_id: string } | undefined;

beforeAll(async () => { await seedPilotBusiness(); await withoutBusiness(() => exec("UPDATE users SET phone='919876500002', phone_verified_at=now() WHERE id=?", [staff.id])); });

describe("WhatsApp webhook", () => {
  it("answers Meta's verification only with the right token", async () => {
    expect((await Webhook.GET(new NextRequest("http://x/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=42"))).status).toBe(200);
    expect((await Webhook.GET(new NextRequest("http://x/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=42"))).status).toBe(403);
  });
  it("rejects unsigned or tampered requests", async () => {
    const b = payload("wamid.A", "919876500002", "500 tape");
    expect(verifySignature(b, sign(b))).toBe(true);
    expect((await post(b)).status).toBe(401);
    expect((await post(b.replace("500", "900"), sign(b))).status).toBe(401);
    expect(await row("wamid.A")).toBeUndefined();
  });
  it("turns a forwarded message from a team member into a draft — once, even if delivered twice", async () => {
    const b = payload("wamid.B", "919876500002", "Hindustan Foods: 500 BOPP tape aur 200 medium 5-ply box, 28th tak");
    expect((await (await post(b, sign(b))).json()).accepted).toBe(1);
    expect((await (await post(b, sign(b))).json()).accepted).toBe(0); // Meta retry
    expect(((await one("SELECT COUNT(*) c FROM inbound_messages WHERE external_id='wamid.B'")) as { c: number }).c).toBe(1);
    await processInbound((await row("wamid.B"))!.id, TELIX); // the webhook starts this in the background; awaited here
    const r = (await row("wamid.B"))!;
    expect(r.status).toBe("needs_approval");
    const draft = JSON.parse(r.parsed_json);
    expect(draft.customer.id).toBe("c-hfl");
    expect(draft.items.map((i: { product_id: string; qty: number }) => [i.product_id, i.qty])).toEqual([["sku-tape", 500], ["sku-box", 200]]);
    expect(((await one("SELECT COUNT(*) c FROM orders")) as { c: number }).c).toBe(0); // nothing saved without approval
  });
  it("ignores numbers that aren't on the team, and non-text messages", async () => {
    const b = payload("wamid.C", "919999999999", "1000 tape please");
    await post(b, sign(b));
    expect(await row("wamid.C")).toBeUndefined(); // not a team member: nothing stored anywhere
    const img = JSON.stringify({ entry: [{ changes: [{ value: { messages: [{ id: "wamid.D", from: "919876500002", type: "image", image: {} }] } }] }] });
    await post(img, sign(img));
    expect((await row("wamid.D"))!.status).toBe("unsupported");
  });
  it("approving creates exactly one order, even if approved twice", async () => {
    const r = (await row("wamid.B"))!;
    const draft = JSON.parse(r.parsed_json);
    const input = { customer: { id: draft.customer.id }, items: draft.items.map((i: { product_id: string; qty: number }) => ({ product_id: i.product_id, qty: i.qty })), inbound_id: r.id, raw_message: "…" };
    const a = await createOrder(input, staff, "wa:wamid.B");
    const b = await createOrder(input, staff, "wa:wamid.B-second-tab");
    expect(b.duplicate).toBe(true);
    expect(b.order.id).toBe(a.order.id);
    expect(a.order.source).toBe("whatsapp");
    expect((await row("wamid.B"))!).toMatchObject({ status: "approved", order_id: a.order.id });
  });
});
