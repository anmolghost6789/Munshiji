/* Orders: the only way orders are created, edited, moved forward or cancelled.
   - Prices default to the catalog; only owners/managers may change them (and it's audited).
   - GST rate, HSN and unit always come from the catalog; totals are always worked out here.
   - Saving twice with the same key returns the first order (no duplicates from double taps or retries).
   - Edits use a version number so two people can't overwrite each other.
   - Moving forward is one step at a time; stock leaves at dispatch, the bill is made at "Invoiced". */
import { z } from "zod";
import { getBusinessProfile, getOrderById, getOrderItems } from "../db";
import { many, one, exec, tx, scalar } from "../sql";
import { audit } from "../audit";
import { can, type Actor } from "../authz";
import { badRequest, conflict, forbidden, notFound } from "../errors";
import { applyTax, checkGstin, orderTotals, parseRegistration, round2, GST_STATES } from "../gst";
import { resolveBusiness, nextStateIn } from "../business";
import { deductForOrder, restoreForOrder } from "./inventory";
import { createBillTx } from "./money";
import { requireEwbForDispatch } from "./gstdocs";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
export const LineInput = z.object({
  product_id: z.string({ error: "Choose a product for every line" }).min(1, "Choose a product for every line"),
  qty: z.number({ error: "Quantity must be a number" }).positive("Quantity must be more than 0").max(10_000_000, "Quantity is too large"),
  price: z.number({ error: "Rate must be a number" }).positive("Rate must be more than 0").max(100_000_000).optional(),
});
export const CustomerInput = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(2, "Buyer name is too short").max(120).optional(),
  phone: z.string().trim().max(20).optional(),
  gstin: z.string().trim().max(15).optional(),
  address: z.string().trim().max(300).optional(),
}).refine((v) => v.id || v.name, { message: "Choose a buyer or type a new buyer's name" });
export const OrderInput = z.object({
  customer: CustomerInput,
  items: z.array(LineInput).min(1, "Add at least one item").max(50, "An order can have at most 50 lines"),
  delivery_date: z.union([z.string().regex(DATE, "Delivery date must be a date"), z.literal("")]).optional(),
  delivery_state: z.string().regex(/^(\d{2})?$/, "Choose the delivery state").refine((s) => !s || !!GST_STATES[s], "Choose the delivery state").optional(),
  notes: z.string().max(1000).default(""),
  raw_message: z.string().max(5000).default(""),
  inbound_id: z.string().optional(),
  confirm_duplicate: z.boolean().optional(),
});
export const OrderEdit = z.object({
  version: z.number().int(),
  customer: CustomerInput.optional(),
  items: z.array(LineInput).min(1, "Add at least one item").max(50).optional(),
  delivery_date: z.union([z.string().regex(DATE), z.literal("")]).optional(),
  delivery_state: z.string().regex(/^(\d{2})?$/).refine((s) => !s || !!GST_STATES[s], "Choose the delivery state").optional(),
  notes: z.string().max(1000).optional(),
});

const normPhone = (p?: string) => { let d = (p || "").replace(/\D/g, ""); if (d.length === 12 && d.startsWith("91")) d = d.slice(2); if (d.length === 11 && d.startsWith("0")) d = d.slice(1); return d; };

async function resolveCustomer(c: z.infer<typeof CustomerInput>, actor: Actor): Promise<string> {
  if (c.id) {
    if (!(await one("SELECT 1 FROM customers WHERE id = ?", [c.id]))) throw notFound("That buyer no longer exists. Choose another.");
    return c.id;
  }
  const gstin = (c.gstin || "").toUpperCase();
  if (gstin) { const chk = checkGstin(gstin); if (!chk.valid) throw badRequest(`Buyer GSTIN: ${chk.error}.`); }
  const phone = normPhone(c.phone);
  // Reuse an existing buyer with the same GSTIN or phone instead of creating a duplicate.
  const same = (gstin && (await one("SELECT id FROM customers WHERE UPPER(gstin) = ?", [gstin])))
    || (phone.length === 10 && (await one("SELECT id FROM customers WHERE phone = ?", [phone])))
    || (await one("SELECT id FROM customers WHERE LOWER(TRIM(name)) = LOWER(?)", [(c.name || "").trim()]));
  if (same) return (same as { id: string }).id;
  const id = `c-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  (await exec("INSERT INTO customers (id, name, phone, address, gstin) VALUES (?, ?, ?, ?, ?)", [id, c.name, phone, c.address || "", gstin]));
  await audit(actor, "customer.create", "customer", id, { name: c.name });
  return id;
}

async function buildLines(items: z.infer<typeof LineInput>[], actor: Actor, previous?: Map<string, number>) {
  const reg = parseRegistration((await getBusinessProfile())?.gst_registration);
  const overrides: { product: string; catalog: number; price: number }[] = [];
  const lines = [];
  for (const l of items) {
    const p = (await one("SELECT id, name, unit, price, hsn_code, gst_rate, active FROM products WHERE id = ?", [l.product_id])) as
      { id: string; name: string; unit: string; price: number; hsn_code: string; gst_rate: number; active: number } | undefined;
    if (!p || !p.active) throw badRequest(`A product in this order isn't in your catalog. Choose it from the list or add it to the catalog first.`, { product_id: l.product_id });
    const price = round2(l.price ?? p.price);
    if (!(price > 0)) throw badRequest(`${p.name} has no rate. Set its rate in the catalog or enter one.`);
    if (Math.abs(price - p.price) > 0.005 && previous?.get(p.id) !== price) {
      if (!can(actor.role, "orders.price_override")) throw forbidden(`Only an owner or manager can change the rate of ${p.name} (catalog rate ₹${p.price}).`);
      overrides.push({ product: p.name, catalog: p.price, price });
    }
    lines.push({ product_id: p.id, product_name: p.name, qty: round2(l.qty), unit: p.unit, price, total: round2(l.qty * price), hsn_code: p.hsn_code, gst_rate: p.gst_rate, gst_amount: 0 });
  }
  const taxed = applyTax(lines, reg);
  return { lines: taxed, totals: orderTotals(taxed), overrides };
}

