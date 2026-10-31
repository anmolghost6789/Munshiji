/* Inventory: every change to stock goes through here.
   Rules: stock and its ledger line are written in the same transaction; balances never go negative;
   an order's dispatch is applied at most once (unique ledger key), and a cancellation reverses it once. */
import { z } from "zod";
import { many, one, exec, tx, scalar } from "../sql";
import { audit } from "../audit";
import type { Actor } from "../authz";
import { badRequest, conflict, notFound } from "../errors";
import { round2 } from "../gst";
import { istToday } from "./time";

export type ItemType = "product" | "material";

interface StockRow { id: string; name: string; unit: string; current_stock: number; track_stock?: number }

async function item(type: ItemType, id: string): Promise<StockRow> {
  const row = type === "product"
    ? (await one("SELECT id, name, unit, current_stock, track_stock FROM products WHERE id = ? FOR UPDATE", [id]))
    : (await one("SELECT id, name, unit, current_stock, 1 as track_stock FROM raw_materials WHERE id = ? FOR UPDATE", [id]));
  if (!row) throw notFound(`${type === "product" ? "Product" : "Material"} not found.`);
  return row as StockRow;
}

/** Low-level move. Must be called inside a transaction. Returns the new balance. */
export async function moveStock(type: ItemType, id: string, delta: number, refType: string, refId: string, actor: Actor, notes = ""): Promise<number> {
  const it = await item(type, id);
  const next = round2(Number(it.current_stock || 0) + delta);
  if (next < -1e-9) {
    throw conflict(`Not enough stock of ${it.name}: ${round2(it.current_stock)} ${it.unit} available, ${round2(-delta)} needed.`, { item_id: id, available: it.current_stock, needed: -delta });
  }
  const table = type === "product" ? "products" : "raw_materials";
  (await exec(`UPDATE ${table} SET current_stock = ? WHERE id = ?`, [next, id]));
  (await exec(`INSERT INTO inventory_ledger (item_type, item_id, item_name, direction, qty, unit, ref_type, ref_id, notes, balance_after, user_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [type, id, it.name, delta >= 0 ? "in" : "out", Math.abs(delta), it.unit, refType, refId, notes, next, actor.id]));
  return next;
}

/* ── Purchase receipts (goods in, with the supplier's bill) ── */
export const ReceiptInput = z.object({
  supplier_id: z.string().min(1).optional(),
  supplier_name: z.string().trim().min(2, "Supplier name is too short").max(120).optional(),
  supplier_gstin: z.string().trim().max(15).optional(),
  bill_number: z.string().trim().max(40).default(""),
  bill_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Bill date must be a date").optional(),
  notes: z.string().max(500).default(""),
  items: z.array(z.object({
    item_type: z.enum(["product", "material"]).default("product"),
    item_id: z.string().min(1, "Choose an item for every line"),
    qty: z.number({ error: "Quantity must be a number" }).positive("Quantity must be more than 0").max(10_000_000),
    rate: z.number({ error: "Rate must be a number" }).min(0, "Rate can't be negative").max(100_000_000),
    gst_rate: z.number().min(0).max(40).optional(),
  })).min(1, "Add at least one item").max(100),
}).refine((v) => v.supplier_id || v.supplier_name, { message: "Choose a supplier or type a new supplier's name" });

export async function createReceipt(raw: unknown, actor: Actor, idempotencyKey?: string) {
  const input = ReceiptInput.parse(raw);
  return tx(async () => {
    if (idempotencyKey) {
      const existing = (await one("SELECT id FROM purchase_receipts WHERE idempotency_key = ?", [idempotencyKey])) as { id: string } | undefined;
      if (existing) return { id: existing.id, duplicate: true };
    }
    let supplierId = input.supplier_id;
    if (supplierId) {
      if (!(await one("SELECT 1 FROM suppliers WHERE id = ?", [supplierId]))) throw notFound("Supplier not found.");
    } else {
      // Reuse an existing supplier with the same GSTIN or name, so duplicate-bill checks work.
      const gstin = (input.supplier_gstin || "").trim().toUpperCase();
      const same = (gstin && (await one("SELECT id FROM suppliers WHERE UPPER(gstin) = ?", [gstin]))) || (await one("SELECT id FROM suppliers WHERE LOWER(TRIM(name)) = LOWER(?)", [(input.supplier_name || "").trim()]));
      if (same) supplierId = (same as { id: string }).id;
      else {
        supplierId = `s-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
        (await exec("INSERT INTO suppliers (id, name, gstin) VALUES (?, ?, ?)", [supplierId, input.supplier_name, gstin]));
      }
    }
    if (input.bill_number && (await one("SELECT 1 FROM purchase_receipts WHERE supplier_id = ? AND bill_number = ?", [supplierId, input.bill_number]))) {
      throw conflict(`Bill ${input.bill_number} from this supplier is already recorded.`);
    }
    const id = `GRN-${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 4).toUpperCase()}`;
    // Merge repeated lines for the same item so each item moves once per receipt.
    const merged = new Map<string, { item_type: ItemType; item_id: string; qty: number; rate: number; gst_rate?: number }>();
    for (const l of input.items) {
      const k = `${l.item_type}:${l.item_id}`;
      const m = merged.get(k);
      if (m) { const q = m.qty + l.qty; m.rate = round2((m.rate * m.qty + l.rate * l.qty) / q); m.qty = q; } else merged.set(k, { ...l });
    }
    let subtotal = 0, gst = 0;
    const lines = [];
    for (const l of merged.values()) {
      const it = await item(l.item_type, l.item_id);
      const master = l.item_type === "product"
        ? (await one("SELECT gst_rate FROM products WHERE id = ?", [l.item_id])) as { gst_rate: number }
        : (await one("SELECT gst_rate FROM raw_materials WHERE id = ?", [l.item_id])) as { gst_rate: number };
      const rate = l.gst_rate ?? master.gst_rate ?? 0;
      const total = round2(l.qty * l.rate), tax = round2((total * rate) / 100);
      subtotal += total; gst += tax;
      lines.push({ ...l, name: it.name, unit: it.unit, total, gst_rate: rate, gst_amount: tax });
    }
    (await exec(`INSERT INTO purchase_receipts (id, supplier_id, bill_number, bill_date, subtotal, gst, grand_total, notes, idempotency_key, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [id, supplierId, input.bill_number, input.bill_date || istToday(), round2(subtotal), round2(gst), round2(subtotal + gst), input.notes, idempotencyKey ?? null, actor.id]));
    for (const l of lines) {
      await exec(`INSERT INTO purchase_receipt_items (receipt_id, item_type, item_id, item_name, qty, unit, rate, total, gst_rate, gst_amount) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [id, l.item_type, l.item_id, l.name, l.qty, l.unit, l.rate, l.total, l.gst_rate, l.gst_amount]);
      await moveStock(l.item_type, l.item_id, l.qty, "receipt", id, actor, input.bill_number ? `Bill ${input.bill_number}` : "");
      if (l.item_type === "material") (await exec("UPDATE raw_materials SET last_purchase_price = ? WHERE id = ?", [l.rate, l.item_id]));
    }
    await audit(actor, "receipt.create", "receipt", id, { supplier_id: supplierId, bill_number: input.bill_number, lines: lines.length, total: round2(subtotal + gst) });
    return { id, duplicate: false };
  });
}

