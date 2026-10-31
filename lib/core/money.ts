/* Bills and payments.
   - One bill per order (unique index) and bill numbers never repeat (unique index + counter in the same transaction).
   - Numbers are consecutive within an Indian financial year: PREFIX/YY-YY/NNNN (≤ 16 characters, as GST requires).
   - Payments may be partial; an order is "paid" only when its balance reaches zero. */
import { z } from "zod";
import { getBusinessProfile } from "../db";
import { many, one, exec, tx, scalar } from "../sql";
import { audit } from "../audit";
import type { Actor } from "../authz";
import { badRequest, conflict, notFound } from "../errors";
import { parseRegistration, placeOfSupply, sellerStateCode, isInterState, splitTax, round2 } from "../gst";
import { fyLabel, istToday } from "./time";

export const INVOICE_PREFIX_RE = /^[A-Z0-9]{1,4}$/;

async function nextInvoiceNumber(): Promise<string> {
  const biz = await getBusinessProfile() as { invoice_prefix?: string; invoice_start?: number } | undefined;
  const prefix = INVOICE_PREFIX_RE.test(biz?.invoice_prefix || "") ? biz!.invoice_prefix! : "INV";
  const fy = fyLabel(istToday());
  const exists = (await one("SELECT value FROM counters WHERE name = 'invoice' AND period = ?", [fy]));
  if (!exists) {
    // The configured starting number applies only to the business's very first series in Munshiji.
    const first = !((await one("SELECT 1 FROM counters WHERE name = 'invoice' LIMIT 1")));
    const start = first ? Math.max(1, Math.floor(Number(biz?.invoice_start) || 1)) : 1;
    (await exec("INSERT INTO counters (name, period, value) VALUES ('invoice', ?, ?)", [fy, start - 1]));
  }
  const { value } = (await one("UPDATE counters SET value = value + 1 WHERE name = 'invoice' AND period = ? RETURNING value", [fy])) as { value: number };
  return `${prefix}/${fy}/${String(value).padStart(4, "0")}`;
}

