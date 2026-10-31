#!/usr/bin/env node
/* Daily health check against DATABASE_URL. Exit code 0 = all good; 3 = problems found (listed). */
import pg from "pg";

const url = process.argv[2] || process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL is not set."); process.exit(1); }
const c = new pg.Client({ connectionString: url }); await c.connect();
// Checks run business by business: each inside a transaction tagged with that business (Row-Level Security).
const businesses = (await c.query("SELECT id, name FROM businesses ORDER BY created_at")).rows;
const report = {};
for (const b of businesses) {
  await c.query("BEGIN");
  await c.query("SELECT set_config('app.business_id', $1, true)", [b.id]);
  const q = async (sql) => (await c.query(sql)).rows;
  const gaps = [];
  const byFy = {};
  for (const { n } of await q("SELECT invoice_number n FROM invoices")) { const p = n.split("/"); if (p.length === 3) (byFy[`${p[0]}/${p[1]}`] ||= []).push(Number(p[2])); }
  for (const [fy, nums] of Object.entries(byFy)) { nums.sort((a, b) => a - b); for (let i = 1; i < nums.length; i++) if (nums[i] !== nums[i - 1] + 1) gaps.push(`${fy}: ${nums[i - 1]} → ${nums[i]}`); }
  const problems = {
    duplicate_bill_numbers: await q("SELECT invoice_number, COUNT(*) c FROM invoices GROUP BY invoice_number HAVING COUNT(*) > 1"),
    orders_with_two_bills: await q("SELECT order_id, COUNT(*) c FROM invoices GROUP BY order_id HAVING COUNT(*) > 1"),
    bill_number_gaps: gaps,
    negative_stock: await q("SELECT id, name, current_stock FROM products WHERE current_stock < 0"),
    stock_vs_ledger: await q(`SELECT p.id, p.name, p.current_stock, COALESCE(SUM(CASE WHEN l.direction='in' THEN l.qty ELSE -l.qty END),0) ledger FROM products p LEFT JOIN inventory_ledger l ON l.item_type='product' AND l.item_id=p.id GROUP BY p.id HAVING ABS(p.current_stock - COALESCE(SUM(CASE WHEN l.direction='in' THEN l.qty ELSE -l.qty END),0)) > 0.001`),
    overpaid: await q("SELECT id, grand_total, amount_paid FROM orders WHERE amount_paid - grand_total > 0.005"),
    payments_vs_orders: await q(`SELECT o.id FROM orders o LEFT JOIN (SELECT order_id, SUM(amount) s FROM payments WHERE voided=0 GROUP BY order_id) p ON p.order_id=o.id WHERE ABS(COALESCE(p.s,0) - o.amount_paid) > 0.005`),
    paid_with_balance: await q("SELECT id FROM orders WHERE state='paid' AND grand_total - amount_paid - amount_credited > 0.005"),
    credits_vs_orders: await q(`SELECT o.id FROM orders o LEFT JOIN (SELECT order_id, SUM(grand_total) s FROM credit_notes GROUP BY order_id) c ON c.order_id=o.id WHERE ABS(COALESCE(c.s,0) - o.amount_credited) > 0.005`),
    duplicate_credit_note_numbers: await q("SELECT number, COUNT(*) c FROM credit_notes GROUP BY number HAVING COUNT(*) > 1"),
    billed_but_cancelled: await q("SELECT o.id FROM orders o JOIN invoices i ON i.order_id=o.id WHERE o.state='cancelled'"),
  };
  await c.query("COMMIT");
  const bad = Object.entries(problems).filter(([, v]) => v.length);
  if (bad.length) report[`${b.name || b.id} (${b.id})`] = Object.fromEntries(bad);
}
await c.end();
const ok = Object.keys(report).length === 0;
console.log(JSON.stringify({ ok, businesses_checked: businesses.length, problems: report }, null, 2));
process.exit(ok ? 0 : 3);
