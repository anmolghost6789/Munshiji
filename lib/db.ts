/* Data access for PostgreSQL. Schema lives in migrations/*.sql (applied by scripts/migrate.mjs at deploy time).
   Business rules that change money or stock live in lib/core/*; this file holds reads and simple writes. */
import { many, one, exec, tx } from "./sql";
import { DEFAULT_OVERDUE_DAYS, clampOverdueDays } from "./types";

export type OrderState = "new" | "confirmed" | "preparing" | "dispatched" | "delivered" | "invoiced" | "paid" | "overdue" | "cancelled";

export interface BusinessProfile {
  company_name: string; gstin: string; udyam_number: string; pan: string;
  address: string; city: string; state: string; pincode: string;
  phone: string; email: string; bank_name: string; bank_account: string; bank_ifsc: string;
  overdue_days: number; status_styles: string; invoice_prefix: string; invoice_start: number; einvoice_applicable: number; ewb_threshold: number; credit_note_prefix: string;
  template: string; capabilities: string; gst_registration: string; composition_rate: number; upi_id: string;
}

export interface OrderRow {
  id: string; customer_id: string; state: OrderState;
  subtotal: number; gst: number; grand_total: number;
  delivery_date: string; notes: string; raw_message: string;
  invoice_id: string | null; created_at: string; updated_at: string;
  bill_age_days?: number; display_state?: string; invoice_number?: string | null; invoice_date?: string | null;
  version: number; amount_paid: number; stock_deducted: number; source: string; cancel_reason: string; created_by: string;
  customer_name: string; customer_phone: string; customer_address: string; customer_gstin: string;
}

export interface OrderItemRow {
  id: number; order_id: string; product_id: string; product_name: string;
  qty: number; unit: string; price: number; total: number;
  hsn_code: string; gst_rate: number; gst_amount: number;
}

export interface ProductRow {
  id: string; name: string; name_hi: string; sku: string;
  unit: string; price: number; hsn_code: string; gst_rate: number;
  active: number; created_at: string;
}

export interface CustomerRow {
  id: string; name: string; phone: string; address: string;
  gstin: string; created_at: string; updated_at: string;
}

export interface InvoiceRow {
  id: string; order_id: string; customer_id: string; invoice_number: string;
  subtotal: number; cgst: number; sgst: number; igst: number; grand_total: number; doc_type: string; place_of_supply: string;
  status: string; irn: string; irn_date: string; e_invoice_status: string; created_at: string;
}


// ═══ Queries ═══════════════════════════════════════════════════════

// Business Profile
export async function getBusinessProfile(): Promise<BusinessProfile | null> {
  return (await one("SELECT * FROM business_profile LIMIT 1")) as BusinessProfile | null;
}

const BUSINESS_FIELDS = new Set([
  "company_name", "gstin", "udyam_number", "pan", "address", "city", "state", "pincode", "phone", "email",
  "bank_name", "bank_account", "bank_ifsc", "overdue_days", "status_styles",
  "template", "capabilities", "gst_registration", "composition_rate", "upi_id", "invoice_prefix", "invoice_start", "einvoice_applicable", "ewb_threshold", "credit_note_prefix",
]);

/** Days after the invoice date at which an unpaid invoice counts as overdue. */
export async function getOverdueDays(): Promise<number> {
  const row = (await one("SELECT overdue_days FROM business_profile LIMIT 1")) as { overdue_days?: number } | undefined;
  return clampOverdueDays(row?.overdue_days ?? DEFAULT_OVERDUE_DAYS);
}

// Days since the latest invoice for an order (falls back to the order date if no invoice row exists).
const BILL_AGE_SQL = `FLOOR(EXTRACT(EPOCH FROM (now() - COALESCE((SELECT MAX(inv.created_at) FROM invoices inv WHERE inv.order_id = o.id), o.created_at))) / 86400)::int`;
const RECEIVABLE_SQL = `o.state IN ('invoiced','overdue')`;
// The status to show: receivables past the threshold are overdue; legacy hand-set "overdue" inside it shows as invoiced.
const displayStateSql = (n: number) => `CASE WHEN ${RECEIVABLE_SQL} AND ${BILL_AGE_SQL} > ${n} THEN 'overdue' WHEN o.state = 'overdue' THEN 'invoiced' ELSE o.state END`;

