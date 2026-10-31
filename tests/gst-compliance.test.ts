/* Credit notes, e-invoicing (IRN) and e-way bills: each rule checked against worked numbers. */
import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import { one, many, exec } from "@/lib/sql";
import { upsertBusinessProfile } from "@/lib/db";
import { createOrder, advanceOrder } from "@/lib/core/orders";
import { createReceipt } from "@/lib/core/inventory";
import { recordPayment, moneyProblems } from "@/lib/core/money";
import { createCreditNote, creditNoteDeadline, recordIrn, pendingIrns, setTransport } from "@/lib/core/gstdocs";
import { prepareReturns } from "@/lib/gst-returns";
import { owner, manager, staff, seedPilotBusiness } from "./helpers";

const stock = async (id: string) => (await one<{ s: number }>("SELECT current_stock s FROM products WHERE id = ?", [id]))!.s;
afterEach(() => vi.useRealTimers());
async function billed(customer: string, items: { product_id: string; qty: number }[], key: string) {
  const { order } = await createOrder({ customer: { id: customer }, items, confirm_duplicate: true }, staff, key);
  for (const s of ["confirmed", "preparing"]) await advanceOrder(order.id, s, staff);
  if (order.grand_total > 50000) await setTransport(order.id, { ewb_number: "1234 5678 9012", vehicle_number: "MH12AB1234" }, staff);
  for (const s of ["dispatched", "delivered"]) await advanceOrder(order.id, s, staff);
  return advanceOrder(order.id, "invoiced", manager);
}
beforeAll(async () => { await seedPilotBusiness(); await createReceipt({ supplier_name: "Shree", items: [{ item_id: "sku-tape", qty: 50000, rate: 30 }, { item_id: "sku-box", qty: 50000, rate: 20 }] }, owner); });

