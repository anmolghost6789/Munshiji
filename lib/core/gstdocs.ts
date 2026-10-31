/* GST documents beyond the bill itself.
   - Credit notes (CGST Act s.34): linked to the original bill; never more than was billed, line by line;
     same tax split as the bill; own consecutive series per financial year; allowed until 30 November after the
     end of the bill's financial year (or the annual-return date, if earlier: the owner must watch that one).
   - E-invoicing: when the business's turnover crossed ₹5 crore in any year since 2017-18, bills (and credit notes)
     to registered buyers need an IRN from the Invoice Registration Portal before they're valid. Munshiji records it.
   - E-way bill: above the threshold (₹50,000 incl. GST by default), dispatch needs the e-way bill number and vehicle,
     or a stated exemption. Munshiji records them; generating the e-way bill happens on the portal or through a GSP. */
import crypto from "crypto";
import { z } from "zod";
import { one, many, exec, tx } from "../sql";
import { audit } from "../audit";
import type { Actor } from "../authz";
import { badRequest, conflict, notFound } from "../errors";
import { round2, splitTax, checkGstin, isInterState, placeOfSupply, sellerStateCode } from "../gst";
import { getBusinessProfile } from "../db";
import { moveStock } from "./inventory";
import { fyLabel, istToday, istDateFromSql } from "./time";

/* ── Deadlines ── */
/** Last date to issue a GST credit note for a bill dated `billDate` (IST, YYYY-MM-DD): 30 Nov after that FY ends. */
export function creditNoteDeadline(billDate: string): string {
  const [y, m] = billDate.split("-").map(Number);
  const fyEnd = m >= 4 ? y + 1 : y; // FY ends 31 March of fyEnd
  return `${fyEnd}-11-30`;
}

/* ── Credit notes ── */
export const CREDIT_REASONS = { goods_returned: "Goods returned", price_reduction: "Price reduced after the sale", discount: "Discount after the sale", excess_tax: "Tax charged too high", deficiency: "Goods short or defective", other: "Other" } as const;
export const CreditInput = z.object({
  reason: z.enum(Object.keys(CREDIT_REASONS) as [keyof typeof CREDIT_REASONS]),
  reason_note: z.string().trim().max(300).default(""),
  restock: z.boolean().default(false),
  lines: z.array(z.object({
    product_id: z.string().min(1),
    qty: z.number().positive("Quantity must be more than 0").max(10_000_000).optional(),        // returned / short quantity
    amount: z.number().positive("Amount must be more than 0").max(100_000_000).optional(),     // taxable value reduced
  }).refine((l) => (l.qty === undefined) !== (l.amount === undefined), { message: "Give either a quantity or an amount for each line" })).min(1, "Choose at least one item").max(50),
});

async function nextCreditNoteNumber(): Promise<string> {
  const biz = await getBusinessProfile() as { credit_note_prefix?: string } | null;
  const prefix = /^[A-Z0-9]{1,4}$/.test(biz?.credit_note_prefix || "") ? biz!.credit_note_prefix! : "CN";
  const fy = fyLabel(istToday());
  await exec("INSERT INTO counters (name, period, value) VALUES ('credit_note', ?, 0) ON CONFLICT DO NOTHING", [fy]);
  const { value } = (await one<{ value: number }>("UPDATE counters SET value = value + 1 WHERE name = 'credit_note' AND period = ? RETURNING value", [fy]))!;
  return `${prefix}/${fy}/${String(value).padStart(4, "0")}`;
}

