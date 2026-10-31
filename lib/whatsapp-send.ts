/* Replies from the Munshiji number through the WhatsApp Cloud API. Only ever a reply to someone who just messaged us
   (inside WhatsApp's 24-hour customer-service window), so no message templates are needed.
   Needs WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID; WHATSAPP_GRAPH_VERSION defaults to v23.0. */
import { one, exec, withoutBusiness } from "./sql";

export const whatsappSendConfigured = () => !!process.env.WHATSAPP_ACCESS_TOKEN && !!process.env.WHATSAPP_PHONE_NUMBER_ID;

export async function sendWhatsAppText(to: string, body: string, kind: string): Promise<{ sent: boolean; error?: string }> {
  const log = (status: string, id = "", error = "") => withoutBusiness(() => exec("INSERT INTO outbound_messages (channel, recipient, kind, status, provider_id, error) VALUES ('whatsapp', ?, ?, ?, ?, ?)", [to, kind, status, id, error.slice(0, 300)])).catch(() => {});
  if (!whatsappSendConfigured()) { await log("skipped", "", "WhatsApp sending not set up"); return { sent: false, error: "not configured" }; }
  try {
    const v = process.env.WHATSAPP_GRAPH_VERSION || "v23.0";
    const r = await fetch(`https://graph.facebook.com/${v}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", to, type: "text", text: { preview_url: false, body } }),
      signal: AbortSignal.timeout(10_000),
    });
    const d = (await r.json().catch(() => ({}))) as { messages?: { id: string }[]; error?: { message?: string } };
    if (!r.ok) { await log("failed", "", d.error?.message || `HTTP ${r.status}`); return { sent: false, error: d.error?.message }; }
    await log("sent", d.messages?.[0]?.id || "");
    return { sent: true };
  } catch (e) { await log("failed", "", String((e as Error).message || e)); return { sent: false, error: "unreachable" }; }
}

/** At most one "this number isn't linked" reply per number per day, so the bot can't be used to spam anyone. */
export async function mayReplyToStranger(to: string) {
  const recent = await withoutBusiness(() => one("SELECT 1 FROM outbound_messages WHERE channel = 'whatsapp' AND recipient = ? AND kind = 'not_linked' AND created_at > now() - interval '1 day'", [to]));
  return !recent;
}