/** Creates the bill for a delivered order. Calling it again returns the same bill. Must run inside the order transaction. */
export async function createBillTx(orderId: string, actor: Actor) {
  await one("SELECT id FROM orders WHERE id = ? FOR UPDATE", [orderId]); // serialise concurrent "make bill" clicks
  const existing = (await one("SELECT id, invoice_number FROM invoices WHERE order_id = ?", [orderId])) as { id: string; invoice_number: string } | undefined;
  if (existing) return { ...existing, created: false };
  const o = (await one("SELECT o.*, c.gstin as customer_gstin FROM orders o JOIN customers c ON c.id = o.customer_id WHERE o.id = ?", [orderId])) as
    { id: string; state: string; customer_id: string; subtotal: number; gst: number; grand_total: number; customer_gstin: string } | undefined;
  if (!o) throw notFound("Order not found.");
  if (o.state !== "delivered") throw conflict(o.state === "cancelled" ? "This order is cancelled." : "Bills are made once an order is delivered.");
  const biz = await getBusinessProfile();
  const reg = parseRegistration(biz?.gst_registration);
  const seller = sellerStateCode(biz);
  const pos = placeOfSupply(seller, o.customer_gstin, (o as { delivery_state?: string }).delivery_state);
  const { cgst, sgst, igst } = splitTax(o.gst, isInterState(seller, pos));
  const id = `inv-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  const number = await nextInvoiceNumber();
  const { needsEinvoice } = await import("./gstdocs");
  const einv = (await needsEinvoice(o.customer_gstin)) ? 1 : 0;
  (await exec(`INSERT INTO invoices (id, order_id, customer_id, invoice_number, subtotal, cgst, sgst, igst, grand_total, doc_type, place_of_supply, einvoice_required) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${einv})`, [id, o.id, o.customer_id, number, o.subtotal, cgst, sgst, igst, o.grand_total, reg === "regular" ? "tax_invoice" : reg === "composition" ? "bill_of_supply" : "invoice", pos || ""]));
  (await exec("UPDATE orders SET invoice_id = ?, state = 'invoiced', version = version + 1, updated_at = now() WHERE id = ?", [id, o.id]));
  await audit(actor, "invoice.create", "order", o.id, { invoice_number: number, total: o.grand_total });
  return { id, invoice_number: number, created: true };
}

/* ── Payments ── */
export const PAYMENT_MODES = ["upi", "cash", "bank", "cheque", "other"] as const;
export const PaymentInput = z.object({
  amount: z.number({ error: "Amount must be a number" }).positive("Amount must be more than 0").max(100_000_000),
  mode: z.enum(PAYMENT_MODES).default("upi"),
  reference: z.string().trim().max(80).default(""),
  received_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose the date the money was received").optional(),
});

export async function balanceOf(orderId: string) {
  const o = (await one("SELECT grand_total, amount_paid, amount_credited FROM orders WHERE id = ?", [orderId])) as { grand_total: number; amount_paid: number; amount_credited: number } | undefined;
  if (!o) throw notFound("Order not found.");
  return round2(o.grand_total - (o.amount_paid || 0) - (o.amount_credited || 0));
}

/** Re-derives what's been paid and the order's state from payments and credit notes. */
export async function syncPaidState(orderId: string) {
  const { paid } = (await one<{ paid: number }>("SELECT COALESCE(SUM(amount), 0) as paid FROM payments WHERE order_id = ? AND voided = 0", [orderId]))!;
  const o = (await one<{ grand_total: number; amount_credited: number; state: string }>("SELECT grand_total, amount_credited, state FROM orders WHERE id = ?", [orderId]))!;
  const due = round2(o.grand_total - o.amount_credited);
  const balance = round2(due - paid);
  const state = due <= 0.005 ? "credited" : balance <= 0.005 ? "paid" : ["paid", "credited"].includes(o.state) ? "invoiced" : o.state;
  await exec("UPDATE orders SET amount_paid = ?, state = ?, version = version + 1, updated_at = now() WHERE id = ?", [round2(paid), state, orderId]);
  return { paid: round2(paid), balance: Math.max(0, balance), state, refund_due: round2(Math.max(0, -balance)) };
}
const syncPaid = syncPaidState;

export async function recordPayment(orderId: string, raw: unknown, actor: Actor, idempotencyKey?: string) {
  const input = PaymentInput.parse(raw);
  return tx(async () => {
    if (idempotencyKey) {
      const dup = (await one("SELECT id FROM payments WHERE idempotency_key = ?", [idempotencyKey])) as { id: string } | undefined;
      if (dup) return { id: dup.id, duplicate: true, ...(await syncPaidRead(orderId)) };
    }
    const o = (await one("SELECT state, invoice_id FROM orders WHERE id = ? FOR UPDATE", [orderId])) as { state: string; invoice_id: string | null } | undefined;
    if (!o) throw notFound("Order not found.");
    if (!o.invoice_id || !["invoiced", "overdue"].includes(o.state)) throw conflict(o.state === "paid" ? "This order is already fully paid." : o.state === "credited" ? "This bill was fully credited; nothing is due." : "Make the bill before recording a payment.");
    const balance = await balanceOf(orderId);
    const amount = round2(input.amount);
    if (amount - balance > 0.005) throw badRequest(`That's more than the balance due (₹${balance.toLocaleString("en-IN")}).`);
    const today = istToday();
    const on = input.received_on || today;
    if (on > today) throw badRequest("The payment date can't be in the future.");
    const id = `pay-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
    (await exec("INSERT INTO payments (id, order_id, amount, mode, reference, received_on, idempotency_key, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", [id, orderId, amount, input.mode, input.reference, on, idempotencyKey ?? null, actor.id]));
    const s = await syncPaid(orderId);
    await audit(actor, "payment.record", "order", orderId, { payment_id: id, amount, mode: input.mode, reference: input.reference, balance: s.balance });
    return { id, duplicate: false, ...s };
  });
}

async function syncPaidRead(orderId: string) {
  const o = (await one("SELECT grand_total, amount_paid, amount_credited, state FROM orders WHERE id = ?", [orderId])) as { grand_total: number; amount_paid: number; amount_credited: number; state: string };
  return { paid: o.amount_paid, balance: round2(o.grand_total - o.amount_paid - o.amount_credited), state: o.state };
}

export async function voidPayment(paymentId: string, reason: string, actor: Actor) {
  if (!reason || reason.trim().length < 3) throw badRequest("Say why this payment is being removed.");
  return tx(async () => {
    const p = (await one("SELECT * FROM payments WHERE id = ?", [paymentId])) as { order_id: string; voided: number; amount: number } | undefined;
    if (!p) throw notFound("Payment not found.");
    if (p.voided) throw conflict("This payment was already removed.");
    (await exec("UPDATE payments SET voided = 1, void_reason = ? WHERE id = ?", [reason.trim(), paymentId]));
    const s = await syncPaid(p.order_id);
    await audit(actor, "payment.void", "order", p.order_id, { payment_id: paymentId, amount: p.amount, reason });
    return s;
  });
}

export async function paymentsFor(orderId: string) {
  return (await many("SELECT id, amount, mode, reference, received_on, voided, void_reason, created_at FROM payments WHERE order_id = ? ORDER BY received_on, created_at", [orderId]));
}

/** Invariants for tests and the health check. */
export async function moneyProblems() {
  return {
    duplicateInvoiceNumbers: (await many("SELECT invoice_number, COUNT(*) c FROM invoices GROUP BY invoice_number HAVING COUNT(*) > 1")),
    ordersWithManyInvoices: (await many("SELECT order_id, COUNT(*) c FROM invoices GROUP BY order_id HAVING COUNT(*) > 1")),
    overpaid: (await many("SELECT id, grand_total, amount_paid FROM orders WHERE amount_paid - grand_total > 0.005")),
    paidMismatch: (await many(`SELECT o.id FROM orders o LEFT JOIN (SELECT order_id, SUM(amount) s FROM payments WHERE voided = 0 GROUP BY order_id) p ON p.order_id = o.id
      WHERE ABS(COALESCE(p.s, 0) - o.amount_paid) > 0.005`)),
    creditMismatch: (await many(`SELECT o.id FROM orders o LEFT JOIN (SELECT order_id, SUM(grand_total) s FROM credit_notes GROUP BY order_id) c ON c.order_id = o.id
      WHERE ABS(COALESCE(c.s, 0) - o.amount_credited) > 0.005`)),
  };
}