describe("credit notes", () => {
  it("are allowed until 30 November after the bill's financial year", () => {
    expect(creditNoteDeadline("2026-10-26")).toBe("2027-11-30");
    expect(creditNoteDeadline("2027-03-31")).toBe("2027-11-30");
    expect(creditNoteDeadline("2027-04-01")).toBe("2028-11-30");
  });
  it("credit returned goods: never more than billed, tax split kept, stock back, own numbering, balance reduced", async () => {
    const o = await billed("c-hfl", [{ product_id: "sku-tape", qty: 100 }, { product_id: "sku-box", qty: 200 }], "cn-1"); // 4200 + 5600 = 9800 + 18%
    const s0 = await stock("sku-tape");
    await expect(createCreditNote(o.id, { reason: "goods_returned", lines: [{ product_id: "sku-tape", qty: 101 }] }, manager)).rejects.toThrow(/only 100 roll/);
    const cn = await createCreditNote(o.id, { reason: "goods_returned", restock: true, lines: [{ product_id: "sku-tape", qty: 25 }] }, manager, "cn-key-1");
    expect(cn.number).toMatch(/^CN\/\d\d-\d\d\/0001$/);
    expect(cn.grand_total).toBe(1239); // 25 × 42 = 1050 + 18% (CGST 94.50 + SGST 94.50)
    const row = (await one<{ cgst: number; sgst: number; igst: number }>("SELECT cgst, sgst, igst FROM credit_notes WHERE id = ?", [cn.id]))!;
    expect(row).toEqual({ cgst: 94.5, sgst: 94.5, igst: 0 });
    expect(await stock("sku-tape")).toBe(s0 + 25);
    expect((await createCreditNote(o.id, { reason: "goods_returned", lines: [{ product_id: "sku-tape", qty: 25 }] }, manager, "cn-key-1")).duplicate).toBe(true);
    await expect(createCreditNote(o.id, { reason: "goods_returned", lines: [{ product_id: "sku-tape", qty: 76 }] }, manager)).rejects.toThrow(/only 75 roll/);
    const ord = (await one<{ amount_credited: number; grand_total: number }>("SELECT amount_credited, grand_total FROM orders WHERE id = ?", [o.id]))!;
    expect(ord.amount_credited).toBe(1239);
    await recordPayment(o.id, { amount: ord.grand_total - 1239 }, manager);
    expect((await one<{ state: string }>("SELECT state FROM orders WHERE id = ?", [o.id]))!.state).toBe("paid"); // paid in full after the credit
  });
  it("price reductions credit an amount, not a quantity; refunds are flagged when the bill was already paid", async () => {
    const o = await billed("c-hfl", [{ product_id: "sku-box", qty: 1000 }], "cn-2"); // 28,000 + 5,040
    await recordPayment(o.id, { amount: o.grand_total }, manager);
    await expect(createCreditNote(o.id, { reason: "price_reduction", lines: [{ product_id: "sku-box", qty: 10 }] }, manager)).rejects.toThrow(/give an amount/);
    const cn = await createCreditNote(o.id, { reason: "price_reduction", reason_note: "₹2 off per box agreed", lines: [{ product_id: "sku-box", amount: 2000 }] }, manager);
    expect(cn).toMatchObject({ grand_total: 2360, refund_due: 2360 });
    expect(cn.number).toMatch(/\/0002$/);
  });
  it("a full credit of an unpaid bill leaves the order 'Credited' with nothing due", async () => {
    const o = await billed("c-hfl", [{ product_id: "sku-tape", qty: 10 }], "cn-3");
    await createCreditNote(o.id, { reason: "goods_returned", lines: [{ product_id: "sku-tape", qty: 10 }] }, manager);
    expect((await one<{ state: string }>("SELECT state FROM orders WHERE id = ?", [o.id]))!.state).toBe("credited");
    await expect(recordPayment(o.id, { amount: 1 }, manager)).rejects.toThrow(/fully credited/);
    // "Credited" is never a step anyone can move an order to by hand
    const paid = await billed("c-hfl", [{ product_id: "sku-tape", qty: 2 }], "cn-3b");
    await recordPayment(paid.id, { amount: paid.grand_total }, manager);
    await expect(advanceOrder(paid.id, "credited", owner)).rejects.toThrow(/credit notes|no next step/);
    expect((await one<{ state: string }>("SELECT state FROM orders WHERE id = ?", [paid.id]))!.state).toBe("paid");
  });
  it("inter-state bills get IGST credit notes", async () => {
    const o = await billed("c-ka", [{ product_id: "sku-box", qty: 100 }], "cn-4"); // Karnataka buyer
    const cn = await createCreditNote(o.id, { reason: "goods_returned", lines: [{ product_id: "sku-box", qty: 50 }] }, manager);
    expect(await one("SELECT cgst, sgst, igst FROM credit_notes WHERE id = ?", [cn.id])).toEqual({ cgst: 0, sgst: 0, igst: 252 }); // 1400 × 18%
  });
  it("can't be issued after the deadline, or for unbilled orders", async () => {
    const o = await billed("c-hfl", [{ product_id: "sku-tape", qty: 5 }], "cn-5");
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2099-01-01T06:00:00Z"));
    await expect(createCreditNote(o.id, { reason: "goods_returned", lines: [{ product_id: "sku-tape", qty: 1 }] }, manager)).rejects.toThrow(/GST deadline/);
    vi.useRealTimers();
    const { order } = await createOrder({ customer: { id: "c-hfl" }, items: [{ product_id: "sku-tape", qty: 1 }], confirm_duplicate: true }, staff, "cn-unbilled");
    await expect(createCreditNote(order.id, { reason: "goods_returned", lines: [{ product_id: "sku-tape", qty: 1 }] }, manager)).rejects.toThrow(/needs a bill/);
  });
  it("go into GSTR-1 (CDNR for registered buyers) and make HSN and GSTR-3B net", async () => {
    const month = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 7);
    const r = await prepareReturns(month) as { gstr1: { cdnr: { note: string; taxable: number }[]; hsn: { hsn: string; taxable: number }[] }; gstr3b: { outward: { taxable: number } } };
    expect(r.gstr1.cdnr.map((x) => x.taxable).sort((a, b) => a - b)).toEqual([420, 1050, 1400, 2000]); // every credit note so far went to a registered buyer
    const billedTaxable = (await one<{ t: number }>("SELECT COALESCE(SUM(subtotal),0) t FROM invoices"))!.t;
    const creditedTaxable = (await one<{ t: number }>("SELECT COALESCE(SUM(subtotal),0) t FROM credit_notes"))!.t;
    expect(r.gstr3b.outward.taxable).toBe(Math.round((billedTaxable - creditedTaxable) * 100) / 100);
    expect(await moneyProblems()).toMatchObject({ overpaid: [], paidMismatch: [], creditMismatch: [] });
  });
});