export async function upsertBusinessProfile(data: Partial<BusinessProfile>) {
  const existing = (await one("SELECT business_id FROM business_profile LIMIT 1"));
  if (!existing) {
    (await exec("INSERT INTO business_profile (company_name) VALUES ('')")); // business_id comes from the request's business
  }
  const fields: string[] = [];
  const values: unknown[] = [];
  for (const [k, v] of Object.entries(data)) {
    if (v === undefined || !BUSINESS_FIELDS.has(k)) continue;
    let val: unknown = v;
    if (k === "overdue_days") val = clampOverdueDays(v);
    if (k === "status_styles" || k === "capabilities") val = typeof v === "string" ? v : JSON.stringify(v ?? {});
    if (k === "gst_registration") val = v === "composition" || v === "none" ? v : "regular";
    if (k === "template") val = v === "retail_delivery" || v === "custom" ? v : "manufacturer";
    if (k === "composition_rate") val = [1, 5, 6].includes(Number(v)) ? Number(v) : 1;
    if (k === "gstin" || k === "pan") val = String(v ?? "").trim().toUpperCase();
    if (k === "invoice_prefix") { val = String(v ?? "").trim().toUpperCase(); if (!/^[A-Z0-9]{1,4}$/.test(val as string)) continue; }
    if (k === "invoice_start") { const n = Math.floor(Number(v)); if (!(n >= 1 && n <= 999999)) continue; val = n; }
    if (k === "credit_note_prefix") { val = String(v ?? "").trim().toUpperCase(); if (!/^[A-Z0-9]{1,4}$/.test(val as string)) continue; }
    if (k === "einvoice_applicable") val = (v as unknown) === true || v === 1 || v === "1" ? 1 : 0;
    if (k === "ewb_threshold") { const n = Number(v); if (!(n >= 0 && n <= 100_000_000)) continue; val = n; }
    fields.push(`${k} = ?`); values.push(val);
  }
  if (fields.length > 0) {
    fields.push("updated_at = now()");
    (await exec(`UPDATE business_profile SET ${fields.join(", ")}`, [...values]));
  }
}

// Users
export interface UserRow {
  id: string; name: string; email: string; password_hash: string; role: string; created_at: string; last_login: string;
}

export async function getUserByEmail(email: string): Promise<UserRow | undefined> {
  return (await one("SELECT * FROM users WHERE email = ?", [email.toLowerCase()])) as UserRow | undefined;
}

export async function getUserById(id: string): Promise<UserRow | undefined> {
  return (await one("SELECT * FROM users WHERE id = ?", [id])) as UserRow | undefined;
}

export async function createUser(data: { id: string; name: string; email: string; password_hash: string; role?: string }) {
  (await exec("INSERT INTO users (id, name, email, password_hash, role) VALUES (?, ?, ?, ?, ?)", [data.id, data.name, data.email.toLowerCase(), data.password_hash, data.role || "admin"]));
}

export async function updateUserLogin(id: string) {
  (await exec("UPDATE users SET last_login = now() WHERE id = ?", [id]));
}

export async function getUserCount(): Promise<number> {
  return ((await one("SELECT COUNT(*) as c FROM users")) as { c: number }).c;
}

// Orders
export async function getAllOrders(state?: string): Promise<OrderRow[]> {
  const ds = displayStateSql(await getOverdueDays());
  let sql = `SELECT * FROM (SELECT o.*, c.name as customer_name, c.phone as customer_phone, c.address as customer_address, c.gstin as customer_gstin,
      ${BILL_AGE_SQL} as bill_age_days, ${ds} as display_state, (SELECT inv.invoice_number FROM invoices inv WHERE inv.order_id = o.id ORDER BY inv.created_at DESC LIMIT 1) as invoice_number, (SELECT MAX(inv.created_at) FROM invoices inv WHERE inv.order_id = o.id) as invoice_date
    FROM orders o JOIN customers c ON o.customer_id = c.id) AS t`;
  if (state && state !== "all") sql += ` WHERE display_state = ?`;
  sql += ` ORDER BY created_at DESC`;
  return state && state !== "all" ? (await many(sql, [state])) as OrderRow[] : (await many(sql)) as OrderRow[];
}

