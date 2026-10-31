import { route } from "@/lib/api";
import { many, withoutBusiness } from "@/lib/sql";
import { emailStatus, sendEmail, layout, appUrl } from "@/lib/email";

/** Owner: is email set up, and what happened to recent emails to this business's people? */
export const GET = route("settings.edit", async (_req, actor) => {
  const recent = await withoutBusiness(() => many(
    `SELECT recipient, kind, status, error, created_at FROM outbound_messages WHERE channel = 'email' AND recipient IN (
       SELECT u.email FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.business_id = ?
       UNION SELECT email FROM invites WHERE business_id = ?) ORDER BY id DESC LIMIT 10`, [actor.businessId, actor.businessId]));
  return { ...emailStatus(), recent };
});
/** Owner: send a test email to yourself and see exactly what Resend says. */
export const POST = route("settings.edit", async (_req, actor) => {
  const r = await sendEmail(actor.email, "Munshiji test email", layout("Email is working", [`Namaste ${actor.name}, this is a test from Munshiji.`, "If you can read this, password resets, confirmations and invites will reach your team."], { label: "Open Munshiji", url: appUrl() }, "You asked for this test from Settings."), "test");
  return { ...r, to: actor.email, ...emailStatus() };
});
