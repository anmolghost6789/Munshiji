/* Asking to join a team. The requester names the owner by phone or email; owners approve and pick the role.
   Privacy: the requester always sees the same "waiting" answer, whether or not that person uses Munshiji,
   so this can't be used to find out who runs which business. */
import crypto from "crypto";
import { one, many, exec, tx, withBusiness, withoutBusiness } from "../sql";
import { audit } from "../audit";
import type { Actor, Role } from "../authz";
import { badRequest, notFound, conflict } from "../errors";
import { sendEmail, layout, appUrl } from "../email";

const G = <T,>(fn: () => Promise<T>) => withoutBusiness(fn);
const newId = () => `jr-${crypto.randomBytes(8).toString("hex")}`;
function parseContact(raw: string) {
  const s = String(raw || "").trim().toLowerCase();
  if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s)) return { kind: "email" as const, value: s, shown: s };
  const d = s.replace(/\D/g, "").replace(/^(91|0)(?=\d{10}$)/, "");
  if (/^\d{10}$/.test(d)) return { kind: "phone" as const, value: d, shown: `${d.slice(0, 5)} ${d.slice(5)}` };
  return null;
}

export async function requestToJoin(userId: string, contactRaw: string) {
  const c = parseContact(contactRaw);
  if (!c) throw badRequest("Enter the owner's 10-digit phone number or email.");
  const me = (await G(() => one<{ id: string; name: string; email: string }>("SELECT id, name, email FROM users WHERE id = ?", [userId])))!;
  if (c.kind === "email" && c.value === me.email) throw badRequest("That's your own email. Enter the owner's phone or email.");
  const counts = await G(() => one<{ pending: number; today: number }>(`SELECT
      COUNT(DISTINCT contact) FILTER (WHERE status = 'pending')::int AS pending,
      COUNT(DISTINCT contact) FILTER (WHERE created_at > now() - interval '1 day')::int AS today FROM join_requests WHERE user_id = ?`, [userId]));
  if ((counts?.pending || 0) >= 5) throw conflict("You have 5 requests waiting. Cancel one, or wait for an answer.");
  if ((counts?.today || 0) >= 10) throw conflict("That's enough requests for today. Try again tomorrow.");
  // Businesses whose active owner has this phone or email (and that the requester isn't already part of)
  const owned = await G(() => many<{ business_id: string; business_name: string; owner_email: string; owner_name: string }>(
    `SELECT b.id AS business_id, b.name AS business_name, u.email AS owner_email, u.name AS owner_name
     FROM users u JOIN memberships m ON m.user_id = u.id AND m.role = 'owner' AND m.active = 1 JOIN businesses b ON b.id = m.business_id
     WHERE u.active = 1 AND b.closed_at IS NULL AND ${c.kind === "email" ? "u.email = ?" : "RIGHT(regexp_replace(u.phone, '\\D', '', 'g'), 10) = ?"}
       AND NOT EXISTS (SELECT 1 FROM memberships x WHERE x.user_id = ? AND x.business_id = b.id AND x.active = 1)`, [c.value, userId]));
  await G(() => tx(async () => {
    if (!owned.length) {
      if (!(await one("SELECT 1 FROM join_requests WHERE user_id = ? AND contact = ? AND status = 'pending'", [userId, c.shown])))
        await exec("INSERT INTO join_requests (id, business_id, user_id, contact) VALUES (?, NULL, ?, ?)", [newId(), userId, c.shown]);
    }
    for (const o of owned) await exec("INSERT INTO join_requests (id, business_id, user_id, contact) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING", [newId(), o.business_id, userId, c.shown]);
  }));
  for (const o of owned) {
    await sendEmail(o.owner_email, `${me.name} wants to join ${o.business_name} on Munshiji`,
      layout(`${me.name} wants to join your team`, [`${me.name} (${me.email}) asked to join ${o.business_name}.`, "Open Settings → Team to approve them and choose their role, or decline."], { label: "Open Munshiji", url: `${appUrl()}/dashboard` }, "If you don't know this person, decline the request."), "join_request").catch(() => {});
  }
  return { ok: true, message: `If ${c.shown} runs a business on Munshiji, they've been asked. You'll be let in as soon as they approve.` };
}