export async function getOrderById(id: string): Promise<OrderRow | undefined> {
  return (await one(`SELECT o.*, c.name as customer_name, c.phone as customer_phone, c.address as customer_address, c.gstin as customer_gstin, ${BILL_AGE_SQL} as bill_age_days, ${displayStateSql(await getOverdueDays())} as display_state, (SELECT inv.invoice_number FROM invoices inv WHERE inv.order_id = o.id ORDER BY inv.created_at DESC LIMIT 1) as invoice_number, (SELECT MAX(inv.created_at) FROM invoices inv WHERE inv.order_id = o.id) as invoice_date FROM orders o JOIN customers c ON o.customer_id = c.id WHERE o.id = ?`, [id])) as OrderRow | undefined;
}

export async function getOrderItems(orderId: string): Promise<OrderItemRow[]> {
  return (await many("SELECT * FROM order_items WHERE order_id = ?", [orderId])) as OrderItemRow[];
}




// Products
export async function getAllProducts(): Promise<ProductRow[]> {
  return (await many("SELECT * FROM products WHERE active = 1 ORDER BY name")) as ProductRow[];
}

export async function createProduct(data: { id: string; name: string; name_hi: string; sku: string; unit: string; price: number; hsn_code?: string; gst_rate?: number }) {
  (await exec("INSERT INTO products (id, name, name_hi, sku, unit, price, hsn_code, gst_rate) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", [data.id, data.name, data.name_hi, data.sku, data.unit, data.price, data.hsn_code || "", data.gst_rate ?? 18]));
}

export async function updateProduct(id: string, data: Partial<{ name: string; name_hi: string; sku: string; unit: string; price: number; hsn_code: string; gst_rate: number }>) {
  const fields: string[] = []; const values: unknown[] = [];
  for (const [k, v] of Object.entries(data)) { if (v !== undefined) { fields.push(`${k} = ?`); values.push(v); } }
  if (fields.length === 0) return;
  values.push(id);
  (await exec(`UPDATE products SET ${fields.join(", ")} WHERE id = ?`, [...values]));
}

export async function deleteProduct(id: string) { (await exec("UPDATE products SET active = 0 WHERE id = ?", [id])); }

// Customers
export async function getAllCustomers(): Promise<CustomerRow[]> {
  return (await many("SELECT * FROM customers ORDER BY name")) as CustomerRow[];
}

export async function findCustomerByPhone(phone: string): Promise<CustomerRow | undefined> {
  return (await one("SELECT * FROM customers WHERE phone = ?", [phone])) as CustomerRow | undefined;
}

export async function createCustomer(data: { id: string; name: string; phone: string; address: string; gstin?: string }) {
  (await exec("INSERT INTO customers (id, name, phone, address, gstin) VALUES (?, ?, ?, ?, ?)", [data.id, data.name, data.phone, data.address, data.gstin || ""]));
}

export async function getCustomerStats(customerId: string) {
  return (await one(`SELECT COUNT(*) as order_count, COALESCE(SUM(grand_total), 0) as total_value, COALESCE(SUM(CASE WHEN state IN ('invoiced','overdue') THEN grand_total - amount_paid - amount_credited ELSE 0 END), 0) as outstanding FROM orders WHERE customer_id = ?`, [customerId])) as { order_count: number; total_value: number; outstanding: number };
}

// Invoices

export async function getAllInvoices(): Promise<(InvoiceRow & { customer_name: string; customer_gstin: string })[]> {
  return (await many(`SELECT i.*, c.name as customer_name, c.gstin as customer_gstin FROM invoices i JOIN customers c ON i.customer_id = c.id ORDER BY i.created_at DESC`)) as any[];
}



export async function getOrderStateCounts() {
  const n = await getOverdueDays();
  return (await many(`SELECT ${displayStateSql(n)} as state, COUNT(*) as count FROM orders o GROUP BY 1`)) as { state: string; count: number }[];
}