async function nextOrderId(): Promise<string> {
  (await exec("INSERT INTO counters (name, period, value) VALUES ('order', 'all', (SELECT COUNT(*) FROM orders)) ON CONFLICT DO NOTHING"));
  for (;;) {
    const { value } = (await one("UPDATE counters SET value = value + 1 WHERE name = 'order' AND period = 'all' RETURNING value")) as { value: number };
    const id = `ORD-${1000 + value}`;
    if (!(await one("SELECT 1 FROM orders WHERE id = ?", [id]))) return id;
  }
}

async function insertLines(orderId: string, lines: Awaited<ReturnType<typeof buildLines>>["lines"]) {
  for (const l of lines) await exec("INSERT INTO order_items (order_id, product_id, product_name, qty, unit, price, total, hsn_code, gst_rate, gst_amount) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [orderId, l.product_id, l.product_name, l.qty, l.unit, l.price, l.total, l.hsn_code, l.gst_rate, l.gst_amount]);
}

export async function fullOrder(id: string) {
  const o = await getOrderById(id);
  if (!o) throw notFound("Order not found.");
  return { ...o, items: await getOrderItems(id) };
}

export async function createOrder(raw: unknown, actor: Actor, idempotencyKey?: string) {
  const input = OrderInput.parse(raw);
  return tx(async () => {
    if (idempotencyKey) {
      const dup = (await one("SELECT id FROM orders WHERE idempotency_key = ?", [idempotencyKey])) as { id: string } | undefined;
      if (dup) return { order: await fullOrder(dup.id), duplicate: true };
    }
    let inbound: { id: string; status: string; order_id: string; external_id: string } | undefined;
    if (input.inbound_id) {
      inbound = (await one("SELECT id, status, order_id, external_id FROM inbound_messages WHERE id = ?", [input.inbound_id])) as typeof inbound;
      if (!inbound) throw notFound("That WhatsApp message wasn't found.");
      if (inbound.order_id) return { order: await fullOrder(inbound.order_id), duplicate: true };
      if (inbound.status === "dismissed") throw conflict("That WhatsApp message was dismissed.");
    }
    const customerId = await resolveCustomer(input.customer, actor);
    const { lines, totals, overrides } = await buildLines(input.items, actor);
    if (!input.confirm_duplicate && !inbound) {
      const near = (await one(`SELECT id FROM orders WHERE customer_id = ? AND ABS(grand_total - ?) < 0.01 AND state <> 'cancelled' AND created_at >= now() - interval '10 minutes' LIMIT 1`, [customerId, totals.grand_total])) as { id: string } | undefined;
      if (near) throw conflict(`An order for the same buyer and amount was saved a few minutes ago (${near.id}). Save again only if this is a separate order.`, { possible_duplicate: near.id });
    }
    const id = await nextOrderId();
    (await exec(`INSERT INTO orders (id, customer_id, state, subtotal, gst, grand_total, delivery_date, delivery_state, notes, raw_message, idempotency_key, source, created_by)
      VALUES (?, ?, 'new', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [id, customerId, totals.subtotal, totals.gst, totals.grand_total, input.delivery_date || "", input.delivery_state || "", input.notes, input.raw_message, idempotencyKey ?? null, inbound ? "whatsapp" : "manual", actor.id]));
    if (input.delivery_state) await exec("UPDATE customers SET state_code = ? WHERE id = ?", [input.delivery_state, customerId]);
    await insertLines(id, lines);
    if (inbound) (await exec("UPDATE inbound_messages SET status = 'approved', order_id = ?, updated_at = now() WHERE id = ?", [id, inbound.id]));
    await audit(actor, "order.create", "order", id, { total: totals.grand_total, lines: lines.length, source: inbound ? "whatsapp" : "manual", price_overrides: overrides.length ? overrides : undefined });
    return { order: await fullOrder(id), duplicate: false };
  });
}

const EDITABLE = ["new", "confirmed", "preparing"];

export async function updateOrder(id: string, raw: unknown, actor: Actor) {
  const input = OrderEdit.parse(raw);
  return tx(async () => {
    const o = (await one("SELECT * FROM orders WHERE id = ? FOR UPDATE", [id])) as { state: string; version: number; stock_deducted: number; invoice_id: string | null; customer_id: string; delivery_date: string; notes: string } | undefined;
    if (!o) throw notFound("Order not found.");
    if (!EDITABLE.includes(o.state) || o.stock_deducted || o.invoice_id) throw conflict("This order can't be edited any more: it has been dispatched or billed.");
    if (o.version !== input.version) throw conflict("Someone else changed this order a moment ago. Close it and open it again to see the latest.", { version: o.version });
    const changes: Record<string, unknown> = {};
    let customerId = o.customer_id;
    if (input.customer) { customerId = await resolveCustomer(input.customer, actor); if (customerId !== o.customer_id) changes.customer = customerId; }
    if (input.items) {
      const prev = new Map((await getOrderItems(id) as { product_id: string; price: number }[]).map((l) => [l.product_id, l.price]));
      const { lines, totals, overrides } = await buildLines(input.items, actor, prev);
      (await exec("DELETE FROM order_items WHERE order_id = ?", [id]));
      await insertLines(id, lines);
      (await exec("UPDATE orders SET subtotal = ?, gst = ?, grand_total = ? WHERE id = ?", [totals.subtotal, totals.gst, totals.grand_total, id]));
      changes.items = lines.map((l) => `${l.qty} × ${l.product_name} @ ${l.price}`);
      changes.total = totals.grand_total;
      if (overrides.length) changes.price_overrides = overrides;
    }
    if (input.delivery_date !== undefined && input.delivery_date !== o.delivery_date) changes.delivery_date = input.delivery_date;
    if (input.notes !== undefined && input.notes !== o.notes) changes.notes = input.notes;
    if (input.delivery_state !== undefined) { await exec("UPDATE orders SET delivery_state = ? WHERE id = ?", [input.delivery_state, id]); changes.delivery_state = input.delivery_state; }
    (await exec(`UPDATE orders SET customer_id = ?, delivery_date = ?, notes = ?, version = version + 1, updated_at = now() WHERE id = ?`, [customerId, input.delivery_date ?? o.delivery_date, input.notes ?? o.notes, id]));
    await audit(actor, "order.edit", "order", id, changes);
    return await fullOrder(id);
  });
}

export async function advanceOrder(id: string, to: string, actor: Actor, expectedVersion?: number) {
  return tx(async () => {
    const o = (await one("SELECT state, version FROM orders WHERE id = ? FOR UPDATE", [id])) as { state: string; version: number } | undefined;
    if (!o) throw notFound("Order not found.");
    if (expectedVersion !== undefined && expectedVersion !== o.version) throw conflict("This order was updated a moment ago. Close it and open it again.");
    if (o.state === "cancelled") throw conflict("This order is cancelled.");
    const biz = resolveBusiness(await getBusinessProfile());
    const next = nextStateIn(biz.flow, o.state);
    if (to === "paid") throw conflict("Record the payment to mark this order paid.");
    if (to === "credited") throw conflict("An order is credited only by issuing credit notes for it.");
    if (!next || next !== to) throw conflict(next ? `This order's next step is "${next}".` : "This order has no next step.");
    if (to === "invoiced") {
      if (!can(actor.role, "invoices.create")) throw forbidden("Only an owner or manager can make bills.");
      await createBillTx(id, actor);
      return await fullOrder(id);
    }
    const stockPoint = biz.flow.includes("dispatched") ? "dispatched" : "delivered";
    if (to === stockPoint) { await requireEwbForDispatch(id); await deductForOrder(id, actor); }
    (await exec("UPDATE orders SET state = ?, version = version + 1, updated_at = now() WHERE id = ?", [to, id]));
    await audit(actor, "order.advance", "order", id, { from: o.state, to });
    return await fullOrder(id);
  });
}

export async function cancelOrder(id: string, reason: string, actor: Actor) {
  if (!reason || reason.trim().length < 3) throw badRequest("Say why the order is being cancelled.");
  return tx(async () => {
    const o = (await one("SELECT state, invoice_id, stock_deducted FROM orders WHERE id = ? FOR UPDATE", [id])) as { state: string; invoice_id: string | null; stock_deducted: number } | undefined;
    if (!o) throw notFound("Order not found.");
    if (o.state === "cancelled") throw conflict("This order is already cancelled.");
    if (o.invoice_id) {
      const inv = (await one("SELECT invoice_number FROM invoices WHERE id = ?", [o.invoice_id])) as { invoice_number: string };
      throw conflict(`This order has bill ${inv.invoice_number}. A billed order can't be cancelled in Munshiji; issue a credit note with your CA.`);
    }
    if (o.stock_deducted) await restoreForOrder(id, actor);
    (await exec("UPDATE orders SET state = 'cancelled', cancel_reason = ?, version = version + 1, updated_at = now() WHERE id = ?", [reason.trim(), id]));
    await audit(actor, "order.cancel", "order", id, { from: o.state, reason, stock_restored: !!o.stock_deducted });
    return await fullOrder(id);
  });
}
