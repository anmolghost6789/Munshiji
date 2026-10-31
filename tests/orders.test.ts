import { many, one, exec, tx, scalar } from "@/lib/sql";
import { describe, it, expect, beforeAll } from "vitest";
import { createOrder, updateOrder, advanceOrder, cancelOrder } from "@/lib/core/orders";
import { createReceipt } from "@/lib/core/inventory";
import { owner, manager, staff, seedPilotBusiness } from "./helpers";

beforeAll(async () => { await seedPilotBusiness(); await createReceipt({ supplier_name: "Shree Packaging", bill_number: "SP-1", items: [{ item_id: "sku-tape", qty: 500, rate: 30 }, { item_id: "sku-box", qty: 2000, rate: 20 }] }, owner); });
const order = (extra: object = {}) => ({ customer: { id: "c-hfl" }, items: [{ product_id: "sku-tape", qty: 100 }], ...extra });

describe("creating orders", () => {
  it("uses catalog price, catalog GST and server-side totals", async () => {
    const { order: o } = await createOrder(order({ items: [{ product_id: "sku-tape", qty: 100 }, { product_id: "sku-box", qty: 10 }] }), staff, "k-basic");
    expect(o.subtotal).toBe(100 * 42 + 10 * 28);
    expect(o.gst).toBe(Math.round((100 * 42 + 10 * 28) * 0.18 * 100) / 100);
    expect(o.items[0]).toMatchObject({ gst_rate: 18, hsn_code: "3919", unit: "roll" });
    expect(o.id).toMatch(/^ORD-\d+$/);
  });
  it("rejects products that aren't in the catalog", async () => {
    await expect((async () => createOrder(order({ items: [{ product_id: "UNKNOWN", qty: 5 }] }), staff))()).rejects.toThrow(/isn't in your catalog/);
  });
  it("rejects zero, negative and absurd quantities", async () => {
    for (const qty of [0, -3, 1e9]) await expect((async () => createOrder(order({ items: [{ product_id: "sku-tape", qty }] }), staff))()).rejects.toThrow();
  });
  it("blocks staff from changing prices; managers can and it is audited", async () => {
    await expect((async () => createOrder(order({ items: [{ product_id: "sku-tape", qty: 10, price: 35 }] }), staff))()).rejects.toThrow(/Only an owner or manager/);
    const { order: o } = await createOrder(order({ customer: { id: "c-ka" }, items: [{ product_id: "sku-tape", qty: 10, price: 35 }] }), manager, "k-override");
    expect(o.items[0].price).toBe(35);
    const a = (await one("SELECT details FROM audit_log WHERE action='order.create' AND entity_id=?", [o.id])) as { details: string };
    expect(JSON.parse(a.details).price_overrides[0]).toMatchObject({ catalog: 42, price: 35 });
  });
  it("ignores GST and totals sent by the client", async () => {
    const { order: o } = await createOrder({ ...order({ customer: { name: "Walk-in Buyer A" } }), gst: 0, grand_total: 1, subtotal: 1 } as never, staff, "k-tamper");
    expect(o.grand_total).toBe(Math.round(100 * 42 * 1.18 * 100) / 100);
  });
  it("saving twice with the same key creates one order", async () => {
    const a = await createOrder(order({ customer: { name: "Retry Buyer" } }), staff, "k-retry");
    const b = await createOrder(order({ customer: { name: "Retry Buyer" } }), staff, "k-retry");
    expect(b.duplicate).toBe(true);
    expect(b.order.id).toBe(a.order.id);
    expect(((await one("SELECT COUNT(*) c FROM orders WHERE idempotency_key='k-retry'")) as { c: number }).c).toBe(1);
  });
  it("warns about a likely duplicate saved minutes earlier with a different key", async () => {
    await createOrder(order({ customer: { name: "Dup Check Co" } }), staff, "k-d1");
    await expect((async () => createOrder(order({ customer: { name: "Dup Check Co" } }), staff, "k-d2"))()).rejects.toThrow(/saved a few minutes ago/);
    expect((await createOrder(order({ customer: { name: "Dup Check Co" }, confirm_duplicate: true }), staff, "k-d3")).duplicate).toBe(false);
  });
  it("rejects an invalid buyer GSTIN and reuses buyers with the same phone", async () => {
    await expect((async () => createOrder(order({ customer: { name: "Bad GST Co", gstin: "27AAPFU0939F1ZX" } }), staff))()).rejects.toThrow(/GSTIN/);
    const { order: o } = await createOrder(order({ customer: { name: "Hindustan Foods (typo)", phone: "+91 98200 12345" }, items: [{ product_id: "sku-box", qty: 3 }] }), staff, "k-phone");
    expect(o.customer_id).toBe("c-hfl");
  });
});

describe("editing, advancing and cancelling", () => {
  it("edits until dispatch, with version protection", async () => {
    const { order: o } = await createOrder(order({ customer: { id: "c-ka" }, items: [{ product_id: "sku-box", qty: 50 }] }), staff, "k-edit");
    const e = await updateOrder(o.id, { version: o.version, items: [{ product_id: "sku-box", qty: 60 }, { product_id: "sku-tape", qty: 5 }] }, staff);
    expect(e.items).toHaveLength(2);
    expect(e.subtotal).toBe(60 * 28 + 5 * 42);
    await expect((async () => updateOrder(o.id, { version: o.version, notes: "stale" }, staff))()).rejects.toThrow(/changed this order/);
  });
  it("moves one step at a time, deducts stock at dispatch, bills at invoicing, and locks edits", async () => {
    const { order: o } = await createOrder(order({ customer: { id: "c-ka" }, items: [{ product_id: "sku-tape", qty: 20 }] }), staff, "k-flow");
    await expect((async () => advanceOrder(o.id, "dispatched", staff))()).rejects.toThrow(/next step/);
    const before = ((await one("SELECT current_stock s FROM products WHERE id='sku-tape'")) as { s: number }).s;
    for (const s of ["confirmed", "preparing", "dispatched"]) await advanceOrder(o.id, s, staff);
    const after = ((await one("SELECT current_stock s FROM products WHERE id='sku-tape'")) as { s: number }).s;
    expect(after).toBe(before - 20);
    await expect((async () => updateOrder(o.id, { version: 99, notes: "x" }, staff))()).rejects.toThrow(/can't be edited/);
    await advanceOrder(o.id, "delivered", staff);
    await expect((async () => advanceOrder(o.id, "invoiced", staff))()).rejects.toThrow(/Only an owner or manager/);
    const billed = await advanceOrder(o.id, "invoiced", manager);
    expect(billed.state).toBe("invoiced");
    await expect((async () => advanceOrder(o.id, "paid", manager))()).rejects.toThrow(/Record the payment/);
    await expect((async () => cancelOrder(o.id, "buyer changed mind", owner))()).rejects.toThrow(/credit note/);
  });
  it("cancelling after dispatch puts the stock back exactly once", async () => {
    const { order: o } = await createOrder(order({ customer: { name: "Cancel Co" }, items: [{ product_id: "sku-box", qty: 40 }] }), staff, "k-cancel");
    const stock = async () => ((await one("SELECT current_stock s FROM products WHERE id='sku-box'")) as { s: number }).s;
    const s0 = await stock();
    for (const s of ["confirmed", "preparing", "dispatched"]) await advanceOrder(o.id, s, staff);
    expect(await stock()).toBe(s0 - 40);
    await expect((async () => cancelOrder(o.id, "", manager))()).rejects.toThrow(/Say why/);
    await cancelOrder(o.id, "Truck broke down, buyer cancelled", manager);
    expect(await stock()).toBe(s0);
    await expect((async () => cancelOrder(o.id, "again", manager))()).rejects.toThrow(/already cancelled/);
    expect(await stock()).toBe(s0);
  });
});