describe("e-invoicing", () => {
  it("bills to registered buyers need an IRN when the business is above ₹5 crore; consumer bills don't", async () => {
    await upsertBusinessProfile({ einvoice_applicable: 1 } as never);
    const b2b = await billed("c-hfl", [{ product_id: "sku-tape", qty: 3 }], "ei-1");
    await exec("INSERT INTO customers (id, name) VALUES ('c-walkin', 'Walk-in Buyer') ON CONFLICT DO NOTHING");
    const b2c = await billed("c-walkin", [{ product_id: "sku-tape", qty: 3 }], "ei-2");
    const inv = async (oid: string) => (await one<{ id: string; einvoice_required: number }>("SELECT id, einvoice_required FROM invoices WHERE order_id = ?", [oid]))!;
    expect((await inv(b2b.id)).einvoice_required).toBe(1);
    expect((await inv(b2c.id)).einvoice_required).toBe(0);
    expect((await pendingIrns()).map((p) => p.invoice_number)).toEqual([b2b.invoice_number]);
    const month = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 7);
    expect(JSON.stringify((await prepareReturns(month) as { checks: unknown[] }).checks)).toMatch(/needs an IRN/);
    await expect(createCreditNote(b2b.id, { reason: "goods_returned", lines: [{ product_id: "sku-tape", qty: 1 }] }, manager)).rejects.toThrow(/IRN recorded/);
    await expect(recordIrn("invoice", (await inv(b2b.id)).id, { irn: "not-an-irn", ack_no: "112410012345678", ack_date: "2026-10-27 11:00", signed_qr: "x".repeat(40) }, manager)).rejects.toThrow(/64 letters/);
    const irn = "a".repeat(64);
    await recordIrn("invoice", (await inv(b2b.id)).id, { irn, ack_no: "112410012345678", ack_date: "2026-10-27 11:00", signed_qr: "eyJhbGciOi".padEnd(60, "x") }, manager);
    await expect(recordIrn("invoice", (await inv(b2b.id)).id, { irn, ack_no: "112410012345678", ack_date: "2026-10-27 11:00", signed_qr: "x".repeat(40) }, manager)).rejects.toThrow(/already recorded/);
    expect(await pendingIrns()).toEqual([]);
    await upsertBusinessProfile({ einvoice_applicable: 0 } as never);
  });
});

describe("e-way bills", () => {
  async function ready(qty: number, key: string) {
    const { order } = await createOrder({ customer: { id: "c-hfl" }, items: [{ product_id: "sku-box", qty }], confirm_duplicate: true }, staff, key);
    for (const s of ["confirmed", "preparing"]) await advanceOrder(order.id, s, staff);
    return order;
  }
  it("block dispatch above ₹50,000 until the e-way bill number and vehicle are recorded", async () => {
    const o = await ready(2000, "ewb-1"); // 56,000 + 18% = 66,080
    await expect(advanceOrder(o.id, "dispatched", staff)).rejects.toThrow(/above ₹50,000/);
    await expect(setTransport(o.id, { ewb_number: "12345" }, staff)).rejects.toThrow(/12 digits/);
    await expect(setTransport(o.id, { vehicle_number: "XYZ" }, staff)).rejects.toThrow(/MH12AB1234/);
    await setTransport(o.id, { ewb_number: "3410 1234 5678" }, staff);
    await expect(advanceOrder(o.id, "dispatched", staff)).rejects.toThrow(/vehicle number or transporter/);
    await setTransport(o.id, { vehicle_number: "mh 12 ab 1234", transporter_name: "Shree Logistics" }, staff);
    expect((await advanceOrder(o.id, "dispatched", staff)).state).toBe("dispatched");
    expect(await one("SELECT ewb_number, vehicle_number FROM orders WHERE id = ?", [o.id])).toEqual({ ewb_number: "341012345678", vehicle_number: "MH12AB1234" });
  });
  it("allow a stated exemption, and don't apply below the threshold or for unregistered businesses", async () => {
    const ex = await ready(2000, "ewb-2");
    await setTransport(ex.id, { ewb_exempt_reason: "Value below the limit in this state" }, staff);
    expect((await advanceOrder(ex.id, "dispatched", staff)).state).toBe("dispatched");
    const small = await ready(100, "ewb-3"); // 3,304
    expect((await advanceOrder(small.id, "dispatched", staff)).state).toBe("dispatched");
    await upsertBusinessProfile({ ewb_threshold: 100000 } as never);
    const mid = await ready(2000, "ewb-4"); // 66,080 < 1,00,000: Maharashtra's limit within the state
    expect((await advanceOrder(mid.id, "dispatched", staff)).state).toBe("dispatched");
    // ...but going to Karnataka is inter-state, where ₹50,000 always applies
    const { order: out } = await createOrder({ customer: { id: "c-ka" }, items: [{ product_id: "sku-box", qty: 2000 }], confirm_duplicate: true }, staff, "ewb-5");
    for (const st of ["confirmed", "preparing"]) await advanceOrder(out.id, st, staff);
    await expect(advanceOrder(out.id, "dispatched", staff)).rejects.toThrow(/above ₹50,000/);
  });
});
