import { many, one, exec, tx, scalar } from "@/lib/sql";
/* Two-week pilot simulation: 50 real-world orders with retries, double taps, edits, cancellations,
   stock shortages, part payments and a bounced cheque. Then every invariant the pilot depends on is checked
   against an independent model kept by the test itself. */
import { describe, it, expect, beforeAll, vi } from "vitest";
import { createOrder, updateOrder, advanceOrder, cancelOrder } from "@/lib/core/orders";
import { createReceipt, ledgerMismatches } from "@/lib/core/inventory";
import { setTransport } from "@/lib/core/gstdocs";
import { recordPayment, voidPayment, moneyProblems, createBillTx } from "@/lib/core/money";
import { AppError } from "@/lib/errors";
import { owner, manager, staff, seedPilotBusiness } from "./helpers";

let seed = 20261026;
const rnd = () => { seed = (seed * 1103515245 + 12345) % 2 ** 31; return seed / 2 ** 31; };
const pick = <T,>(a: T[]) => a[Math.floor(rnd() * a.length)];
const stockOf = async (id: string) => ((await one("SELECT current_stock s FROM products WHERE id=?", [id])) as { s: number }).s;

const SKUS = ["sku-tape", "sku-box", "sku-film", "sku-wrap", "sku-label", "sku-strap"];
const CUSTOMERS = ["c-hfl", "c-ka", "c-fb", "c-qk", "c-da"];
const expected: Record<string, number> = Object.fromEntries(SKUS.map((s) => [s, 0]));
const created = new Map<string, { cancelled: boolean; billed: boolean; total: number }>();
const log: Record<string, number> = { retriesAbsorbed: 0, doubleBillClicks: 0, dispatchBlocked: 0, edits: 0, cancels: 0, partPayments: 0, paymentRetries: 0, voided: 0, receipts: 0, duplicateReceiptBlocked: 0 };

async function receive(day: number, lines: [string, number][], bill: string) {
  const r = await createReceipt({ supplier_name: "Shree Packaging", bill_number: bill, bill_date: `2026-10-${String(day).padStart(2, "0")}`, items: lines.map(([item_id, qty]) => ({ item_id, qty, rate: 10 })) }, manager, `rcpt-${bill}`);
  if (!r.duplicate) { for (const [id, q] of lines) expected[id] += q; log.receipts++; }
}

beforeAll(async () => {
  await seedPilotBusiness();
  const p = (...a: unknown[]) => exec("INSERT INTO products (id, name, unit, price, hsn_code, gst_rate, track_stock, current_stock) VALUES (?, ?, ?, ?, ?, 18, 1, 0) ON CONFLICT DO NOTHING", a);
  await p("sku-wrap", "Bubble Wrap 1m", "roll", 650, "3921"); await p("sku-label", "Fragile Labels", "pack", 120, "4821"); await p("sku-strap", "PP Strap 12mm", "roll", 540, "3920");
  const c = (...a: unknown[]) => exec("INSERT INTO customers (id, name, phone) VALUES (?, ?, ?) ON CONFLICT DO NOTHING", a);
  await c("c-fb", "FreshBite Foods", "9820098765"); await c("c-qk", "QuickKart", "9820056789"); await c("c-da", "Deccan Agro", "9820045678");
});

