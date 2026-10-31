/* People's rights over their data (India's Digital Personal Data Protection Act, 2023) and business data portability.
   - Anyone can download what Munshiji holds about them.
   - Owners can download all of their business's data.
   - Deleting an account erases the person's identity at once. A business's tax records (bills, credit notes,
     payments) are kept for the period GST law requires (CGST Act s.36), which the DPDP Act allows; a business
     that loses its last member is closed, and its records are purged once that period has passed (see PILOT.md). */
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { one, many, exec, tx, withBusiness, withoutBusiness } from "../sql";
import { audit } from "../audit";
import type { Actor } from "../authz";
import { badRequest, conflict, forbidden } from "../errors";

export const TERMS_VERSION = "2026-10-draft1";
const G = <T,>(fn: () => Promise<T>) => withoutBusiness(fn);

const BUSINESS_TABLES = ["business_profile", "customers", "products", "orders", "order_items", "invoices", "credit_notes", "credit_note_items", "payments",
  "suppliers", "raw_materials", "purchase_orders", "purchase_items", "purchase_receipts", "purchase_receipt_items", "inventory_ledger", "bom", "audit_log", "inbound_messages"] as const;

/** Everything in the current business (Row-Level Security limits it to this business). */
export async function exportBusiness(actor: Actor) {
  const out: Record<string, unknown> = {
    format: "munshiji-business-export", version: 1, exported_at: new Date().toISOString(), business_id: actor.businessId, exported_by: actor.email,
    team: await G(() => many("SELECT u.name, u.email, m.role, m.active, m.created_at FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.business_id = ? ORDER BY m.created_at", [actor.businessId])),
  };
  for (const t of BUSINESS_TABLES) out[t] = await many(`SELECT * FROM ${t}`);
  await audit(actor, "data.export_business", "business", actor.businessId);
  return out;
}

/** Everything Munshiji holds about the signed-in person, across their businesses. */
export async function exportMe(userId: string) {
  const user = await G(() => one("SELECT id, name, email, phone, phone_pending, email_verified_at, phone_verified_at, terms_version, terms_accepted_at, created_at, last_login FROM users WHERE id = ?", [userId]));
  const memberships = await G(() => many<{ business_id: string; name: string; role: string; active: number; created_at: string }>("SELECT m.business_id, b.name, m.role, m.active, m.created_at FROM memberships m JOIN businesses b ON b.id = m.business_id WHERE m.user_id = ?", [userId]));
  const activity: Record<string, unknown[]> = {};
  for (const m of memberships) activity[m.name || m.business_id] = await withBusiness(m.business_id, () => many("SELECT action, entity_type, entity_id, details, created_at FROM audit_log WHERE user_id = ? ORDER BY id", [userId]));
  const messages = await G(() => many("SELECT channel, kind, status, created_at FROM outbound_messages WHERE recipient = (SELECT email FROM users WHERE id = ?) OR recipient = (SELECT phone FROM users WHERE id = ?) ORDER BY id", [userId, userId]));
  return { format: "munshiji-personal-data", version: 1, exported_at: new Date().toISOString(), you: user, businesses: memberships, your_activity: activity, messages_sent_to_you: messages,
    note: "Orders, bills and customer records belong to each business you work in; ask its owner for a business export." };
}

/** Deletes the signed-in person's account. Requires the password and the word DELETE. */
export async function deleteAccount(userId: string, password: string, confirm: string) {
  if (confirm !== "DELETE") throw badRequest("Type DELETE to confirm.");
  const u = await G(() => one<{ password_hash: string; name: string; email: string }>("SELECT password_hash, name, email FROM users WHERE id = ? AND deleted_at IS NULL", [userId]));
  if (!u || !(await bcrypt.compare(password || "", u.password_hash))) throw forbidden("Your password is not correct.");
  const mine = await G(() => many<{ business_id: string; name: string; role: string; owners: number; members: number }>(
    `SELECT m.business_id, b.name, m.role,
       (SELECT COUNT(*) FROM memberships x WHERE x.business_id = m.business_id AND x.role = 'owner' AND x.active = 1) owners,
       (SELECT COUNT(*) FROM memberships x WHERE x.business_id = m.business_id AND x.active = 1) members
     FROM memberships m JOIN businesses b ON b.id = m.business_id WHERE m.user_id = ? AND m.active = 1`, [userId]));
  const blocking = mine.filter((b) => b.role === "owner" && b.owners <= 1 && b.members > 1);
  if (blocking.length) throw conflict(`You're the only owner of ${blocking.map((b) => b.name || "a business").join(", ")}. Make someone else an owner first (Settings → Team), so your team isn't left without one.`);
  const closing = mine.filter((b) => b.members <= 1).map((b) => b.business_id);
  await G(() => tx(async () => {
    for (const b of closing) await exec("UPDATE businesses SET closed_at = now() WHERE id = ?", [b]);
    await exec("UPDATE memberships SET active = 0 WHERE user_id = ?", [userId]);
    await exec("DELETE FROM user_tokens WHERE user_id = ?", [userId]);
    await exec(`UPDATE users SET name = 'Deleted user', email = ?, phone = '', phone_pending = '', phone_verified_at = NULL, password_hash = ?,
      active = 0, deleted_at = now(), session_version = session_version + 1 WHERE id = ?`, [`deleted+${crypto.randomBytes(6).toString("hex")}@invalid.munshiji`, `!${crypto.randomBytes(24).toString("hex")}`, userId]);
  }));
  for (const m of mine) await withBusiness(m.business_id, async () => {
    await exec("UPDATE audit_log SET user_name = 'Deleted user' WHERE user_id = ?", [userId]); // keep what happened, not who it was
    await audit({ id: "system", name: "Munshiji", email: "", role: "owner", businessId: m.business_id }, "user.deleted", "user", userId, { business_closed: closing.includes(m.business_id) });
  });
  return { ok: true, businesses_closed: closing.length };
}

export async function recordConsent(userId: string) {
  await G(() => exec("UPDATE users SET terms_version = ?, terms_accepted_at = now() WHERE id = ?", [TERMS_VERSION, userId]));
}
