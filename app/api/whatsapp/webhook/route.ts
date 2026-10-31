import { waitUntil } from "@vercel/functions";
import { NextRequest, NextResponse } from "next/server";
import { verifySignature, extractMessages, ingest, processInbound } from "@/lib/whatsapp";
import { completePhoneLink } from "@/lib/core/accounts";
import { sendWhatsAppText, mayReplyToStranger } from "@/lib/whatsapp-send";

export const dynamic = "force-dynamic";

/** Meta's one-time verification when the webhook is registered. */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const token = process.env.WHATSAPP_VERIFY_TOKEN || "";
  if (token && sp.get("hub.mode") === "subscribe" && sp.get("hub.verify_token") === token) return new Response(sp.get("hub.challenge") || "", { status: 200 });
  return new Response("Forbidden", { status: 403 });
}

/** Incoming messages. Answers fast (Meta retries slow webhooks); reading happens right after. */
export async function POST(req: NextRequest) {
  const raw = await req.text();
  if (!verifySignature(raw, req.headers.get("x-hub-signature-256"))) return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  let payload: unknown;
  try { payload = JSON.parse(raw); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const toRead: { id: string; businessId: string }[] = [];
  const replies: Promise<unknown>[] = [];
  for (const m of extractMessages(payload)) {
    // "LINK 123456" from a phone proves the sender holds it; that's how a number gets linked to a person.
    const link = m.type === "text" ? m.text.match(/^\s*LINK\s+(\d{6})\s*$/i) : null;
    if (link) {
      const r = await completePhoneLink(m.from, link[1]);
      replies.push(sendWhatsAppText(m.from, r.ok ? `Linked ✓ ${r.name}, forward buyers' orders to this number and Munshiji will make drafts for you.` : r.reason!, "link_result"));
      continue;
    }
    const r = await ingest(m);
    if (r.duplicate) continue;
    if (r.status === "ignored_sender") {
      if (await mayReplyToStranger(m.from)) replies.push(sendWhatsAppText(m.from, "This number isn't linked to a Munshiji team yet. Open Munshiji → Settings → Your profile to link it, then forward the order again.", "not_linked"));
      continue;
    }
    if (r.status === "unsupported") { replies.push(sendWhatsAppText(m.from, "Munshiji can read text messages only. Please forward the order as text.", "unsupported")); continue; }
    if (r.status === "received" && r.businessId) {
      toRead.push({ id: r.id, businessId: r.businessId });
      replies.push(sendWhatsAppText(m.from, "Mila ✓ Munshiji is reading it. The draft will be in Orders → From WhatsApp for review.", "ack"));
    }
  }
  for (const p of replies) waitUntil(p.catch(() => {}));
  // Keep reading after replying: Vercel keeps the function alive via waitUntil; on a normal server the promise simply runs.
  for (const m of toRead) waitUntil(processInbound(m.id, m.businessId).catch((e) => console.error("[munshiji] WhatsApp read failed", m.id, e)));
  return NextResponse.json({ ok: true, accepted: toRead.length });
}