// Dashboard stats
export async function getCashFlowStats() {
  const receivables = (await one("SELECT COALESCE(SUM(grand_total - amount_paid - amount_credited), 0) as total FROM orders WHERE state IN ('invoiced','overdue')")) as { total: number };
  const overdueCount = (await one(`SELECT COUNT(*) as c FROM orders o WHERE ${RECEIVABLE_SQL} AND ${BILL_AGE_SQL} > ?`, [await getOverdueDays()])) as { c: number };
  const thisMonth = (await one("SELECT COALESCE(SUM(grand_total), 0) as total FROM orders WHERE state <> 'cancelled' AND created_at >= (date_trunc('month', now() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata')")) as { total: number };
  return { receivables: receivables.total, overdueCount: overdueCount.c, thisMonth: thisMonth.total };
}

// ═══ PURCHASE SIDE ═══════════════════════════════════════════════

export interface SupplierRow {
  id: string; name: string; phone: string; address: string; gstin: string;
  contact_person: string; payment_terms: string; created_at: string; updated_at: string;
}

export interface RawMaterialRow {
  id: string; name: string; name_hi: string; sku: string; unit: string;
  hsn_code: string; gst_rate: number; current_stock: number;
  reorder_level: number; last_purchase_price: number; active: number; created_at: string;
}

export interface PurchaseOrderRow {
  id: string; supplier_id: string; state: string;
  subtotal: number; gst: number; grand_total: number;
  expected_date: string; notes: string; bill_number: string;
  created_at: string; updated_at: string;
  supplier_name: string; supplier_phone: string; supplier_gstin: string;
}

export interface PurchaseItemRow {
  id: number; po_id: string; material_id: string; material_name: string;
  qty: number; unit: string; price: number; total: number;
  hsn_code: string; gst_rate: number; gst_amount: number;
}

export interface InventoryEntry {
  id: number; item_type: string; item_id: string; item_name: string;
  direction: string; qty: number; unit: string;
  ref_type: string; ref_id: string; notes: string; created_at: string;
}

export interface BomRow {
  id: number; product_id: string; material_id: string;
  qty_per_unit: number; unit: string;
  material_name?: string; material_unit?: string;
}

// Suppliers
export async function getAllSuppliers(): Promise<SupplierRow[]> {
  return (await many("SELECT * FROM suppliers ORDER BY name")) as SupplierRow[];
}

export async function createSupplier(data: { id: string; name: string; phone: string; address: string; gstin?: string; contact_person?: string; payment_terms?: string }) {
  (await exec("INSERT INTO suppliers (id, name, phone, address, gstin, contact_person, payment_terms) VALUES (?, ?, ?, ?, ?, ?, ?)", [data.id, data.name, data.phone, data.address, data.gstin || "", data.contact_person || "", data.payment_terms || "Net 30"]));
}

export async function getSupplierStats(supplierId: string) {
  // Purchases actually received (Stock → Record purchase), not just purchase orders.
  return (await one(`SELECT COUNT(*) as purchases, COALESCE(SUM(grand_total), 0) as spent FROM purchase_receipts WHERE supplier_id = ?`, [supplierId]));
}

// Raw Materials
export async function getAllRawMaterials(): Promise<RawMaterialRow[]> {
  return (await many("SELECT * FROM raw_materials WHERE active = 1 ORDER BY name")) as RawMaterialRow[];
}

export async function createRawMaterial(data: { id: string; name: string; name_hi?: string; sku?: string; unit: string; hsn_code?: string; gst_rate?: number; reorder_level?: number }) {
  (await exec("INSERT INTO raw_materials (id, name, name_hi, sku, unit, hsn_code, gst_rate, reorder_level) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", [data.id, data.name, data.name_hi || "", data.sku || "", data.unit, data.hsn_code || "", data.gst_rate ?? 18, data.reorder_level ?? 0]));
}

export async function deleteRawMaterial(id: string) { (await exec("UPDATE raw_materials SET active = 0 WHERE id = ?", [id])); }

