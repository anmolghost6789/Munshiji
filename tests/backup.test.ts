/* Disaster drill on Postgres: back up while in use, lose everything, restore, verify, keep working. */
import { describe, it, expect, beforeAll } from "vitest";
import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { many, one, exec, closePool } from "@/lib/sql";
import { createOrder, advanceOrder } from "@/lib/core/orders";
import { createReceipt } from "@/lib/core/inventory";
import { recordPayment } from "@/lib/core/money";
import { owner, manager, staff, seedPilotBusiness } from "./helpers";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mj-bk-"));
const env = (admin = false) => ({ ...process.env, MUNSHIJI_BACKUP_DIR: dir, ...(admin ? { DATABASE_URL: process.env.TEST_ADMIN_DATABASE_URL, MUNSHIJI_APP_ROLE: "munshiji_app" } : {}) });
const run = (script: string, ...args: string[]) => { try { return { code: 0, out: JSON.parse(execFileSync("node", [`scripts/${script}`, ...args], { env: env(script !== "verify.mjs"), encoding: "utf8" })) }; } catch (e) { const x = e as { status: number; stdout: string; stderr: string }; return { code: x.status, out: x.stdout || x.stderr }; } };
const snapshot = async () => ({ orders: await many("SELECT id, state, amount_paid FROM orders ORDER BY id"), bills: await many("SELECT invoice_number FROM invoices ORDER BY invoice_number"), stock: await many("SELECT id, current_stock FROM products ORDER BY id") });
async function billed(key: string) {
  const { order } = await createOrder({ customer: { id: "c-ka" }, items: [{ product_id: "sku-tape", qty: 10 }], confirm_duplicate: true }, staff, key);
  for (const s of ["confirmed", "preparing", "dispatched", "delivered"]) await advanceOrder(order.id, s, staff);
  return advanceOrder(order.id, "invoiced", manager);
}
beforeAll(async () => { await seedPilotBusiness(); await createReceipt({ supplier_name: "Shree", bill_number: "B1", items: [{ item_id: "sku-tape", qty: 1000, rate: 30 }] }, owner); });

describe("backup and recovery (Postgres)", () => {
  it("backs up while in use, survives losing the database, and continues bill numbering", async () => {
    const a = await billed("bk-1"); await billed("bk-2");
    await recordPayment(a.id, { amount: 100 }, manager, "bk-pay");
    expect(run("verify.mjs").out.ok).toBe(true);
    const b = run("backup.mjs");
    expect(b.code).toBe(0);
    const before = await snapshot();
    await billed("bk-3");                                   // work after the backup
    await closePool();
    execFileSync("psql", [process.env.TEST_ADMIN_DATABASE_URL!, "-q", "-c", "DROP SCHEMA public CASCADE; CREATE SCHEMA public; GRANT USAGE ON SCHEMA public TO munshiji_app;"]); // disaster
    expect(run("restore.mjs", b.out.backup).code).toBe(1); // needs --yes
    expect(run("restore.mjs", b.out.backup, "--yes").code).toBe(0);
    expect(await snapshot()).toEqual(before);
    expect(run("verify.mjs").out.ok).toBe(true);
    const next = await billed("bk-4");
    const fy = (await one<{ period: string }>("SELECT period FROM counters WHERE name='invoice'"))!.period;
    expect(next.invoice_number).toBe(`INV/${fy}/0003`);
  });
  it("refuses to restore a file that isn't a backup", () => {
    const bad = path.join(dir, "garbage.dump"); fs.writeFileSync(bad, "garbage");
    expect(run("restore.mjs", bad, "--yes").code).not.toBe(0);
  });
  it("the health check catches stock changed outside Munshiji", async () => {
    await exec("UPDATE products SET current_stock = current_stock + 5 WHERE id = 'sku-tape'");
    const v = run("verify.mjs");
    expect(v.code).toBe(3);
    expect(JSON.stringify(v.out)).toMatch(/stock_vs_ledger/);
  });
});