/* ── Manual adjustment (stock count, damage, opening stock) ── */
export const AdjustInput = z.object({
  item_type: z.enum(["product", "material"]).default("product"),
  item_id: z.string().min(1),
  new_qty: z.number({ error: "Counted quantity must be a number" }).min(0, "Stock can't be negative").max(100_000_000),
  reason: z.string().trim().min(3, "Say why the stock is being changed").max(200),
});
export async function adjustStock(raw: unknown, actor: Actor) {
  const input = AdjustInput.parse(raw);
  return tx(async () => {
    const it = await item(input.item_type, input.item_id);
    const delta = round2(input.new_qty - Number(it.current_stock || 0));
    if (delta === 0) return { balance: it.current_stock, changed: false };
    const ref = `ADJ-${Date.now().toString(36).toUpperCase()}`;
    const balance = await moveStock(input.item_type, input.item_id, delta, "adjustment", ref, actor, input.reason);
    await audit(actor, "stock.adjust", input.item_type, input.item_id, { from: it.current_stock, to: input.new_qty, reason: input.reason });
    return { balance, changed: true };
  });
}

/* ── Order dispatch / cancellation (called from the order core, inside its transaction) ── */
export async function deductForOrder(orderId: string, actor: Actor) {
  const o = (await one("SELECT stock_deducted FROM orders WHERE id = ? FOR UPDATE", [orderId])) as { stock_deducted: number } | undefined;
  if (!o) throw notFound("Order not found.");
  if (o.stock_deducted) return; // already done — never twice
  const lines = (await many(`SELECT oi.product_id, SUM(oi.qty) as qty, p.track_stock, p.name, p.unit, p.current_stock FROM order_items oi JOIN products p ON p.id = oi.product_id
    WHERE oi.order_id = ? GROUP BY oi.product_id, p.track_stock, p.name, p.unit, p.current_stock`, [orderId])) as { product_id: string; qty: number; track_stock: number; name: string; unit: string; current_stock: number }[];
  const short = lines.filter((l) => l.track_stock && l.current_stock + 1e-9 < l.qty);
  if (short.length) {
    throw conflict(`Not enough stock to dispatch: ${short.map((l) => `${l.name} (${round2(l.current_stock)} of ${round2(l.qty)} ${l.unit})`).join(", ")}. Record a purchase receipt or adjust stock first.`, { shortages: short });
  }
  for (const l of lines) if (l.track_stock) await moveStock("product", l.product_id, -l.qty, "order_dispatch", orderId, actor);
  (await exec("UPDATE orders SET stock_deducted = 1 WHERE id = ?", [orderId]));
}

