import { many, one, exec, tx, scalar } from "@/lib/sql";
import { describe, it, expect, beforeAll } from "vitest";
import { createReceipt, adjustStock, deductForOrder, ledgerMismatches, ledgerFor } from "@/lib/core/inventory";
import { createOrder, advanceOrder } from "@/lib/core/orders";
import { owner, manager, staff, seedPilotBusiness } from "./helpers";

const stock = async (id: string) => ((await one("SELECT current_stock s FROM products WHERE id=?", [id])) as { s: number }).s;
beforeAll(async () => await seedPilotBusiness());

describe("purchase receipts", () => {
  it("adds stock with a ledger line per item, merging repeated lines", async () => {
    const r = await createReceipt({ supplier_name: "Shree Packaging", supplier_gstin: "27AAPFU0939F1ZV", bill_number: "SP-101", bill_date: "2026-10-20",
      items: [{ item_id: "sku-tape", qty: 300, rate: 30 }, { item_id: "sku-tape", qty: 100, rate: 34 }, { item_id: "sku-film", qty: 20, rate: 250 }] }, manager);
    expect(await stock("sku-tape")).toBe(400);
    expect(await stock("sku-film")).toBe(20);
    const l = await ledgerFor("product", "sku-tape") as { qty: number; balance_after: number; ref_id: string }[];
    expect(l).toHaveLength(1);
    expect(l[0]).toMatchObject({ qty: 400, balance_after: 400, ref_id: r.id });
  });
  it("refuses the same supplier bill twice, and the same save twice", async () => {
    const sup = ((await one("SELECT supplier_id FROM purchase_receipts WHERE bill_number='SP-101'")) as { supplier_id: string }).supplier_id;
    await expect((async () => createReceipt({ supplier_id: sup, bill_number: "SP-101", items: [{ item_id: "sku-tape", qty: 1, rate: 1 }] }, manager))()).rejects.toThrow(/already recorded/);
    const a = await createReceipt({ supplier_id: sup, bill_number: "SP-102", items: [{ item_id: "sku-box", qty: 1000, rate: 20 }] }, manager, "rcpt-key-1");
    const b = await createReceipt({ supplier_id: sup, bill_number: "SP-102", items: [{ item_id: "sku-box", qty: 1000, rate: 20 }] }, manager, "rcpt-key-1");
    expect(b).toEqual({ id: a.id, duplicate: true });
    expect(await stock("sku-box")).toBe(1000);
  });
  it("rejects bad receipts without changing anything", async () => {
    const before = await stock("sku-tape");
    await expect((async () => createReceipt({ supplier_name: "X Co", items: [{ item_id: "sku-tape", qty: 10, rate: 5 }, { item_id: "no-such-sku", qty: 1, rate: 1 }] }, manager))()).rejects.toThrow(/not found/);
    expect(await stock("sku-tape")).toBe(before); // the first line was rolled back too
    await expect((async () => createReceipt({ supplier_name: "X Co", items: [{ item_id: "sku-tape", qty: -5, rate: 5 }] }, manager))()).rejects.toThrow();
  });
});

describe("dispatch deductions", () => {
  it("blocks dispatch when stock is short, and names what's missing", async () => {
    const { order } = await createOrder({ customer: { id: "c-hfl" }, items: [{ product_id: "sku-film", qty: 25 }] }, staff, "inv-short");
    await advanceOrder(order.id, "confirmed", staff); await advanceOrder(order.id, "preparing", staff);
    await expect((async () => advanceOrder(order.id, "dispatched", staff))()).rejects.toThrow(/Stretch Film 18in \(20 of 25 roll\)/);
    expect(await stock("sku-film")).toBe(20);
    const o = (await one("SELECT state, stock_deducted FROM orders WHERE id=?", [order.id])) as { state: string; stock_deducted: number };
    expect(o).toEqual({ state: "preparing", stock_deducted: 0 }); // nothing half-applied
  });
  it("deducts exactly once even if dispatch is applied twice", async () => {
    const { order } = await createOrder({ customer: { id: "c-ka" }, items: [{ product_id: "sku-tape", qty: 50 }, { product_id: "sku-tape", qty: 10 }] }, staff, "inv-once");
    const s0 = await stock("sku-tape");
    for (const s of ["confirmed", "preparing", "dispatched"]) await advanceOrder(order.id, s, staff);
    await tx(() => deductForOrder(order.id, staff));
    expect(await stock("sku-tape")).toBe(s0 - 60);
    await expect((async () => (await exec("INSERT INTO inventory_ledger (item_type,item_id,item_name,direction,qty,ref_type,ref_id) VALUES ('product','sku-tape','x','out',60,'order_dispatch',?)", [order.id])))()).rejects.toThrow(/unique/i);
  });
});

describe("adjustments and the ledger invariant", () => {
  it("adjusts to a counted quantity with a reason", async () => {
    await expect((async () => adjustStock({ item_id: "sku-film", new_qty: 18, reason: "" }, manager))()).rejects.toThrow(/Say why/);
    await adjustStock({ item_id: "sku-film", new_qty: 18, reason: "2 rolls damaged in monsoon" }, owner);
    expect(await stock("sku-film")).toBe(18);
  });
  it("every balance equals the sum of its ledger", async () => {
    expect(await ledgerMismatches()).toEqual([]);
  });
});

describe("raw materials (e.g. kraft paper reels)", () => {
  it("a purchase adds to the material's stock and counts as input credit at its own rate", async () => {
    const { one, exec } = await import("@/lib/sql");
    const { prepareReturns } = await import("@/lib/gst-returns");
    await exec("INSERT INTO raw_materials (id, name, unit, hsn_code, gst_rate) VALUES ('m-kraft', 'Kraft Paper Reel 120 GSM', 'kg', '48041900', 18) ON CONFLICT DO NOTHING");
    const month = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 7);
    const before = ((await prepareReturns(month)) as { gstr3b: { itc: { cgst: number; sgst: number } } }).gstr3b.itc;
    await createReceipt({ supplier_name: "Shree Paper Mills", supplier_gstin: "27AAPFU0939F1ZV", bill_number: "SPM-9", items: [{ item_type: "material", item_id: "m-kraft", qty: 8000, rate: 32 }] }, owner);
    expect((await one<{ s: number }>("SELECT current_stock s FROM raw_materials WHERE id = 'm-kraft'"))!.s).toBe(8000);
    const after = ((await prepareReturns(month)) as { gstr3b: { itc: { cgst: number; sgst: number } } }).gstr3b.itc;
    expect(Math.round((after.cgst + after.sgst - before.cgst - before.sgst) * 100) / 100).toBe(46080); // 2,56,000 × 18%
  });
});
