import { many, one, exec, tx, scalar, withoutBusiness, setTestBusiness } from "@/lib/sql";
import { upsertBusinessProfile } from "@/lib/db";
import type { Actor } from "@/lib/authz";

export const TELIX = "b-telix";
export const owner: Actor = { id: "u-owner", name: "Ramesh (owner)", email: "owner@telix.test", role: "owner", businessId: TELIX };
export const manager: Actor = { id: "u-mgr", name: "Sunita (manager)", email: "mgr@telix.test", role: "manager", businessId: TELIX };
export const staff: Actor = { id: "u-staff", name: "Vikram (staff)", email: "staff@telix.test", role: "staff", businessId: TELIX };

/** A small trading business: three stocked products, two buyers, regular GST in Maharashtra. */
export async function seedPilotBusiness() {
  await withoutBusiness(async () => {
    await exec("INSERT INTO businesses (id, name) VALUES (?, 'Telix Traders') ON CONFLICT DO NOTHING", [TELIX]);
    for (const a of [owner, manager, staff]) {
      await exec("INSERT INTO users (id, name, email, password_hash) VALUES (?, ?, ?, 'x') ON CONFLICT DO NOTHING", [a.id, a.name, a.email]);
      await exec("INSERT INTO memberships (user_id, business_id, role) VALUES (?, ?, ?) ON CONFLICT DO NOTHING", [a.id, TELIX, a.role]);
    }
  });
  setTestBusiness(TELIX);
  await exec("INSERT INTO business_profile (company_name) VALUES ('Telix Traders') ON CONFLICT DO NOTHING");
  await upsertBusinessProfile({ company_name: "Telix Traders", gstin: "27AAPFU0939F1ZV", state: "Maharashtra", gst_registration: "regular", template: "retail_delivery", capabilities: JSON.stringify({ confirm_step: true, production: false, purchases: true, delivery: true, credit: true, treds: false }) } as never);
  const p = (...a: unknown[]) => exec("INSERT INTO products (id, name, unit, price, hsn_code, gst_rate, track_stock, current_stock) VALUES (?, ?, ?, ?, ?, ?, 1, 0) ON CONFLICT DO NOTHING", a);
  await p("sku-tape", "BOPP Tape 48mm", "roll", 42, "3919", 18);
  await p("sku-box", "5-Ply Box Medium", "piece", 28, "4819", 18);
  await p("sku-film", "Stretch Film 18in", "roll", 310, "3920", 18);
  const c = (...a: unknown[]) => exec("INSERT INTO customers (id, name, phone, gstin) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING", a);
  await c("c-hfl", "Hindustan Foods Pvt Ltd", "9820012345", "27AAPFU0939F1ZV");
  await c("c-ka", "Bengaluru Packaging", "9845012345", "29AAGCB7383J1Z4");
}