// Purchase Orders
export async function getAllPurchaseOrders(state?: string): Promise<PurchaseOrderRow[]> {
  let sql = `SELECT p.*, s.name as supplier_name, s.phone as supplier_phone, s.gstin as supplier_gstin FROM purchase_orders p JOIN suppliers s ON p.supplier_id = s.id`;
  if (state && state !== "all") sql += ` WHERE p.state = ?`;
  sql += ` ORDER BY p.created_at DESC`;
  return state && state !== "all" ? (await many(sql, [state])) as PurchaseOrderRow[] : (await many(sql)) as PurchaseOrderRow[];
}

export async function getPurchaseItems(poId: string): Promise<PurchaseItemRow[]> {
  return (await many("SELECT * FROM purchase_items WHERE po_id = ?", [poId])) as PurchaseItemRow[];
}

export async function createPurchaseOrder(data: {
  id: string; supplier_id: string; subtotal: number; gst: number; grand_total: number;
  expected_date: string; notes: string; bill_number?: string;
  items: { material_id: string; material_name: string; qty: number; unit: string; price: number; total: number; hsn_code?: string; gst_rate?: number; gst_amount?: number }[];
}) {
  await tx(async () => {
    (await exec(`INSERT INTO purchase_orders (id, supplier_id, state, subtotal, gst, grand_total, expected_date, notes, bill_number) VALUES (?, ?, 'ordered', ?, ?, ?, ?, ?, ?)`, [data.id, data.supplier_id, data.subtotal, data.gst, data.grand_total, data.expected_date, data.notes, data.bill_number || ""]));
    for (const it of data.items) await exec("INSERT INTO purchase_items (po_id, material_id, material_name, qty, unit, price, total, hsn_code, gst_rate, gst_amount) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [data.id, it.material_id, it.material_name, it.qty, it.unit, it.price, it.total, it.hsn_code || "", it.gst_rate ?? 18, it.gst_amount ?? 0]);
  });
}

export async function updatePurchaseOrderState(id: string, state: string) {
  // Receiving (which moves stock) goes through receivePurchaseOrder in lib/core/inventory.ts.
  if (state === "received") throw new Error("Use receivePurchaseOrder to receive stock.");
  await exec("UPDATE purchase_orders SET state = ?, updated_at = now() WHERE id = ?", [state, id]);
}

export async function getPurchaseStateCounts() {
  return (await many("SELECT state, COUNT(*) as count FROM purchase_orders GROUP BY state")) as { state: string; count: number }[];
}

// Inventory
export async function getInventoryLedger(itemType?: string, itemId?: string): Promise<InventoryEntry[]> {
  let sql = "SELECT * FROM inventory_ledger";
  const params: string[] = [];
  if (itemType) { sql += " WHERE item_type = ?"; params.push(itemType); }
  if (itemId) { sql += (params.length ? " AND" : " WHERE") + " item_id = ?"; params.push(itemId); }
  sql += " ORDER BY created_at DESC LIMIT 100";
  return (await many(sql, [...params])) as InventoryEntry[];
}

export async function getInventorySummary() {
  const rawMaterials = (await many(`SELECT id, name, unit, current_stock, reorder_level, last_purchase_price FROM raw_materials WHERE active = 1 ORDER BY name`)) as any[];
  const lowStock = rawMaterials.filter((m: any) => m.reorder_level > 0 && m.current_stock <= m.reorder_level);
  const totalRawValue = rawMaterials.reduce((s: number, m: any) => s + (m.current_stock * m.last_purchase_price), 0);
  return { rawMaterials, lowStock, totalRawValue };
}

// BOM
export async function getBomForProduct(productId: string): Promise<BomRow[]> {
  return (await many(`SELECT b.*, r.name as material_name, r.unit as material_unit FROM bom b JOIN raw_materials r ON b.material_id = r.id WHERE b.product_id = ?`, [productId])) as BomRow[];
}

export async function getAllBom(): Promise<(BomRow & { product_name: string; material_name: string })[]> {
  return (await many(`SELECT b.*, p.name as product_name, r.name as material_name FROM bom b JOIN products p ON b.product_id = p.id JOIN raw_materials r ON b.material_id = r.id ORDER BY p.name, r.name`)) as any[];
}

// Consume raw materials when a sales order goes to production
export async function consumeForProduction(orderId: string) {
  const items = await getOrderItems(orderId);
  await tx(async () => {
    for (const item of items) {
      const bom = await getBomForProduct(item.product_id);
      for (const b of bom) {
        const totalConsumption = b.qty_per_unit * item.qty;
        (await exec("UPDATE raw_materials SET current_stock = GREATEST(0, current_stock - ?) WHERE id = ?", [totalConsumption, b.material_id]));
        (await exec("INSERT INTO inventory_ledger (item_type, item_id, item_name, direction, qty, unit, ref_type, ref_id, notes) VALUES ('raw_material', ?, ?, 'out', ?, ?, 'sales_order', ?, ?)", [b.material_id, b.material_name || "", totalConsumption, b.unit, orderId, `Production: ${item.qty} ${item.product_name}`]));
      }
    }
  });
}

// ═══ AGING ANALYSIS ══════════════════════════════════════════════

export async function getReceivablesAging() {
  return (await many(`
    SELECT o.id, (o.grand_total - o.amount_paid - o.amount_credited) as grand_total, o.created_at, o.state, c.name as customer_name,
      ${BILL_AGE_SQL} as age_days
    FROM orders o JOIN customers c ON o.customer_id = c.id
    WHERE ${RECEIVABLE_SQL}
    ORDER BY age_days DESC
  `)) as { id: string; grand_total: number; created_at: string; state: string; customer_name: string; age_days: number }[];
}

export async function getPayablesAging() {
  return (await many(`
    SELECT p.id, p.grand_total, p.created_at, p.state, s.name as supplier_name,
      FLOOR(EXTRACT(EPOCH FROM (now() - p.created_at)) / 86400)::int as age_days
    FROM purchase_orders p JOIN suppliers s ON p.supplier_id = s.id
    WHERE p.state IN ('ordered','partial')
    ORDER BY age_days DESC
  `)) as { id: string; grand_total: number; created_at: string; state: string; supplier_name: string; age_days: number }[];
}

// ═══ MATERIAL REQUIREMENT CHECK ═════════════════════════════════

export async function checkMaterialRequirement(orderId: string) {
  const items = await getOrderItems(orderId);
  const shortages: { material_name: string; required: number; available: number; shortage: number; unit: string }[] = [];

  for (const item of items) {
    const bom = await getBomForProduct(item.product_id);
    for (const b of bom) {
      const required = b.qty_per_unit * item.qty;
      const mat = (await one("SELECT current_stock FROM raw_materials WHERE id = ?", [b.material_id])) as { current_stock: number } | undefined;
      const available = mat?.current_stock || 0;
      if (required > available) {
        shortages.push({ material_name: b.material_name || "", required, available, shortage: required - available, unit: b.unit });
      }
    }
  }
  return shortages;
}

// ═══ NET WORKING CAPITAL ════════════════════════════════════════

export async function getNetWorkingCapital() {
  const receivables = (await one("SELECT COALESCE(SUM(grand_total - amount_paid - amount_credited), 0) as t FROM orders WHERE state IN ('invoiced','overdue')")) as { t: number };
  const payables = (await one("SELECT COALESCE(SUM(grand_total), 0) as t FROM purchase_orders WHERE state IN ('ordered','partial')")) as { t: number };
  const inventory = (await one("SELECT COALESCE(SUM(current_stock * last_purchase_price), 0) as t FROM raw_materials WHERE active = 1")) as { t: number };
  return {
    receivables: receivables.t,
    payables: payables.t,
    inventory: inventory.t,
    netWorkingCapital: receivables.t + inventory.t - payables.t,
  };
}

// ═══ GSTR-1 EXPORT DATA ════════════════════════════════════════

export async function getGSTR1Data(fromDate: string, toDate: string) {
  return (await many(`
    SELECT i.invoice_number, i.created_at as invoice_date, c.name as buyer_name, c.gstin as buyer_gstin,
      i.subtotal as taxable_value, i.cgst, i.sgst, i.igst, i.place_of_supply, i.grand_total as total_value,
      o.id as order_id
    FROM invoices i
    JOIN customers c ON i.customer_id = c.id
    JOIN orders o ON i.order_id = o.id
    WHERE i.created_at >= ? AND i.created_at <= ?
    ORDER BY i.created_at
  `, [fromDate, toDate + " 23:59:59"])) as any[];
}

// ═══ OVERVIEW DASHBOARD STATS ═══════════════════════════════════

export async function getOverviewStats() {
  const salesThisMonth = (await one("SELECT COALESCE(SUM(grand_total), 0) as t FROM orders WHERE state <> 'cancelled' AND created_at >= (date_trunc('month', now() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata')")) as { t: number };
  const purchasesThisMonth = (await one("SELECT COALESCE(SUM(grand_total), 0) as t FROM purchase_orders WHERE created_at >= (date_trunc('month', now() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata')")) as { t: number };
  const overdueDays = await getOverdueDays();
  const activeOrders = (await one("SELECT COUNT(*) as c FROM orders WHERE state NOT IN ('invoiced','paid','overdue','cancelled')")) as { c: number };
  const pendingPOs = (await one("SELECT COUNT(*) as c FROM purchase_orders WHERE state IN ('ordered','partial')")) as { c: number };
  const overdue = (await one(`SELECT COUNT(*) as c, COALESCE(SUM(o.grand_total - o.amount_paid - o.amount_credited), 0) as t FROM orders o WHERE ${RECEIVABLE_SQL} AND ${BILL_AGE_SQL} > ?`, [overdueDays])) as { c: number; t: number };
  const wc = await getNetWorkingCapital();
  const lowStockCount = (await one("SELECT COUNT(*) as c FROM raw_materials WHERE active = 1 AND reorder_level > 0 AND current_stock <= reorder_level")) as { c: number };

  return {
    salesThisMonth: salesThisMonth.t,
    purchasesThisMonth: purchasesThisMonth.t,
    activeOrders: activeOrders.c,
    pendingPOs: pendingPOs.c,
    overdueOrders: overdue.c,
    overdueAmount: overdue.t,
    overdueDays,
    lowStockCount: lowStockCount.c,
    ...wc,
  };
}


// ═══ GST RETURN DATA (prepared, not filed) ═════════════════════════

/** Bills issued in a date range: billed orders, dated by their invoice (or the order date if no invoice row exists). */
export async function getBillsForPeriod(from: string, to: string) {
  const rows = (await many(`
    SELECT * FROM (
      SELECT o.id as order_id, o.state, o.subtotal, o.gst, o.grand_total, o.customer_id,
        c.name as customer_name, c.gstin as customer_gstin, c.phone as customer_phone, o.delivery_state,
        (SELECT inv.invoice_number FROM invoices inv WHERE inv.order_id = o.id ORDER BY inv.created_at DESC LIMIT 1) as invoice_number,
        COALESCE((SELECT MAX(inv.created_at) FROM invoices inv WHERE inv.order_id = o.id), o.created_at) as bill_date
      FROM orders o JOIN customers c ON o.customer_id = c.id
      WHERE o.invoice_id IS NOT NULL -- every issued bill is reported, whatever happened after (payments, credit notes)
    ) AS t WHERE bill_date >= ? AND bill_date <= ? ORDER BY bill_date
  `, [from, to + " 23:59:59"])) as { order_id: string; state: string; subtotal: number; gst: number; grand_total: number; customer_id: string; customer_name: string; customer_gstin: string; customer_phone: string; invoice_number: string | null; bill_date: string }[];
  const out = [];
  for (const r of rows) out.push({ ...r, items: (await many("SELECT product_name, qty, unit, price, total, hsn_code, gst_rate, gst_amount FROM order_items WHERE order_id = ?", [r.order_id])) as { product_name: string; qty: number; unit: string; price: number; total: number; hsn_code: string; gst_rate: number; gst_amount: number }[] });
  return out;
}

/** Delivered orders with no bill yet (reminder on the GST checklist). */
export async function getUnbilledDeliveredCount(): Promise<number> {
  return ((await one("SELECT COUNT(*) as c FROM orders WHERE state = 'delivered'")) as { c: number }).c;
}

/** Purchases received in a date range, for input tax credit. */
export async function getPurchasesForPeriod(from: string, to: string) {
  return (await many(`
    SELECT r.id, r.subtotal, r.gst, r.grand_total, r.bill_number, r.bill_date::text as updated_at, s.name as supplier_name, s.gstin as supplier_gstin
    FROM purchase_receipts r JOIN suppliers s ON r.supplier_id = s.id WHERE r.bill_date >= ?::date AND r.bill_date <= ?::date
    UNION ALL
    SELECT p.id, p.subtotal, p.gst, p.grand_total, p.bill_number, p.updated_at::text, s.name, s.gstin
    FROM purchase_orders p JOIN suppliers s ON p.supplier_id = s.id WHERE p.state IN ('received','partial') AND p.updated_at >= ? AND p.updated_at <= ?
    ORDER BY 7`, [from, to, from, to + " 23:59:59"])) as { id: string; subtotal: number; gst: number; grand_total: number; bill_number: string; updated_at: string; supplier_name: string; supplier_gstin: string }[];
}

// ═══ SALES SERIES (Overview chart) ═══════════════════════════════════
/** Sales (order value, excluding cancelled data) bucketed by day, month or financial year, newest last. */
export async function getSalesSeries() {
  const sum = async (from: string, to: string) => ((await one("SELECT COALESCE(SUM(grand_total),0) as t FROM orders WHERE state <> 'cancelled' AND created_at >= ? AND created_at < ?", [from, to])) as { t: number }).t;
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const week: { label: string; value: number }[] = [];
  for (let k = 0; k < 8; k++) {
    const d = new Date(today); d.setUTCDate(d.getUTCDate() - (7 - k));
    const n = new Date(d); n.setUTCDate(n.getUTCDate() + 1);
    week.push({ label: d.toLocaleDateString("en-IN", { weekday: "short", timeZone: "UTC" }), value: await sum(iso(d), iso(n)) });
  }
  const month: { label: string; value: number }[] = [];
  for (let k = 0; k < 7; k++) {
    const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - (6 - k), 1));
    const n = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
    month.push({ label: d.toLocaleDateString("en-IN", { month: "short", timeZone: "UTC" }), value: await sum(iso(d), iso(n)) });
  }
  const fyStart = today.getUTCMonth() >= 3 ? today.getUTCFullYear() : today.getUTCFullYear() - 1; // Indian FY starts 1 April
  const year: { label: string; value: number }[] = [];
  for (let k = 0; k < 6; k++) { const y = fyStart - (5 - k); year.push({ label: `FY${String(y + 1).slice(2)}`, value: await sum(`${y}-04-01`, `${y + 1}-04-01`) }); }
  // Each series carries one extra (oldest) point used only for the change badge.
  const pack = (pts: { label: string; value: number }[]) => {
    const prev = pts[pts.length - 2].value, cur = pts[pts.length - 1].value;
    return { points: pts.slice(1), current: cur, change: prev > 0 ? ((cur - prev) / prev) * 100 : null };
  };
  return { week: pack(week), month: pack(month), year: pack(year) };
}

/** The newest order still waiting to be confirmed, with what Munshiji actually did for it. */
export async function getNewestPendingOrder() {
  const o = (await one(`SELECT o.id, o.grand_total, o.subtotal, o.gst, o.raw_message, o.created_at, c.name as customer_name, c.gstin as customer_gstin, c.created_at as customer_since,
      (SELECT COUNT(*) FROM order_items i WHERE i.order_id = o.id) as item_count,
      (SELECT COUNT(*) FROM orders x WHERE x.customer_id = o.customer_id AND x.id <> o.id) as previous_orders
    FROM orders o JOIN customers c ON o.customer_id = c.id WHERE o.state = 'new' ORDER BY o.created_at DESC LIMIT 1`)) as
    { id: string; grand_total: number; subtotal: number; gst: number; raw_message: string; created_at: string; customer_name: string; customer_gstin: string; customer_since: string; item_count: number; previous_orders: number } | undefined;
  const pending = ((await one("SELECT COUNT(*) as c FROM orders WHERE state = 'new'")) as { c: number }).c;
  return o ? { ...o, pending } : null;
}

export async function getStateCount(state: string): Promise<number> {
  return ((await one("SELECT COUNT(*) as c FROM orders WHERE state = ?", [state])) as { c: number }).c;
}
