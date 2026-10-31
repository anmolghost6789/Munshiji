/* WhatsApp: team members forward buyers' messages to the one Munshiji number.
   Each message becomes a DRAFT in the inbox; no order exists until a person approves it.
   Security: every webhook call must carry Meta's HMAC-SHA256 signature for our app secret;
   only active team members' numbers (or WHATSAPP_ALLOWED_SENDERS) are accepted. */
import crypto from "crypto";
import { many, one, exec, tx, withBusiness, withoutBusiness } from "./sql";
import { parseOrderMessage } from "./parse";

export function verifySignature(rawBody: string, header: string | null, secret = process.env.WHATSAPP_APP_SECRET || ""): boolean {
  if (!secret || !header?.startsWith("sha256=")) return false;
  const expected = Buffer.from(crypto.createHmac("sha256", secret).update(rawBody, "utf8").digest("hex"));
  const given = Buffer.from(header.slice(7));
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}

export interface InboundMsg { external_id: string; from: string; type: string; text: string; forwarded: boolean; timestamp: number; phone_number_id?: string }

/** Pulls messages out of a Cloud API webhook payload (ignores status updates and other events). */
export function extractMessages(payload: unknown): InboundMsg[] {
  const out: InboundMsg[] = [];
  const wantPhoneId = process.env.WHATSAPP_PHONE_NUMBER_ID || "";
  const entries = (payload as { entry?: unknown[] })?.entry;
  if (!Array.isArray(entries)) return out;
  for (const e of entries as { changes?: { value?: Record<string, unknown> }[] }[]) {
    for (const ch of e.changes || []) {
      const v = ch.value || {};
      const meta = v.metadata as { phone_number_id?: string } | undefined;
      if (wantPhoneId && meta?.phone_number_id !== wantPhoneId) continue; // not our number
      for (const m of (v.messages as Record<string, unknown>[] | undefined) || []) {
        const text = m.type === "text" ? String((m.text as { body?: string })?.body || "") : "";
        out.push({ external_id: String(m.id || ""), from: String(m.from || "").replace(/\D/g, ""), type: String(m.type || ""), text, forwarded: !!(m.context as { forwarded?: boolean } | undefined)?.forwarded, timestamp: Number(m.timestamp || 0), phone_number_id: meta?.phone_number_id || "" });
      }
    }
  }
  return out.filter((m) => m.external_id);
}

/** Which business a message belongs to: the business that owns the receiving number, or the sender's own business
    on a shared Munshiji number. Only active team members are accepted. */
export async function routeMessage(m: InboundMsg): Promise<{ businessId: string; userId: string } | null> {
  const last10 = (p: string) => p.replace(/\D/g, "").slice(-10);
  const members = await withoutBusiness(() => many<{ user_id: string; business_id: string; phone: string; wa: string }>(
    `SELECT u.id as user_id, m.business_id, u.phone, b.whatsapp_phone_number_id as wa FROM users u
     JOIN memberships m ON m.user_id = u.id AND m.active = 1 JOIN businesses b ON b.id = m.business_id
     WHERE u.active = 1 AND u.phone <> '' AND u.phone_verified_at IS NOT NULL ORDER BY m.created_at`)); // linked numbers only
  const mine = members.filter((x) => last10(x.phone) === last10(m.from));
  if (m.phone_number_id) {
    const owner = await withoutBusiness(() => one<{ id: string }>("SELECT id FROM businesses WHERE whatsapp_phone_number_id = ?", [m.phone_number_id]));
    if (owner) { const x = mine.find((y) => y.business_id === owner.id); return x ? { businessId: owner.id, userId: x.user_id } : null; }
  }
  return mine[0] ? { businessId: mine[0].business_id, userId: mine[0].user_id } : null;
}

/** Stores a message once, in its business (WhatsApp may deliver the same message more than once). */
export async function ingest(m: InboundMsg): Promise<{ id: string; status: string; duplicate: boolean; businessId?: string }> {
  const r = await routeMessage(m);
  if (!r) return { id: "", status: "ignored_sender", duplicate: false }; // not a team member: nothing is stored
  return withBusiness(r.businessId, () => tx(async () => {
    const existing = await one<{ id: string; status: string }>("SELECT id, status FROM inbound_messages WHERE external_id = ?", [m.external_id]);
    if (existing) return { ...existing, duplicate: true, businessId: r.businessId };
    const status = m.type !== "text" || !m.text.trim() ? "unsupported" : "received";
    const id = `wa-${crypto.randomBytes(8).toString("hex")}`;
    await exec("INSERT INTO inbound_messages (id, external_id, sender, sender_user_id, body, status, error) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [id, m.external_id, m.from, r.userId, m.text.slice(0, 5000), status, status === "unsupported" ? `Only text messages can be read (got ${m.type}).` : ""]);
    return { id, status, duplicate: false, businessId: r.businessId };
  }));
}

/** Reads a stored message into a draft order, as its business. Safe to call again ("Retry reading"). */
export async function processInbound(id: string, businessId: string): Promise<string> {
  return withBusiness(businessId, async () => {
    const row = await one<{ body: string; status: string }>("SELECT body, status FROM inbound_messages WHERE id = ?", [id]);
    if (!row || !["received", "parse_failed"].includes(row.status)) return row?.status || "missing";
    await exec("UPDATE inbound_messages SET status = 'reading', updated_at = now() WHERE id = ?", [id]);
    try {
      const draft = await parseOrderMessage(row.body);
      await exec("UPDATE inbound_messages SET status = 'needs_approval', parsed_json = ?, error = '', updated_at = now() WHERE id = ?", [JSON.stringify(draft), id]);
      return "needs_approval";
    } catch (e) {
      await exec("UPDATE inbound_messages SET status = 'parse_failed', error = ?, updated_at = now() WHERE id = ?", [String((e as Error).message || e).slice(0, 300), id]);
      return "parse_failed";
    }
  });
}

export async function inbox() {
  return (await many(`SELECT m.id, m.sender, m.body, m.status, m.parsed_json, m.error, m.order_id, m.received_at, u.name as sender_name
    FROM inbound_messages m LEFT JOIN users u ON u.id = m.sender_user_id
    WHERE m.status IN ('received','reading','needs_approval','parse_failed','unsupported') ORDER BY m.received_at DESC LIMIT 100`));
}
