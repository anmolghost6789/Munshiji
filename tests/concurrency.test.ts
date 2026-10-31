/* Postgres runs writes truly in parallel (many pods / serverless instances). These tests fire simultaneous
   requests at the same rows and check the guarantees still hold. */
import { describe, it, expect, beforeAll } from "vitest";
import { many, one, exec } from "@/lib/sql";
import { createOrder, advanceOrder } from "@/lib/core/orders";
import { createReceipt, ledgerMismatches } from "@/lib/core/inventory";
import { recordPayment, moneyProblems } from "@/lib/core/money";
import { owner, manager, staff, seedPilotBusiness } from "./helpers";

process.env.PG_POOL_MAX = "20";
const settle = <T,>(ps: Promise<T>[]) => Promise.allSettled(ps);
async function toPreparing(product: string, qty: number, key: string) {
  const { order } = await createOrder({ customer: { id: "c-ka" }, items: [{ product_id: product, qty }], confirm_duplicate: true }, staff, key);
  await advanceOrder(order.id, "confirmed", staff); await advanceOrder(order.id, "preparing", staff);
  return order.id;
}
async function delivered(key: string) {
  const id = await toPreparing("sku-box", 1, key);
  await advanceOrder(id, "dispatched", staff); await advanceOrder(id, "delivered", staff);
  return id;
}

beforeAll(async () => {
  await seedPilotBusiness();
  await createReceipt({ supplier_name: "Shree", bill_number: "C1", items: [{ item_id: "sku-film", qty: 30, rate: 1 }, { item_id: "sku-box", qty: 100000, rate: 1 }] }, owner);
});

describe("simultaneous requests", () => {
  it("two dispatches racing for 30 rolls: one wins, stock never goes negative", async () => {
    const a = await toPreparing("sku-film", 20, "race-a"), b = await toPreparing("sku-film", 20, "race-b");
    const r = await settle([advanceOrder(a, "dispatched", staff), advanceOrder(b, "dispatched", staff)]);
    expect(r.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    expect(String((r.find((x) => x.status === "rejected") as PromiseRejectedResult).reason.message)).toMatch(/Not enough stock/);
    expect((await one<{ s: number }>("SELECT current_stock s FROM products WHERE id='sku-film'"))!.s).toBe(10);
    expect(await ledgerMismatches()).toEqual([]);
  });
  it("ten simultaneous 'Make bill' clicks on one order make one bill", async () => {
    const id = await delivered("ten-clicks");
    const r = await settle(Array.from({ length: 10 }, () => advanceOrder(id, "invoiced", manager)));
    expect(r.filter((x) => x.status === "fulfilled").length).toBeGreaterThanOrEqual(1);
    expect((await one<{ c: number }>("SELECT COUNT(*) c FROM invoices WHERE order_id = ?", [id]))!.c).toBe(1);
  });
  it("twenty simultaneous saves with the same key create one order", async () => {
    const input = { customer: { id: "c-hfl" }, items: [{ product_id: "sku-tape", qty: 3 }] };
    const r = await settle(Array.from({ length: 20 }, () => createOrder(input, staff, "same-key-x20")));
    const ok = r.filter((x) => x.status === "fulfilled") as PromiseFulfilledResult<{ order: { id: string } }>[];
    expect(ok.length).toBe(20);
    expect(new Set(ok.map((x) => x.value.order.id)).size).toBe(1);
    expect((await one<{ c: number }>("SELECT COUNT(*) c FROM orders WHERE idempotency_key = 'same-key-x20'"))!.c).toBe(1);
  });
  it("thirty orders billed at the same moment get consecutive, unique numbers", async () => {
    const before = (await one<{ c: number }>("SELECT COUNT(*) c FROM invoices"))!.c;
    const ids: string[] = [];
    for (let i = 0; i < 30; i++) ids.push(await delivered(`burst-${i}`));
    await Promise.all(ids.map((id) => advanceOrder(id, "invoiced", manager)));
    const nums = (await many<{ n: string }>("SELECT invoice_number n FROM invoices")).map((r) => Number(r.n.split("/")[2])).sort((x, y) => x - y);
    expect(nums).toHaveLength(before + 30);
    expect(nums).toEqual(nums.map((_, k) => k + 1));
  });
  it("simultaneous payments can't together exceed the balance", async () => {
    const id = await delivered("pay-race");
    const o = await advanceOrder(id, "invoiced", manager); // ₹33.04
    const r = await settle(Array.from({ length: 5 }, (_, k) => recordPayment(id, { amount: 20 }, manager, `pr-${k}`)));
    expect(r.filter((x) => x.status === "fulfilled")).toHaveLength(1); // 20 fits, a second 20 would exceed 33.04
    const row = (await one<{ amount_paid: number }>("SELECT amount_paid FROM orders WHERE id = ?", [id]))!;
    expect(row.amount_paid).toBe(20);
    expect(row.amount_paid).toBeLessThanOrEqual(o.grand_total);
    expect(await moneyProblems()).toEqual({ duplicateInvoiceNumbers: [], ordersWithManyInvoices: [], overpaid: [], paidMismatch: [], creditMismatch: [] });
  });
});
