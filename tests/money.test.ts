import { many, one, exec, tx, scalar } from "@/lib/sql";
import { describe, it, expect, beforeAll, vi, afterEach } from "vitest";
import { upsertBusinessProfile } from "@/lib/db";
import { createOrder, advanceOrder } from "@/lib/core/orders";
import { createReceipt } from "@/lib/core/inventory";
import { createBillTx, recordPayment, voidPayment, moneyProblems } from "@/lib/core/money";
import { fyLabel, istDate } from "@/lib/core/time";
import { owner, manager, staff, seedPilotBusiness } from "./helpers";

beforeAll(async () => { await seedPilotBusiness(); await createReceipt({ supplier_name: "Shree", items: [{ item_id: "sku-box", qty: 100000, rate: 20 }] }, owner); });
afterEach(async () => vi.useRealTimers());

async function deliveredOrder(key: string, qty = 100) {
  const { order } = await createOrder({ customer: { id: "c-hfl" }, items: [{ product_id: "sku-box", qty }], confirm_duplicate: true }, staff, key);
  for (const s of ["confirmed", "preparing", "dispatched", "delivered"]) await advanceOrder(order.id, s, staff);
  return order.id;
}

describe("India time and financial years", () => {
  it("uses IST for dates and April–March financial years", async () => {
    expect(istDate(new Date("2026-03-31T18:29:00Z"))).toBe("2026-03-31");
    expect(istDate(new Date("2026-03-31T18:31:00Z"))).toBe("2026-04-01"); // midnight IST
    expect(fyLabel("2026-03-31")).toBe("25-26");
    expect(fyLabel("2026-04-01")).toBe("26-27");
  });
});

describe("bill numbers", () => {
  it("start from the configured number, are consecutive, unique and ≤ 16 characters", async () => {
    await upsertBusinessProfile({ invoice_prefix: "TLX", invoice_start: 245 } as never);
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-10-26T06:00:00Z"));
    const nums: (string | null | undefined)[] = [];
    for (const i of [1, 2, 3]) { const id = await deliveredOrder(`bill-${i}`); nums.push((await advanceOrder(id, "invoiced", manager)).invoice_number); }
    expect(nums).toEqual(["TLX/26-27/0245", "TLX/26-27/0246", "TLX/26-27/0247"]);
    expect(nums.every((n) => n!.length <= 16)).toBe(true);
  });
  it("making the bill again returns the same bill", async () => {
    const id = await deliveredOrder("bill-again");
    const a = await advanceOrder(id, "invoiced", manager);
    const again = await tx(() => createBillTx(id, manager));
    expect(again).toMatchObject({ invoice_number: a.invoice_number, created: false });
    expect(((await one("SELECT COUNT(*) c FROM invoices WHERE order_id=?", [id])) as { c: number }).c).toBe(1);
  });
  it("restart at 0001 in a new financial year", async () => {
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2027-03-31T18:31:00Z")); // 1 Apr 2027 IST
    const id = await deliveredOrder("bill-fy");
    expect((await advanceOrder(id, "invoiced", manager)).invoice_number).toBe("TLX/27-28/0001");
  });
  it("can't bill an order that isn't delivered", async () => {
    const { order } = await createOrder({ customer: { id: "c-ka" }, items: [{ product_id: "sku-box", qty: 1 }] }, staff, "bill-early");
    await expect((async () => tx(() => createBillTx(order.id, manager)))()).rejects.toThrow(/once an order is delivered/);
  });
});

describe("payments", () => {
  it("tracks part payments, refuses overpayment, and marks paid only at zero balance", async () => {
    const id = await deliveredOrder("pay-1", 1000); // ₹28,000 + 18% = ₹33,040
    await expect((async () => recordPayment(id, { amount: 100 }, manager))()).rejects.toThrow(/Make the bill/);
    await advanceOrder(id, "invoiced", manager);
    await expect((async () => recordPayment(id, { amount: 50 }, staff as never, undefined))()).resolves.not.toThrow(); // permission is enforced at the API layer (tested in security)
    const p1 = await recordPayment(id, { amount: 20000, mode: "bank", reference: "NEFT123" }, manager, "pk-1");
    expect(p1).toMatchObject({ balance: 13040 - 50, state: "invoiced" });
    const again = await recordPayment(id, { amount: 20000, mode: "bank" }, manager, "pk-1");
    expect(again.duplicate).toBe(true);
    await expect((async () => recordPayment(id, { amount: 20000 }, manager))()).rejects.toThrow(/more than the balance/);
    const p2 = await recordPayment(id, { amount: 12990, mode: "upi" }, manager, "pk-2");
    expect(p2).toMatchObject({ balance: 0, state: "paid" });
    await expect((async () => recordPayment(id, { amount: 1 }, manager))()).rejects.toThrow(/already fully paid/);
    await voidPayment(p2.id, "Cheque bounced", owner);
    expect((await one("SELECT state, amount_paid FROM orders WHERE id=?", [id]))).toEqual({ state: "invoiced", amount_paid: 20050 });
  });
  it("rejects future-dated payments", async () => {
    const id = await deliveredOrder("pay-future", 10); await advanceOrder(id, "invoiced", manager);
    await expect((async () => recordPayment(id, { amount: 10, received_on: "2099-01-01" }, manager))()).rejects.toThrow(/future/);
  });
  it("leaves no money inconsistencies", async () => {
    expect(await moneyProblems()).toEqual({ duplicateInvoiceNumbers: [], ordersWithManyInvoices: [], overpaid: [], paidMismatch: [], creditMismatch: [] });
  });
});