/** What the requester sees: one line per person they asked, never which business (or whether one) matched. */
export async function myJoinRequests(userId: string) {
  return G(() => many<{ contact: string; status: string; created_at: string }>(
    `SELECT contact, CASE WHEN bool_or(status = 'approved') THEN 'approved' WHEN bool_or(status = 'pending') THEN 'pending' WHEN bool_or(status = 'declined') THEN 'declined' ELSE 'cancelled' END AS status,
            MIN(created_at) AS created_at
     FROM join_requests WHERE user_id = ? AND created_at > now() - interval '30 days' GROUP BY contact HAVING bool_or(status <> 'cancelled') ORDER BY MIN(created_at) DESC`, [userId]));
}
export async function cancelJoinRequest(userId: string, contact: string) {
  await G(() => exec("UPDATE join_requests SET status = 'cancelled' WHERE user_id = ? AND contact = ? AND status = 'pending'", [userId, contact]));
  return { ok: true };
}

/** For owners: who's waiting to join this business. */
export async function pendingRequests(businessId: string) {
  return G(() => many<{ id: string; name: string; email: string; created_at: string }>(
    `SELECT r.id, u.name, u.email, r.created_at FROM join_requests r JOIN users u ON u.id = r.user_id
     WHERE r.business_id = ? AND r.status = 'pending' AND u.active = 1 ORDER BY r.created_at`, [businessId]));
}

export async function decideJoinRequest(actor: Actor, requestId: string, decision: "approve" | "decline", role: Role = "staff") {
  const r = await G(() => tx(async () => {
    const req = await one<{ id: string; user_id: string; status: string }>("SELECT id, user_id, status FROM join_requests WHERE id = ? AND business_id = ? FOR UPDATE", [requestId, actor.businessId]);
    if (!req) throw notFound("That request wasn't found.");
    if (req.status !== "pending") throw conflict("That request has already been answered.");
    await exec("UPDATE join_requests SET status = ?, role = ?, decided_by = ?, decided_at = now() WHERE id = ?", [decision === "approve" ? "approved" : "declined", decision === "approve" ? role : null, actor.id, req.id]);
    if (decision === "approve") {
      await exec(`INSERT INTO memberships (user_id, business_id, role, active) VALUES (?, ?, ?, 1) ON CONFLICT (user_id, business_id) DO UPDATE SET role = EXCLUDED.role, active = 1`, [req.user_id, actor.businessId, role]);
      await exec("UPDATE users SET last_business_id = ? WHERE id = ?", [actor.businessId, req.user_id]);
    }
    return req;
  }));
  const u = await G(() => one<{ name: string; email: string }>("SELECT name, email FROM users WHERE id = ?", [r.user_id]));
  const biz = await G(() => one<{ name: string }>("SELECT name FROM businesses WHERE id = ?", [actor.businessId]));
  if (u) await sendEmail(u.email, decision === "approve" ? `You've joined ${biz?.name} on Munshiji` : `Your request to join ${biz?.name}`,
    decision === "approve" ? layout(`Welcome to ${biz?.name}`, [`${actor.name} let you in as ${role}.`], { label: "Open Munshiji", url: `${appUrl()}/dashboard` }, "")
      : layout("Request declined", [`${actor.name} declined your request to join ${biz?.name}. If this is a mistake, ask them for an invite code.`], { label: "Open Munshiji", url: `${appUrl()}/dashboard` }, ""), "join_decision").catch(() => {});
  await withBusiness(actor.businessId, () => audit(actor, decision === "approve" ? "join.approve" : "join.decline", "user", r.user_id, { role: decision === "approve" ? role : undefined }));
  return { ok: true };
}
