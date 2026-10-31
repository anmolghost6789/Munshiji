"use client";
/* WhatsApp drafts: forwarded messages read into draft orders. A person reviews and approves each one. */
import { useCallback, useEffect, useState } from "react";
import { IcWhatsApp, IcX, IcInbox } from "../icons";
import { OrderEditor } from "./order-editor";

interface Msg { id: string; sender: string; sender_name: string | null; body: string; status: string; parsed_json: string; error: string; received_at: string }
const STATUS: Record<string, string> = { received: "Waiting to be read", reading: "Reading…", needs_approval: "Ready to review", parse_failed: "Couldn't read", unsupported: "Not a text message" };

export function InboxPanel({ onApproved }: { onApproved: () => void }) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [open, setOpen] = useState<Msg | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(async () => { const r = await fetch("/api/inbox"); if (r.ok) setMsgs((await r.json()).messages || []); }, []);
  useEffect(() => { load(); const t = setInterval(load, 15_000); return () => clearInterval(t); }, [load]);
  const act = async (id: string, action: string) => {
    setErr(null);
    const r = await fetch("/api/inbox", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, action }) });
    if (!r.ok) setErr((await r.json().catch(() => ({}))).error || "Couldn't update."); else load();
  };
  if (!msgs.length) return null;
  const draft = open ? (() => { try { return JSON.parse(open.parsed_json || "{}"); } catch { return {}; } })() : null;

  return (
    <section aria-labelledby="inbox-h" className="rounded-[20px] border border-emerald-200 bg-emerald-50 p-4 sm:p-5 mb-4">
      <h2 id="inbox-h" className="flex items-center gap-2 text-base font-bold text-stone-800 mb-3"><IcInbox className="w-5 h-5 text-emerald-700" /> From WhatsApp <span className="text-[13px] font-medium text-stone-500">{msgs.length} waiting for review</span></h2>
      {err && <p role="alert" className="text-sm text-red-700 mb-2">{err}</p>}
      <ul className="space-y-2">{msgs.map((m) => (
        <li key={m.id} className="rounded-xl border border-stone-200 bg-white p-3 flex flex-col sm:flex-row sm:items-center gap-2">
          <div className="flex-1 min-w-0">
            <div className="text-xs text-stone-500"><IcWhatsApp className="inline w-3.5 h-3.5 text-emerald-600 mr-1" />Forwarded by {m.sender_name || `+${m.sender}`} · {m.received_at.slice(0, 16)} · <span className={m.status === "needs_approval" ? "text-emerald-700 font-semibold" : m.status === "parse_failed" || m.status === "unsupported" ? "text-red-700 font-semibold" : ""}>{STATUS[m.status] || m.status}</span></div>
            <p className="text-sm text-stone-800 line-clamp-2 mt-0.5">{m.body || m.error}</p>
          </div>
          <div className="flex gap-2 shrink-0">
            {m.status === "needs_approval" && <button onClick={() => setOpen(m)} className="h-9 px-3 rounded-[10px] bg-emerald-600 text-white text-[13px] font-semibold">Review</button>}
            {m.status === "parse_failed" && <button onClick={() => act(m.id, "retry")} className="h-9 px-3 rounded-[10px] border border-stone-300 text-[13px] font-semibold text-stone-700">Retry reading</button>}
            <button onClick={() => act(m.id, "dismiss")} className="h-9 px-3 rounded-[10px] border border-stone-300 text-[13px] font-semibold text-stone-700">Dismiss</button>
          </div>
        </li>
      ))}</ul>

      {open && draft && <div className="fixed inset-0 bg-black/30 z-50 flex items-end sm:items-center justify-center sm:p-4" onClick={() => setOpen(null)}>
        <div role="dialog" aria-modal="true" aria-label="Review WhatsApp order" className="bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-2xl max-h-[92vh] overflow-y-auto shadow-2xl" onClick={(e) => e.stopPropagation()}>
          <div className="p-5 border-b border-stone-100 flex justify-between items-center sticky top-0 bg-white z-10"><h2 className="text-lg font-bold text-stone-800">Review WhatsApp order</h2><button onClick={() => setOpen(null)} aria-label="Close" className="p-1.5 rounded-lg text-stone-400 hover:bg-stone-100"><IcX className="w-5 h-5" /></button></div>
          <div className="p-5"><OrderEditor mode="approve" inboundId={open.id} warning={draft.warning}
            initial={{ customer: draft.customer, items: draft.items || [], delivery_date: draft.delivery_date, notes: draft.notes, raw_message: open.body }}
            onCancel={() => setOpen(null)} onSaved={() => { setOpen(null); load(); onApproved(); }} /></div>
        </div>
      </div>}
    </section>
  );
}