export async function createCreditNote(orderId: string, raw: unknown, actor: Actor, idempotencyKey?: string) {
  const input = CreditInput.parse(raw);
  return tx(async () => {
    if (idempotencyKey) {
      const dup = await one<{ id: string; number: string }>("SELECT id, number FROM credit_notes WHERE idempotency_key = ?", [idempotencyKey]);
      if (dup) return { ...dup, duplicate: true };
    }
    const o = await one<{ id: string; state: string; invoice_id: string | null; grand_total: number; amount_paid: number; amount_credited: number; stock_deducted: number }>(
      "SELECT id, state, invoice_id, grand_total, amount_paid, amount_credited, stock_deducted FROM orders WHERE id = ? FOR UPDATE", [orderId]);
    if (!o) throw notFound("Order not found.");
    if (!o.invoice_id) throw conflict("A credit note needs a bill. This order hasn't been billed; edit or cancel it instead.");
    const inv = (await one<{ id: string; invoice_number: string; created_at: string; igst: number; doc_type: string; place_of_supply: string; einvoice_required: number; irn: string }>(
      "SELECT id, invoice_number, created_at, igst, doc_type, place_of_supply, einvoice_required, irn FROM invoices WHERE id = ?", [o.invoice_id]))!;
    const billDate = istDateFromSql(inv.created_at);
    const deadline = creditNoteDeadline(billDate);
    if (istToday() > deadline) throw conflict(`The GST deadline for credit notes on bill ${inv.invoice_number} was ${deadline}. Settle this with a commercial credit note outside GST; ask your CA.`);
    if (inv.einvoice_required && !inv.irn) throw conflict(`Bill ${inv.invoice_number} needs its IRN recorded before it can be credited.`);

    // What was billed, and what has already been credited, per product.
    const billed = await many<{ product_id: string; product_name: string; unit: string; qty: number; total: number; hsn_code: string; gst_rate: number; gst_amount: number }>(
      `SELECT product_id, MIN(product_name) product_name, MIN(unit) unit, SUM(qty) qty, SUM(total) total, MIN(hsn_code) hsn_code, MAX(gst_rate) gst_rate, SUM(gst_amount) gst_amount
       FROM order_items WHERE order_id = ? GROUP BY product_id`, [orderId]);
    const credited = new Map((await many<{ product_id: string; qty: number; total: number }>(
      `SELECT ci.product_id, SUM(ci.qty) qty, SUM(ci.total) total FROM credit_note_items ci JOIN credit_notes cn ON cn.id = ci.credit_note_id WHERE cn.order_id = ? GROUP BY ci.product_id`, [orderId])).map((r) => [r.product_id, r]));
    const inter = Number(inv.igst) > 0;
    const lines: { product_id: string; product_name: string; unit: string; qty: number; price: number; total: number; hsn_code: string; gst_rate: number; gst_amount: number }[] = [];
    for (const l of input.lines) {
      const b = billed.find((x) => x.product_id === l.product_id);
      if (!b) throw badRequest("A line isn't on this bill.");
      const c = credited.get(l.product_id) || { qty: 0, total: 0 };
      const price = round2(b.total / b.qty);
      let qty = 0, total: number;
      if (l.qty !== undefined) {
        if (!["goods_returned", "deficiency"].includes(input.reason)) throw badRequest("Quantities are for returned or short goods. For a price change or discount, give an amount.");
        if (l.qty - (b.qty - c.qty) > 1e-9) throw badRequest(`${b.product_name}: only ${round2(b.qty - c.qty)} ${b.unit} can still be credited.`);
        qty = round2(l.qty);
        total = round2(qty * price);
      } else total = round2(l.amount!);
      if (total - (b.total - c.total) > 0.005) throw badRequest(`${b.product_name}: at most ₹${round2(b.total - c.total).toLocaleString("en-IN")} of its value can still be credited.`);
      const taxed = Number(b.gst_amount) > 0; // composition / unregistered bills carry no tax
      lines.push({ product_id: b.product_id, product_name: b.product_name, unit: b.unit, qty, price, total, hsn_code: b.hsn_code, gst_rate: taxed ? Number(b.gst_rate) : 0, gst_amount: taxed ? round2((total * Number(b.gst_rate)) / 100) : 0 });
    }
    const subtotal = round2(lines.reduce((s, l) => s + l.total, 0));
    const gst = round2(lines.reduce((s, l) => s + l.gst_amount, 0));
    const { cgst, sgst, igst } = splitTax(gst, inter);
    const grand = round2(subtotal + gst);
    if (grand - (o.grand_total - o.amount_credited) > 0.005) throw badRequest("That's more than is left to credit on this bill.");

    const id = `cn-${crypto.randomBytes(8).toString("hex")}`;
    const number = await nextCreditNoteNumber();
    await exec(`INSERT INTO credit_notes (id, order_id, invoice_id, number, reason, reason_note, doc_type, place_of_supply, subtotal, cgst, sgst, igst, grand_total, restocked, einvoice_required, idempotency_key, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, orderId, inv.id, number, input.reason, input.reason_note, inv.doc_type === "tax_invoice" ? "credit_note" : "credit_note_no_tax", inv.place_of_supply, subtotal, cgst, sgst, igst, grand,
       input.restock ? 1 : 0, inv.einvoice_required, idempotencyKey ?? null, actor.id]);
    for (const l of lines) await exec("INSERT INTO credit_note_items (credit_note_id, product_id, product_name, qty, unit, price, total, hsn_code, gst_rate, gst_amount) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [id, l.product_id, l.product_name, l.qty, l.unit, l.price, l.total, l.hsn_code, l.gst_rate, l.gst_amount]);
    if (input.restock) {
      if (input.reason !== "goods_returned") throw badRequest("Only returned goods go back into stock.");
      if (o.stock_deducted) for (const l of lines) {
        const p = await one<{ track_stock: number }>("SELECT track_stock FROM products WHERE id = ?", [l.product_id]);
        if (p?.track_stock && l.qty > 0) await moveStock("product", l.product_id, l.qty, "credit_note", id, actor, `Returned · ${number}`);
      }
    }
    await exec("UPDATE orders SET amount_credited = amount_credited + ?, version = version + 1, updated_at = now() WHERE id = ?", [grand, orderId]);
    const { syncPaidState } = await import("./money");
    await syncPaidState(orderId);
    await audit(actor, "credit_note.create", "order", orderId, { number, reason: input.reason, total: grand, restocked: input.restock });
    return { id, number, grand_total: grand, duplicate: false, refund_due: round2(Math.max(0, o.amount_paid - (o.grand_total - o.amount_credited - grand))) };
  });
}

export async function creditNotesFor(orderId: string) {
  const notes = await many<Record<string, unknown> & { id: string }>("SELECT * FROM credit_notes WHERE order_id = ? ORDER BY created_at", [orderId]);
  const out = [];
  for (const n of notes) out.push({ ...n, items: await many("SELECT product_name, qty, unit, price, total, hsn_code, gst_rate, gst_amount FROM credit_note_items WHERE credit_note_id = ?", [n.id]) });
  return out;
}

/* ── E-invoicing: recording the IRN from the IRP ── */
export const IrnInput = z.object({
  irn: z.string().trim().toLowerCase().regex(/^[0-9a-f]{64}$/, "The IRN is 64 letters and numbers (0–9, a–f), exactly as the IRP shows it."),
  ack_no: z.string().trim().regex(/^\d{10,20}$/, "The acknowledgement number is the long number the IRP shows (digits only)."),
  ack_date: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2})?)?$/, "Enter the acknowledgement date."),
  signed_qr: z.string().trim().min(20, "Paste the signed QR code text from the IRP.").max(4000),
});
export async function recordIrn(kind: "invoice" | "credit_note", id: string, raw: unknown, actor: Actor) {
  const v = IrnInput.parse(raw);
  const table = kind === "invoice" ? "invoices" : "credit_notes";
  return tx(async () => {
    const doc = await one<{ irn: string; einvoice_required: number }>(`SELECT irn, einvoice_required FROM ${table} WHERE id = ? FOR UPDATE`, [id]);
    if (!doc) throw notFound(kind === "invoice" ? "Bill not found." : "Credit note not found.");
    if (doc.irn) throw conflict("An IRN is already recorded. If it's wrong, cancel the e-invoice on the IRP (within 24 hours) and ask your CA how to correct it.");
    await exec(`UPDATE ${table} SET irn = ?, ack_no = ?, ack_date = ?, signed_qr = ? WHERE id = ?`, [v.irn, v.ack_no, v.ack_date, v.signed_qr, id]);
    await audit(actor, `${kind}.irn`, kind, id, { irn: v.irn, ack_no: v.ack_no });
    return { ok: true };
  });
}
/** Bills issued under e-invoicing that still have no IRN (shown on the GST page and bill). */
export async function pendingIrns() {
  return many<{ id: string; invoice_number: string; created_at: string; customer_name: string; grand_total: number }>(
    `SELECT i.id, i.invoice_number, i.created_at, c.name customer_name, i.grand_total FROM invoices i JOIN customers c ON c.id = i.customer_id
     WHERE i.einvoice_required = 1 AND i.irn = '' ORDER BY i.created_at`);
}
/** Whether a new bill to this buyer needs an IRN. */
export async function needsEinvoice(customerGstin: string | null | undefined) {
  const biz = await getBusinessProfile() as { einvoice_applicable?: number; gst_registration?: string } | null;
  return !!biz?.einvoice_applicable && biz.gst_registration === "regular" && !!customerGstin && checkGstin(customerGstin).valid;
}

/* ── E-way bill ── */
const EWB_EXEMPTIONS = ["Value below the limit in this state", "Exempt goods", "Non-motorised transport", "Under 50 km to the transporter (Part B not needed)", "Other (see notes)"] as const;
export const TransportInput = z.object({
  ewb_number: z.string().trim().transform((s) => s.replace(/\s/g, "")).refine((s) => s === "" || /^\d{12}$/.test(s), "An e-way bill number has 12 digits.").optional(),
  vehicle_number: z.string().trim().toUpperCase().transform((s) => s.replace(/[\s-]/g, "")).refine((s) => s === "" || /^[A-Z]{2}\d{1,2}[A-Z]{0,3}\d{4}$|^\d{2}BH\d{4}[A-Z]{1,2}$/.test(s), "Enter the vehicle number like MH12AB1234.").optional(),
  transporter_name: z.string().trim().max(120).optional(),
  transporter_id: z.string().trim().toUpperCase().max(15).optional(),
  distance_km: z.number().int().min(0).max(4000).optional(),
  ewb_exempt_reason: z.enum(["", ...EWB_EXEMPTIONS]).optional(),
});
export const EWB_EXEMPTION_OPTIONS = EWB_EXEMPTIONS;
export async function setTransport(orderId: string, raw: unknown, actor: Actor) {
  const v = TransportInput.parse(raw);
  return tx(async () => {
    const o = await one<{ state: string }>("SELECT state FROM orders WHERE id = ? FOR UPDATE", [orderId]);
    if (!o) throw notFound("Order not found.");
    const sets: string[] = [], vals: unknown[] = [];
    for (const [k, val] of Object.entries(v)) if (val !== undefined) { sets.push(`${k} = ?`); vals.push(val); }
    if (v.ewb_number) { sets.push("ewb_date = COALESCE(ewb_date, now())"); }
    if (!sets.length) return { ok: true };
    await exec(`UPDATE orders SET ${sets.join(", ")}, version = version + 1, updated_at = now() WHERE id = ?`, [...vals, orderId]);
    await audit(actor, "order.transport", "order", orderId, v);
    return { ok: true };
  });
}
/** The e-way bill limit that applies to this order: ₹50,000 if it crosses a state border, else the state's own limit. */
export async function ewbLimitFor(orderId: string): Promise<number> {
  const biz = await getBusinessProfile() as { ewb_threshold?: number; gstin?: string; state?: string } | null;
  const o = await one<{ delivery_state: string; customer_gstin: string }>("SELECT o.delivery_state, c.gstin AS customer_gstin FROM orders o JOIN customers c ON c.id = o.customer_id WHERE o.id = ?", [orderId]);
  const t = Number(biz?.ewb_threshold ?? 50000);
  if (!o) return t;
  const seller = sellerStateCode(biz);
  return isInterState(seller, placeOfSupply(seller, o.customer_gstin, o.delivery_state)) ? Math.min(50000, t) : t;
}
/** Called before stock leaves: above the threshold, an e-way bill (with vehicle or transporter) or an exemption is required. */
export async function requireEwbForDispatch(orderId: string) {
  const biz = await getBusinessProfile() as { gst_registration?: string; ewb_threshold?: number; gstin?: string; state?: string } | null;
  if (!biz || biz.gst_registration === "none") return;
  const o = (await one<{ grand_total: number; ewb_number: string; vehicle_number: string; transporter_id: string; ewb_exempt_reason: string; delivery_state: string; customer_gstin: string }>(
    `SELECT o.grand_total, o.ewb_number, o.vehicle_number, o.transporter_id, o.ewb_exempt_reason, o.delivery_state, c.gstin AS customer_gstin
     FROM orders o JOIN customers c ON c.id = o.customer_id WHERE o.id = ?`, [orderId]))!;
  // Inter-state movement: ₹50,000 everywhere. Within the state: the state's own limit (e.g. ₹1,00,000 in Maharashtra), set in Settings.
  const seller = sellerStateCode(biz);
  const inter = isInterState(seller, placeOfSupply(seller, o.customer_gstin, o.delivery_state));
  const limit = inter ? Math.min(50000, Number(biz.ewb_threshold ?? 50000)) : Number(biz.ewb_threshold ?? 50000);
  if (o.grand_total <= limit || o.ewb_exempt_reason) return;
  if (!o.ewb_number) throw conflict(`This consignment is ₹${o.grand_total.toLocaleString("en-IN")}, above ₹${limit.toLocaleString("en-IN")}. Enter its e-way bill number (or why it's exempt) before dispatch.`, { needs: "ewb" });
  if (!o.vehicle_number && !o.transporter_id) throw conflict("Add the vehicle number or transporter ID (Part B of the e-way bill) before dispatch.", { needs: "part_b" });
}
