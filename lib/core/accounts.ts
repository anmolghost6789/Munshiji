/* Password reset, email verification and WhatsApp number linking.
   Every secret is random, shown or sent once, stored only as a SHA-256 hash, single-use and short-lived.
   - Forgot password never reveals whether an email has an account.
   - Resetting a password signs the person out on every device (session_version).
   - A WhatsApp number counts only after its owner sends "LINK <code>" from that phone to the Munshiji number. */
import crypto from "crypto";
import bcrypt from "bcryptjs";
import { one, exec, tx, withoutBusiness } from "../sql";
import { badRequest, conflict } from "../errors";
import { sendEmail, layout, appUrl } from "../email";
import { isLocked, noteFailure } from "../login-guard";
import { MIN_PASSWORD } from "./tenancy";

type Purpose = "reset_password" | "verify_email" | "link_phone";
const sha = (s: string) => crypto.createHash("sha256").update(s).digest("hex");
const G = <T,>(fn: () => Promise<T>) => withoutBusiness(fn);

async function issue(userId: string, purpose: Purpose, minutes: number, secret = crypto.randomBytes(32).toString("base64url"), hashOf = secret) {
  await G(() => tx(async () => {
    await exec("UPDATE user_tokens SET used_at = now() WHERE user_id = ? AND purpose = ? AND used_at IS NULL", [userId, purpose]); // only the newest works
    await exec(`INSERT INTO user_tokens (id, user_id, purpose, token_hash, expires_at) VALUES (?, ?, ?, ?, now() + interval '${minutes} minutes')`,
      [`tok-${crypto.randomBytes(8).toString("hex")}`, userId, purpose, sha(hashOf)]);
  }));
  return secret;
}
/** Uses a token exactly once. Returns the user id, or null if it's wrong, used or expired. */
async function consume(hashOf: string, purpose: Purpose): Promise<string | null> {
  const r = await G(() => one<{ user_id: string }>(
    "UPDATE user_tokens SET used_at = now() WHERE token_hash = ? AND purpose = ? AND used_at IS NULL AND expires_at > now() RETURNING user_id", [sha(hashOf), purpose]));
  return r?.user_id ?? null;
}

/* ── Forgot / reset password ── */
export async function requestPasswordReset(emailRaw: string, ip = "unknown") {
  const email = String(emailRaw || "").trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw badRequest("Please enter a valid email.");
  const keys = [`reset:${email}`, `reset-ip:${ip}`];
  if (await G(() => isLocked(keys))) return { ok: true }; // same answer either way
  await G(() => noteFailure(keys)); // counts requests: 5 per 15 minutes
  const u = await G(() => one<{ id: string; name: string; active: number }>("SELECT id, name, active FROM users WHERE email = ?", [email]));
  if (u?.active) {
    const token = await issue(u.id, "reset_password", 60);
    const url = `${appUrl()}/reset/${token}`;
    await sendEmail(email, "Reset your Munshiji password", layout("Reset your password", [`Namaste ${u.name}, someone asked to reset the password for this email.`, "The link works once and expires in 1 hour."], { label: "Choose a new password", url }, "If this wasn't you, ignore this email; your password stays the same."), "reset_password");
  }
  return { ok: true }; // never reveals whether the email has an account
}

export async function resetPassword(token: string, password: string) {
  if (!password || password.length < MIN_PASSWORD) throw badRequest(`Password must be at least ${MIN_PASSWORD} characters.`);
  const userId = token && token.length >= 20 ? await consume(token, "reset_password") : null;
  if (!userId) throw badRequest("This reset link is not valid any more. Ask for a new one.");
  const hash = await bcrypt.hash(password, 12);
  await G(() => exec("UPDATE users SET password_hash = ?, session_version = session_version + 1, email_verified_at = COALESCE(email_verified_at, now()) WHERE id = ?", [hash, userId]));
  return { ok: true }; // every existing session is now signed out
}

/* ── Email verification ── */
export async function sendVerification(userId: string) {
  const u = await G(() => one<{ email: string; name: string; email_verified_at: string | null }>("SELECT email, name, email_verified_at FROM users WHERE id = ?", [userId]));
  if (!u || u.email_verified_at) return { sent: false, already: !!u?.email_verified_at };
  const token = await issue(userId, "verify_email", 60 * 24 * 3);
  const r = await sendEmail(u.email, "Confirm your email for Munshiji", layout("Confirm your email", [`Namaste ${u.name}, welcome to Munshiji.`, "Confirm this is your email so you can always get back into your account."], { label: "Confirm email", url: `${appUrl()}/verify/${token}` }, "The link expires in 3 days."), "verify_email");
  return { sent: r.sent, error: r.error };
}
export async function verifyEmail(token: string) {
  const userId = token && token.length >= 20 ? await consume(token, "verify_email") : null;
  if (!userId) throw badRequest("This confirmation link is not valid any more. Sign in and ask for a new one.");
  await G(() => exec("UPDATE users SET email_verified_at = COALESCE(email_verified_at, now()) WHERE id = ?", [userId]));
  return { ok: true };
}

/* ── WhatsApp number linking ── */
export const normWa = (p: string) => { let d = (p || "").replace(/\D/g, ""); if (d.length === 10) d = `91${d}`; if (d.length === 11 && d.startsWith("0")) d = `91${d.slice(1)}`; return d; };

/** Starts linking a number: returns the code to send from that phone. The number isn't used until it's linked. */
export async function startPhoneLink(userId: string, phoneRaw: string) {
  const phone = normWa(phoneRaw);
  if (!/^\d{11,15}$/.test(phone)) throw badRequest("Enter a WhatsApp number with country code, e.g. 98765 43210 or +91 98765 43210.");
  const taken = await G(() => one("SELECT 1 FROM users WHERE phone = ? AND id <> ?", [phone, userId]));
  if (taken) throw conflict("That number is already linked to another Munshiji account.");
  const code = String(crypto.randomInt(100000, 1000000));
  await G(() => exec("UPDATE users SET phone_pending = ? WHERE id = ?", [phone, userId]));
  await issue(userId, "link_phone", 30, code, `${phone}:${code}`);
  return { pending: phone, code, send_to: process.env.MUNSHIJI_WHATSAPP_NUMBER || "", message: `LINK ${code}` };
}

/** Called by the webhook when someone sends "LINK 123456": the sender's number proves they hold the phone. */
export async function completePhoneLink(fromPhone: string, code: string): Promise<{ ok: boolean; name?: string; reason?: string }> {
  const phone = normWa(fromPhone);
  const userId = await consume(`${phone}:${code}`, "link_phone");
  if (!userId) return { ok: false, reason: "That code is wrong or has expired. Open Munshiji → Settings → Your profile for a new one." };
  try {
    const u = await G(() => one<{ name: string }>("UPDATE users SET phone = ?, phone_verified_at = now(), phone_pending = '' WHERE id = ? AND phone_pending = ? RETURNING name", [phone, userId, phone]));
    return u ? { ok: true, name: u.name } : { ok: false, reason: "That code was for a different number." };
  } catch { return { ok: false, reason: "That number is already linked to another Munshiji account." }; }
}

export async function unlinkPhone(userId: string) {
  await G(() => exec("UPDATE users SET phone = '', phone_verified_at = NULL, phone_pending = '' WHERE id = ?", [userId]));
  return { ok: true };
}
