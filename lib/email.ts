/* Email through Resend (https://resend.com). Needs RESEND_API_KEY and MUNSHIJI_EMAIL_FROM
   (an address on a domain verified in Resend, e.g. "Munshiji <hello@munshiji.in>").
   Without a key nothing is sent: in development the message is printed; everything is logged in outbound_messages. */
import { exec, withoutBusiness } from "./sql";

/** The sender address. Common setting names are accepted. With only an API key, Resend's test sender is used:
    it delivers only to the email address that owns the Resend account, so set a verified domain for real use. */
export const TEST_SENDER = "Munshiji <onboarding@resend.dev>";
export const emailFrom = () => (process.env.MUNSHIJI_EMAIL_FROM || process.env.RESEND_FROM || process.env.EMAIL_FROM || (process.env.RESEND_API_KEY ? TEST_SENDER : "")).trim();
export const emailConfigured = () => !!process.env.RESEND_API_KEY;
export function emailStatus() {
  const from = emailFrom();
  return { configured: emailConfigured(), from, test_sender: from === TEST_SENDER,
    problem: !process.env.RESEND_API_KEY ? "RESEND_API_KEY is not set on the server, so no email is sent." : from === TEST_SENDER ? "No sender address is set, so Resend's test sender is used. It only delivers to the email that owns your Resend account. Set MUNSHIJI_EMAIL_FROM to an address on a domain verified in Resend." : "" };
}
export const appUrl = () => (process.env.NEXTAUTH_URL || "http://localhost:3000").replace(/\/$/, "");

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** A plain, readable email with one button. */
export function layout(heading: string, lines: string[], button: { label: string; url: string }, footnote: string) {
  const html = `<!doctype html><html><body style="margin:0;background:#F3F4F3;font-family:Arial,sans-serif;color:#18201C">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" style="max-width:520px;background:#fff;border-radius:16px;border:1px solid #E6E8E6">
<tr><td style="padding:28px 28px 8px;font-size:22px;font-weight:bold;color:#05362A">Munshiji</td></tr>
<tr><td style="padding:8px 28px 0;font-size:20px;font-weight:bold">${esc(heading)}</td></tr>
${lines.map((l) => `<tr><td style="padding:12px 28px 0;font-size:16px;line-height:1.5;color:#4B5550">${esc(l)}</td></tr>`).join("")}
<tr><td style="padding:24px 28px"><a href="${esc(button.url)}" style="display:inline-block;background:#1E7F47;color:#fff;text-decoration:none;font-weight:bold;font-size:16px;padding:14px 24px;border-radius:999px">${esc(button.label)}</a></td></tr>
<tr><td style="padding:0 28px 24px;font-size:13px;line-height:1.5;color:#6B746F">${esc(footnote)}<br>If the button doesn't work, copy this link: ${esc(button.url)}</td></tr>
</table></td></tr></table></body></html>`;
  const text = `${heading}\n\n${lines.join("\n\n")}\n\n${button.label}: ${button.url}\n\n${footnote}`;
  return { html, text };
}

export async function sendEmail(to: string, subject: string, body: { html: string; text: string }, kind: string): Promise<{ sent: boolean; id?: string; error?: string }> {
  const log = (status: string, id = "", error = "") => withoutBusiness(() => exec("INSERT INTO outbound_messages (channel, recipient, kind, status, provider_id, error) VALUES ('email', ?, ?, ?, ?, ?)", [to, kind, status, id, error.slice(0, 300)])).catch(() => {});
  if (!emailConfigured()) {
    if (process.env.NODE_ENV !== "production") console.info(`[munshiji] email not sent (RESEND_API_KEY not set): ${kind} to ${to}\n${body.text}`);
    await log("skipped", "", "RESEND_API_KEY is not set on the server");
    return { sent: false, error: "Email is not set up on this server." };
  }
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json", "Idempotency-Key": `${kind}-${to}-${Date.now()}` },
      body: JSON.stringify({ from: emailFrom(), to: [to], subject, html: body.html, text: body.text }),
      signal: AbortSignal.timeout(10_000),
    });
    const d = (await r.json().catch(() => ({}))) as { id?: string; message?: string; name?: string; error?: { message?: string } };
    const why = d.message || d.error?.message || d.name;
    if (!r.ok) { const e = `Resend ${r.status}${why ? `: ${why}` : ""}`; await log("failed", "", e); return { sent: false, error: e }; }
    await log("sent", d.id || "");
    return { sent: true, id: d.id };
  } catch (e) {
    const e2 = `Couldn't reach Resend: ${String((e as Error).message || e)}`;
    await log("failed", "", e2);
    return { sent: false, error: e2 };
  }
}
