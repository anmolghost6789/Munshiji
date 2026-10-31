/* Businesses, memberships and invitations.
   - A user is a person (one login). A membership gives them a role in one business; people can belong to many.
   - Invitations are links: a random token shown once, stored only as a SHA-256 hash, single-use, expiring.
   - Owners manage roles in their own business only; they never touch a person's password or other businesses. */
import crypto from "crypto";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { one, many, exec, tx, withBusiness, withoutBusiness } from "../sql";
import { audit } from "../audit";
import type { Actor, Role } from "../authz";
import { badRequest, conflict, forbidden, notFound } from "../errors";
import { sendEmail, layout, appUrl } from "../email";

export const MIN_PASSWORD = 8;
const INVITE_DAYS = 7;
const newId = (p: string) => `${p}-${crypto.randomBytes(8).toString("hex")}`;
const hashToken = (t: string) => crypto.createHash("sha256").update(t).digest("hex");
const normPhone = (p?: string) => { let d = (p || "").replace(/\D/g, ""); if (d.length === 10) d = `91${d}`; return d; };

/* ── Businesses ── */
export async function createBusiness(name: string, ownerUserId: string): Promise<string> {
  const id = newId("b");
  await withoutBusiness(() => tx(async () => {
    await exec("INSERT INTO businesses (id, name) VALUES (?, ?)", [id, name]);
    await exec("INSERT INTO memberships (user_id, business_id, role) VALUES (?, ?, 'owner')", [ownerUserId, id]);
    await exec("UPDATE users SET last_business_id = ? WHERE id = ?", [id, ownerUserId]); // open the new business next time
  }));
  await withBusiness(id, async () => {
    await exec("INSERT INTO business_profile (company_name) VALUES (?)", [name]);
    const u = await one<{ name: string; email: string }>("SELECT name, email FROM users WHERE id = ?", [ownerUserId]);
    await audit({ id: ownerUserId, name: u?.name || "", email: u?.email || "", role: "owner", businessId: id }, "business.create", "business", id, { name });
  });
  return id;
}

export async function myBusinesses(userId: string) {
  return withoutBusiness(() => many<{ id: string; name: string; role: Role }>(
    `SELECT b.id, b.name, m.role FROM memberships m JOIN businesses b ON b.id = m.business_id
     WHERE m.user_id = ? AND m.active = 1 ORDER BY m.created_at, b.created_at`, [userId]));
}

/** The business a request acts for: the preferred one if the user is an active member, else their first. */
/** The business a request acts for: this browser's choice if still valid, else the business the person
    last worked in, else their first. Membership is always re-checked. */
export async function activeMembership(userId: string, preferred?: string | null) {
  const list = await myBusinesses(userId);
  if (!list.length) return null;
  const byCookie = list.find((b) => b.id === preferred);
  if (byCookie) return byCookie;
  const last = await withoutBusiness(() => one<{ last_business_id: string }>("SELECT last_business_id FROM users WHERE id = ?", [userId]));
  return list.find((b) => b.id === last?.last_business_id) || list[0];
}
export async function rememberBusiness(userId: string, businessId: string) {
  await withoutBusiness(() => exec("UPDATE users SET last_business_id = ? WHERE id = ?", [businessId, userId]));
}

/* ── Sign-up ── */
export const SignupInput = z.object({
  name: z.string().trim().min(2, "Please enter your name.").max(80),
  email: z.string().trim().toLowerCase().email("Please enter a valid email."),
  password: z.string().min(MIN_PASSWORD, `Password must be at least ${MIN_PASSWORD} characters.`).max(200),
  business_name: z.string().trim().max(120).optional(),
  join: z.boolean().optional(),
});
export async function signup(raw: unknown) {
  const s = SignupInput.parse(raw);
  const hash = await bcrypt.hash(s.password, 12);
  const id = newId("u");
  await withoutBusiness(() => tx(async () => {
    if (await one("SELECT 1 FROM users WHERE email = ?", [s.email])) throw conflict("An account with this email already exists. Sign in instead.");
    await exec("INSERT INTO users (id, name, email, password_hash, last_login) VALUES (?, ?, ?, ?, now())", [id, s.name, s.email, hash]);
  }));
  if (s.join) { // "Join my team": an account first, then a code or a request to join
    const { sendVerification } = await import("./accounts");
    await sendVerification(id).catch(() => {});
    return { id, name: s.name, email: s.email, businessId: "" };
  }
  const businessId = await createBusiness(s.business_name || "", id);
  const { sendVerification } = await import("./accounts");
  await sendVerification(id).catch(() => {}); // a failed email never blocks sign-up
  return { id, name: s.name, email: s.email, businessId };
}