export async function restoreForOrder(orderId: string, actor: Actor) {
  const moves = (await many("SELECT item_id, qty FROM inventory_ledger WHERE ref_type = 'order_dispatch' AND ref_id = ? AND item_type = 'product'", [orderId])) as { item_id: string; qty: number }[];
  for (const m of moves) await moveStock("product", m.item_id, m.qty, "order_cancel", orderId, actor, "Order cancelled");
  (await exec("UPDATE orders SET stock_deducted = 0 WHERE id = ?", [orderId]));
}

/* ── Reads ── */
export async function stockSummary() {
  return {
    products: (await many("SELECT id, name, name_hi, sku, unit, price, hsn_code, gst_rate, track_stock, current_stock, reorder_level FROM products WHERE active = 1 ORDER BY name")),
    materials: (await many("SELECT id, name, unit, current_stock, reorder_level, last_purchase_price FROM raw_materials WHERE active = 1 ORDER BY name")),
  };
}
export async function ledgerFor(type: ItemType, id: string, limit = 100) {
  return (await many("SELECT * FROM inventory_ledger WHERE item_type = ? AND item_id = ? ORDER BY id DESC LIMIT ?", [type, id, limit]));
}
export async function recentReceipts(limit = 50) {
  const rows = (await many(`SELECT r.*, s.name as supplier_name FROM purchase_receipts r JOIN suppliers s ON s.id = r.supplier_id ORDER BY r.created_at DESC LIMIT ?`, [limit])) as { id: string }[];
  const out = [];
  for (const r of rows) out.push({ ...r, items: await many("SELECT * FROM purchase_receipt_items WHERE receipt_id = ?", [r.id]) });
  return out;
}
/** Invariant check used by tests and the health page: every stock balance equals the sum of its ledger. */
export async function ledgerMismatches() {
  return (await many(`SELECT p.id, p.name, p.current_stock, COALESCE(SUM(CASE WHEN l.direction='in' THEN l.qty ELSE -l.qty END), 0) as ledger
    FROM products p LEFT JOIN inventory_ledger l ON l.item_type='product' AND l.item_id = p.id GROUP BY p.id HAVING ABS(p.current_stock - COALESCE(SUM(CASE WHEN l.direction='in' THEN l.qty ELSE -l.qty END), 0)) > 0.001`));
}

/** Legacy material purchase orders: receiving adds stock exactly once, in one transaction. */
export async function receivePurchaseOrder(poId: string, actor: Actor) {
  return tx(async () => {
    const po = (await one("SELECT state FROM purchase_orders WHERE id = ?", [poId])) as { state: string } | undefined;
    if (!po) throw notFound("Purchase order not found.");
    if (po.state === "received") throw conflict("This purchase order was already received.");
    const items = (await many("SELECT material_id, qty, price FROM purchase_items WHERE po_id = ?", [poId])) as { material_id: string; qty: number; price: number }[];
    for (const it of items) {
      await moveStock("material", it.material_id, it.qty, "purchase_order", poId, actor, "Received");
      (await exec("UPDATE raw_materials SET last_purchase_price = ? WHERE id = ?", [it.price, it.material_id]));
    }
    (await exec("UPDATE purchase_orders SET state = 'received', updated_at = now() WHERE id = ?", [poId]));
    await audit(actor, "po.receive", "purchase_order", poId, { lines: items.length });
    return { ok: true };
  });
}