describe("two-week pilot: 50 orders", () => {
  it("processes 50 orders with real-world mess and keeps every number right", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    await receive(1, SKUS.map((s) => [s, 400] as [string, number]), "SP-001");
    let made = 0;
    for (let day = 1; day <= 14 && made < 50; day++) {
      vi.setSystemTime(new Date(`2026-10-${String(day).padStart(2, "0")}T05:00:00Z`));
      if (day === 6) { await receive(6, [["sku-film", 300], ["sku-wrap", 200]], "SP-014"); await receive(6, [["sku-film", 300], ["sku-wrap", 200]], "SP-014"); } // retried save
      if (day === 9) { try { await createReceipt({ supplier_id: ((await one("SELECT supplier_id s FROM purchase_receipts LIMIT 1")) as { s: string }).s, bill_number: "SP-014", items: [{ item_id: "sku-film", qty: 300, rate: 10 }] }, manager); } catch (e) { if ((e as AppError).status === 409) log.duplicateReceiptBlocked++; else throw e; } }

      const perDay = day === 14 ? 50 - made : Math.min(4, 50 - made);
      for (let n = 0; n < perDay; n++, made++) {
        const actor = pick([staff, staff, manager]);
        const items = Array.from({ length: 1 + Math.floor(rnd() * 3) }, () => ({ product_id: pick(SKUS), qty: 5 + Math.floor(rnd() * 40) }));
        const key = `ord-${day}-${n}`;
        const input = { customer: { id: pick(CUSTOMERS) }, items, notes: `day ${day}`, confirm_duplicate: true };
        const { order } = await createOrder(input, actor, key);
        if (rnd() < 0.25) { const again = await createOrder(input, actor, key); expect(again.order.id).toBe(order.id); log.retriesAbsorbed++; } // network retry / double tap
        created.set(order.id, { cancelled: false, billed: false, total: order.grand_total });

        let o = order;
        if (rnd() < 0.15) { o = await updateOrder(o.id, { version: o.version, items: [...items, { product_id: pick(SKUS), qty: 3 }] }, staff); log.edits++; created.get(o.id)!.total = o.grand_total; }
        if (rnd() < 0.05) { await cancelOrder(o.id, "Buyer cancelled on phone", manager); created.get(o.id)!.cancelled = true; log.cancels++; continue; }

        o = await advanceOrder(o.id, "confirmed", actor);
        o = await advanceOrder(o.id, "preparing", actor);
        if (o.grand_total > 50000) { await setTransport(o.id, { ewb_number: String(341000000000 + made), vehicle_number: "MH12AB1234" }, actor); log.ewb = (log.ewb || 0) + 1; }
        try { o = await advanceOrder(o.id, "dispatched", actor); }
        catch (e) {
          expect((e as AppError).status).toBe(409); log.dispatchBlocked++;
          const short = ((e as AppError).details as { shortages: { product_id: string; qty: number }[] }).shortages;
          await receive(day, short.map((s) => [s.product_id, Math.ceil(s.qty) + 200] as [string, number]), `SP-D${day}-${n}`);
          o = await advanceOrder(o.id, "dispatched", actor);
        }
        for (const l of (await many("SELECT product_id, SUM(qty) q FROM order_items WHERE order_id=? GROUP BY product_id", [o.id])) as { product_id: string; q: number }[]) expected[l.product_id] -= l.q;

        if (rnd() < 0.04) { await cancelOrder(o.id, "Returned at gate, buyer cancelled", owner); created.get(o.id)!.cancelled = true; log.cancels++;
          for (const l of (await many("SELECT product_id, SUM(qty) q FROM order_items WHERE order_id=? GROUP BY product_id", [o.id])) as { product_id: string; q: number }[]) expected[l.product_id] += l.q;
          continue; }

        o = await advanceOrder(o.id, "delivered", actor);
        o = await advanceOrder(o.id, "invoiced", manager); created.get(o.id)!.billed = true;
        if (rnd() < 0.2) { await expect((async () => advanceOrder(o.id, "invoiced", manager))()).rejects.toThrow(); expect((await tx(() => createBillTx(o.id, manager))).created).toBe(false); log.doubleBillClicks++; }

        const r = rnd();
        if (r < 0.55) { await recordPayment(o.id, { amount: o.grand_total, mode: "upi" }, manager, `pay-${o.id}`); if (rnd() < 0.3) { expect((await recordPayment(o.id, { amount: o.grand_total }, manager, `pay-${o.id}`)).duplicate).toBe(true); log.paymentRetries++; } }
        else if (r < 0.8) { const half = Math.round(o.grand_total * 0.4 * 100) / 100; await recordPayment(o.id, { amount: half, mode: "bank", reference: "NEFT" }, manager, `pay1-${o.id}`); log.partPayments++;
          if (rnd() < 0.6) await recordPayment(o.id, { amount: Math.round((o.grand_total - half) * 100) / 100, mode: "cheque" }, manager, `pay2-${o.id}`); }
        // else: unpaid, still within terms
      }
    }
    // A cheque bounces on day 14: remove it and the buyer pays again by UPI.
    const chq = (await one("SELECT id, order_id, amount FROM payments WHERE mode='cheque' AND voided=0 LIMIT 1")) as { id: string; order_id: string; amount: number } | undefined;
    if (chq) { await voidPayment(chq.id, "Cheque bounced", owner); log.voided++; await recordPayment(chq.order_id, { amount: chq.amount, mode: "upi" }, manager, `repay-${chq.id}`); }
    vi.useRealTimers();

    /* ── Invariants ── */
    const orders = (await many("SELECT * FROM orders")) as { id: string; state: string; grand_total: number; subtotal: number; gst: number; amount_paid: number; invoice_id: string | null }[];
    expect(orders).toHaveLength(50);                                   // exactly 50 — no duplicates from retries
    expect(new Set(orders.map((o) => o.id)).size).toBe(50);

    const invoices = (await many("SELECT invoice_number, order_id FROM invoices ORDER BY invoice_number")) as { invoice_number: string; order_id: string }[];
    const billedOrders = [...created].filter(([, v]) => v.billed).map(([id]) => id).sort();
    expect(invoices.map((i) => i.order_id).sort()).toEqual(billedOrders); // one bill per billed order, none for cancelled
    const seq = invoices.map((i) => Number(i.invoice_number.split("/")[2]));
    expect(seq).toEqual(seq.map((_, k) => k + 1));                      // consecutive, no gaps, no repeats
    expect(invoices.every((i) => /^INV\/26-27\/\d{4}$/.test(i.invoice_number))).toBe(true);

    for (const s of SKUS) expect(await stockOf(s)).toBe(expected[s]);         // stock matches the independent model
    for (const s of SKUS) expect(await stockOf(s)).toBeGreaterThanOrEqual(0);
    expect(await ledgerMismatches()).toEqual([]);                             // every balance = sum of its ledger

    expect(await moneyProblems()).toEqual({ duplicateInvoiceNumbers: [], ordersWithManyInvoices: [], overpaid: [], paidMismatch: [], creditMismatch: [] });
    for (const o of orders) {
      const items = (await many("SELECT total, gst_amount FROM order_items WHERE order_id=?", [o.id])) as { total: number; gst_amount: number }[];
      const sub = Math.round(items.reduce((a, i) => a + i.total, 0) * 100) / 100;
      expect(o.subtotal).toBe(sub);                                    // totals re-computed from lines
      expect(o.grand_total).toBe(Math.round((sub + o.gst) * 100) / 100);
      const bal = Math.round((o.grand_total - o.amount_paid) * 100) / 100;
      if (o.state === "paid") expect(bal).toBe(0);
      if (["invoiced", "overdue"].includes(o.state)) expect(bal).toBeGreaterThan(0);
      if (o.state === "cancelled") expect(o.invoice_id).toBeNull();
    }
    const audited = ((await one("SELECT COUNT(DISTINCT entity_id) c FROM audit_log WHERE action='order.create'")) as { c: number }).c;
    expect(audited).toBe(50);

    const summary = { orders: orders.length, billed: invoices.length, paid: orders.filter((o) => o.state === "paid").length, partPaidOpen: orders.filter((o) => o.state === "invoiced" && o.amount_paid > 0).length, cancelled: orders.filter((o) => o.state === "cancelled").length, ...log };
    console.log("PILOT SIMULATION", JSON.stringify(summary));
    expect(log.retriesAbsorbed + log.paymentRetries + log.doubleBillClicks).toBeGreaterThan(5);
  });
});