/* ── Invitations ── */
export const InviteInput = z.object({
  email: z.union([z.string().trim().toLowerCase().email("Enter a valid email"), z.literal("")]).default(""), // optional: owners often only have a phone number
  role: z.enum(["owner", "manager", "staff"]),
  phone: z.string().trim().max(20).optional(),
});
export async function createInvite(raw: unknown, actor: Actor) {
  const v = InviteInput.parse(raw);
  if (v.email) {
    const member = await withoutBusiness(() => one(`SELECT 1 FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.business_id = ? AND u.email = ? AND m.active = 1`, [actor.businessId, v.email]));
    if (member) throw conflict("This person is already on your team.");
  }
  const token = crypto.randomBytes(32).toString("base64url");
  const biz = await withoutBusiness(() => one<{ name: string }>("SELECT name FROM businesses WHERE id = ?", [actor.businessId]));
  const code = newInviteCode(biz?.name || "");
  const id = newId("inv");
  await withoutBusiness(() => tx(async () => {
    if (v.email) await exec("UPDATE invites SET revoked = 1 WHERE business_id = ? AND email = ? AND accepted_at IS NULL", [actor.businessId, v.email]); // one live invite per email
    await exec(`INSERT INTO invites (id, business_id, email, role, phone, token_hash, code_hash, expires_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, now() + interval '${INVITE_DAYS} days', ?)`,
      [id, actor.businessId, v.email, v.role, normPhone(v.phone), hashToken(token), hashToken(normCode(code)), actor.id]);
  }));
  const url = `${appUrl()}/invite/${token}`;
  const mail = !v.email ? { sent: false } : await sendEmail(v.email, `${actor.name} invited you to ${biz?.name || "their business"} on Munshiji`,
    layout(`Join ${biz?.name || "the team"} on Munshiji`, [`${actor.name} has invited you to join as ${v.role === "owner" ? "an owner" : v.role === "manager" ? "a manager" : "staff"}.`, "Munshiji keeps orders, GST bills, stock and payments in one place."], { label: "Join the team", url }, `The link works once and expires in ${INVITE_DAYS} days.`), "invite");
  await audit(actor, "invite.create", "invite", id, { email: v.email, role: v.role, emailed: mail.sent });
  return { id, token, code, path: `/invite/${token}`, expires_in_days: INVITE_DAYS, emailed: mail.sent };
}

export async function revokeInvite(inviteId: string, actor: Actor) {
  const n = await withoutBusiness(() => exec("UPDATE invites SET revoked = 1 WHERE id = ? AND business_id = ? AND accepted_at IS NULL", [inviteId, actor.businessId]));
  if (!n) throw notFound("Invite not found or already used.");
  await audit(actor, "invite.revoke", "invite", inviteId);
  return { ok: true };
}

/* Invite codes: short enough to read out or type ("KE-7Q4M-X2"). Letters and digits that can't be confused
   (no 0/O, 1/I/L). Stored only as a hash; single-use and expiring like links. */
