import { z } from "zod";
import { many, one, exec, tx, scalar } from "../sql";
import { audit } from "../audit";
import type { Actor } from "../authz";
import { conflict, notFound } from "../errors";
import { round2 } from "../gst";
import { moveStock } from "./inventory";

const gstRate = z.number().refine((r) => [0, 0.25, 3, 5, 12, 18, 28, 40].includes(r), "Choose a valid GST rate");
export const ProductInput = z.object({
  name: z.string().trim().min(2, "Product name is too short").max(120),
  name_hi: z.string().trim().max(120).default(""),
  sku: z.string().trim().max(40).default(""),
  unit: z.string().trim().min(1).max(20).default("piece"),
  price: z.number({ error: "Rate must be a number" }).min(0, "Rate can't be negative").max(100_000_000),
  hsn_code: z.string().trim().regex(/^(\d{4}|\d{6}|\d{8})?$/, "HSN code must be 4, 6 or 8 digits"),
  gst_rate: gstRate.default(18),
  track_stock: z.boolean().default(true),
  reorder_level: z.number().min(0).max(100_000_000).default(0),
  opening_stock: z.number().min(0).max(100_000_000).optional(),
});

export async function createProduct(raw: unknown, actor: Actor) {
  const p = ProductInput.parse(raw);
  return tx(async () => {
    if ((await one("SELECT 1 FROM products WHERE LOWER(TRIM(name)) = LOWER(?) AND active = 1", [p.name]))) throw conflict(`"${p.name}" is already in your catalog.`);
    const id = `p-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
    (await exec(`INSERT INTO products (id, name, name_hi, sku, unit, price, hsn_code, gst_rate, track_stock, reorder_level, current_stock, active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 1)`, [id, p.name, p.name_hi, p.sku, p.unit, round2(p.price), p.hsn_code, p.gst_rate, p.track_stock ? 1 : 0, p.reorder_level]));
    if (p.opening_stock && p.track_stock) await moveStock("product", id, p.opening_stock, "opening", id, actor, "Opening stock");
    await audit(actor, "product.create", "product", id, { name: p.name, price: p.price, opening_stock: p.opening_stock });
    return { id, name: p.name, unit: p.unit, price: round2(p.price), hsn_code: p.hsn_code, gst_rate: p.gst_rate };
  });
}

export async function updateProduct(id: string, raw: unknown, actor: Actor) {
  const p = ProductInput.omit({ opening_stock: true }).partial().parse(raw);
  const before = (await one("SELECT * FROM products WHERE id = ?", [id]));
  if (!before) throw notFound("Product not found.");
  const fields = Object.entries(p).filter(([, v]) => v !== undefined).map(([k, v]) => [k, typeof v === "boolean" ? (v ? 1 : 0) : v] as const);
  if (!fields.length) return { ok: true };
  (await exec(`UPDATE products SET ${fields.map(([k]) => `${k} = ?`).join(", ")} WHERE id = ?`, [...fields.map(([, v]) => v), id]));
  await audit(actor, "product.edit", "product", id, Object.fromEntries(fields));
  return { ok: true };
}

/** Products already used in orders or stock moves are deactivated, not deleted, so history stays intact. */
export async function removeProduct(id: string, actor: Actor) {
  const used = (await one("SELECT 1 FROM order_items WHERE product_id = ? UNION SELECT 1 FROM inventory_ledger WHERE item_type='product' AND item_id = ? LIMIT 1", [id, id]));
  if (used) (await exec("UPDATE products SET active = 0 WHERE id = ?", [id]));
  else (await exec("DELETE FROM products WHERE id = ?", [id]));
  await audit(actor, used ? "product.deactivate" : "product.delete", "product", id);
  return { ok: true, deactivated: !!used };
}