const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
export const normCode = (c: string) => String(c || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
function newInviteCode(businessName: string) {
  const initials = (businessName.match(/[A-Za-z]+/g) || []).map((w) => w[0].toUpperCase()).join("").slice(0, 2).padEnd(2, "M");
  const r = Array.from(crypto.randomBytes(6), (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
  return `${initials}-${r.slice(0, 4)}-${r.slice(4)}`;
}
/** A live invite, by its link token or by its short code. */
async function liveInvite(tokenOrCode: string) {
  const t = String(tokenOrCode || "").trim();
  if (!t) return null;
  const isCode = t.length < 20;
  if (isCode && normCode(t).length !== 8) return null;
  return withoutBusiness(() => one<{ id: string; business_id: string; email: string; role: Role; phone: string; business_name: string }>(
    `SELECT i.id, i.business_id, i.email, i.role, i.phone, b.name as business_name FROM invites i JOIN businesses b ON b.id = i.business_id
     WHERE ${isCode ? "i.code_hash" : "i.token_hash"} = ? AND i.accepted_at IS NULL AND i.revoked = 0 AND i.expires_at > now()`, [hashToken(isCode ? normCode(t) : t)]));
}

/** Public: what an invite link is for (no secrets). */
export async function inviteInfo(token: string) {
  const inv = await liveInvite(token);
  if (!inv) return null;
  const hasAccount = inv.email ? !!(await withoutBusiness(() => one("SELECT 1 FROM users WHERE email = ?", [inv.email]))) : false;
  return { business_name: inv.business_name || "a business on Munshiji", role: inv.role, email: inv.email, has_account: hasAccount };
}

/** Accepts an invite: signs in an existing account (password check) or creates one. Single-use, even under races. */
export async function acceptInvite(token: string, creds: { email?: string; password?: string; name?: string; acceptTerms?: boolean }) {
  const inv = await liveInvite(token);
  if (!inv) throw badRequest("This invite link is not valid any more. Ask for a new one.");
  const email = (creds.email || "").trim().toLowerCase();
  if (inv.email && email !== inv.email) throw badRequest("Use the email address the invite was sent to.");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw badRequest("Please enter a valid email.");
  const password = creds.password || "";
  const existing = await withoutBusiness(() => one<{ id: string; name: string; email: string; password_hash: string; active: number }>("SELECT id, name, email, password_hash, active FROM users WHERE email = ?", [email]));
  let user: { id: string; name: string; email: string };
  if (existing) {
    if (!existing.active || !(await bcrypt.compare(password, existing.password_hash))) throw badRequest("Email or password is incorrect.");
    user = existing;
  } else {
    if (!creds.name || creds.name.trim().length < 2) throw badRequest("Please enter your name.");
    if (!creds.acceptTerms) throw badRequest("Please accept the Terms of Service and Privacy Policy to create your account.");
    if (password.length < MIN_PASSWORD) throw badRequest(`Password must be at least ${MIN_PASSWORD} characters.`);
    user = { id: newId("u"), name: creds.name.trim(), email };
    const hash = await bcrypt.hash(password, 12);
    await withoutBusiness(() => exec("INSERT INTO users (id, name, email, password_hash) VALUES (?, ?, ?, ?) ON CONFLICT (email) DO NOTHING", [user.id, user.name, user.email, hash]));
    const u = await withoutBusiness(() => one<{ id: string }>("SELECT id FROM users WHERE email = ?", [email]));
    user.id = u!.id;
  }
  await withoutBusiness(() => tx(async () => {
    const used = await exec("UPDATE invites SET accepted_at = now(), accepted_by = ? WHERE id = ? AND accepted_at IS NULL AND revoked = 0 AND expires_at > now()", [user.id, inv.id]);
    if (!used) throw badRequest("This invite link was just used. Ask for a new one.");
    await exec(`INSERT INTO memberships (user_id, business_id, role, active) VALUES (?, ?, ?, 1)
      ON CONFLICT (user_id, business_id) DO UPDATE SET role = EXCLUDED.role, active = 1`, [user.id, inv.business_id, inv.role]);
    if (inv.phone) await exec("UPDATE users SET phone_pending = ? WHERE id = ? AND phone = '' AND phone_pending = ''", [inv.phone, user.id]); // a suggestion until they link it
    await exec("UPDATE users SET last_login = now(), email_verified_at = COALESCE(email_verified_at, now()), last_business_id = ? WHERE id = ?", [inv.business_id, user.id]); // the invite reached this email; open that business
  }));
  await withBusiness(inv.business_id, () => audit({ ...user, role: inv.role, businessId: inv.business_id }, "invite.accept", "user", user.id, { role: inv.role }));
  return { ...user, businessId: inv.business_id };
}

/** A signed-in person (e.g. with no business yet) joins with an invite code or link. */
export async function joinWithInvite(userId: string, tokenOrCode: string) {
  const inv = await liveInvite(tokenOrCode);
  if (!inv) throw badRequest("That code isn't valid any more. Check it, or ask for a new one.");
  const u = (await withoutBusiness(() => one<{ id: string; name: string; email: string }>("SELECT id, name, email FROM users WHERE id = ?", [userId])))!;
  if (inv.email && inv.email !== u.email) throw badRequest("This invite is for a different email address. Ask the owner to send it to yours.");
  await withoutBusiness(() => tx(async () => {
    const used = await exec("UPDATE invites SET accepted_at = now(), accepted_by = ? WHERE id = ? AND accepted_at IS NULL AND revoked = 0 AND expires_at > now()", [u.id, inv.id]);
    if (!used) throw badRequest("That code was just used. Ask for a new one.");
    await exec(`INSERT INTO memberships (user_id, business_id, role, active) VALUES (?, ?, ?, 1) ON CONFLICT (user_id, business_id) DO UPDATE SET role = EXCLUDED.role, active = 1`, [u.id, inv.business_id, inv.role]);
    if (inv.phone) await exec("UPDATE users SET phone_pending = ? WHERE id = ? AND phone = '' AND phone_pending = ''", [inv.phone, u.id]);
    await exec("UPDATE users SET last_business_id = ? WHERE id = ?", [inv.business_id, u.id]);
  }));
  await withBusiness(inv.business_id, () => audit({ ...u, role: inv.role, businessId: inv.business_id }, "invite.accept", "user", u.id, { role: inv.role, by: "code" }));
  return { business_id: inv.business_id, business_name: inv.business_name, role: inv.role };
}

/* ── Team (current business only) ── */
export async function listTeam(actor: Actor) {
  return withoutBusiness(async () => ({
    members: await many(`SELECT u.id, u.name, u.email, u.phone, m.role, m.active, u.last_login FROM memberships m JOIN users u ON u.id = m.user_id
      WHERE m.business_id = ? ORDER BY m.active DESC, CASE m.role WHEN 'owner' THEN 0 WHEN 'manager' THEN 1 ELSE 2 END, u.name`, [actor.businessId]),
    invites: await many(`SELECT id, email, role, expires_at, created_at FROM invites WHERE business_id = ? AND accepted_at IS NULL AND revoked = 0 AND expires_at > now() ORDER BY created_at DESC`, [actor.businessId]),
  }));
}

export const MemberChange = z.object({ user_id: z.string().min(1), role: z.enum(["owner", "manager", "staff"]).optional(), active: z.boolean().optional() });
export async function changeMember(raw: unknown, actor: Actor) {
  const c = MemberChange.parse(raw);
  if (c.user_id === actor.id) throw badRequest("You can't change your own role or remove yourself.");
  await withoutBusiness(() => tx(async () => {
    await exec("SELECT pg_advisory_xact_lock(hashtext(?))", [`munshiji:team:${actor.businessId}`]);
    const m = await one<{ role: Role; active: number }>("SELECT role, active FROM memberships WHERE user_id = ? AND business_id = ?", [c.user_id, actor.businessId]);
    if (!m) throw notFound("This person isn't on your team.");
    const losingOwner = m.role === "owner" && m.active && ((c.role && c.role !== "owner") || c.active === false);
    if (losingOwner) {
      const owners = (await one<{ c: number }>("SELECT COUNT(*) c FROM memberships WHERE business_id = ? AND role = 'owner' AND active = 1", [actor.businessId]))!.c;
      if (owners <= 1) throw conflict("Every business needs at least one active owner.");
    }
    if (c.role) await exec("UPDATE memberships SET role = ? WHERE user_id = ? AND business_id = ?", [c.role, c.user_id, actor.businessId]);
    if (c.active !== undefined) await exec("UPDATE memberships SET active = ? WHERE user_id = ? AND business_id = ?", [c.active ? 1 : 0, c.user_id, actor.businessId]);
  }));
  await audit(actor, "member.change", "user", c.user_id, { role: c.role, active: c.active });
  return { ok: true };
}

/* ── Your own profile ── */
export const ProfileInput = z.object({ name: z.string().trim().min(2).max(80).optional() }); // phone numbers are linked, not typed: see accounts.ts
export async function updateProfile(userId: string, raw: unknown) {
  const p = ProfileInput.parse(raw);
  if (p.name) await withoutBusiness(() => exec("UPDATE users SET name = ? WHERE id = ?", [p.name, userId]));
  return { ok: true };
}
export async function changePassword(userId: string, current: string, next: string) {
  if (!next || next.length < MIN_PASSWORD) throw badRequest(`New password must be at least ${MIN_PASSWORD} characters.`);
  const u = await withoutBusiness(() => one<{ password_hash: string }>("SELECT password_hash FROM users WHERE id = ?", [userId]));
  if (!u || !(await bcrypt.compare(current || "", u.password_hash))) throw forbidden("Your current password is not correct.");
  const hash = await bcrypt.hash(next, 12);
  await withoutBusiness(() => exec("UPDATE users SET password_hash = ? WHERE id = ?", [hash, userId]));
  return { ok: true };
}
