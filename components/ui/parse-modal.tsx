"use client";
import { useState, useEffect } from "react";
import { IcWhatsApp, IcX } from "../icons";
import { Mascot } from "../brand";
import { OrderEditor, type EditorInitial } from "./order-editor";

/** New order: paste a message (read into a draft) or type it in. Nothing is saved until the person confirms. */
export function ParseModal({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const [step, setStep] = useState<"paste" | "reading" | "edit">("paste");
  const [rawMsg, setRawMsg] = useState("");
  const [draft, setDraft] = useState<{ initial: EditorInitial; warning?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (open) { setStep("paste"); setRawMsg(""); setDraft(null); setError(null); } }, [open]);

  async function read() {
    if (!rawMsg.trim()) return;
    setStep("reading"); setError(null);
    try {
      const r = await fetch("/api/parse", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: rawMsg }) });
      const d = await r.json();
      if (!r.ok) { setError(d.error || "Couldn't read the message."); setStep("paste"); return; }
      setDraft({ initial: { customer: d.customer, items: d.items, delivery_date: d.delivery_date, notes: d.notes, raw_message: rawMsg }, warning: d.warning });
      setStep("edit");
    } catch { setError("Couldn't reach Munshiji. Check the connection and try again."); setStep("paste"); }
  }

  if (!open) return null;
  const close = () => { if (step !== "reading") onClose(); };
  return (
    <div className="fixed inset-0 bg-black/30 z-50 flex items-end sm:items-center justify-center sm:p-4" onClick={close}>
      <div role="dialog" aria-modal="true" aria-labelledby="new-order-title" className="bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-2xl max-h-[92vh] overflow-y-auto shadow-2xl stone-fade-in" onClick={(e) => e.stopPropagation()}>
        <div className="p-5 border-b border-stone-100 flex justify-between items-center sticky top-0 bg-white z-10 rounded-t-2xl">
          <div className="flex items-center gap-2.5"><span className="text-emerald-600"><IcWhatsApp className="w-5 h-5" /></span><h2 id="new-order-title" className="text-lg font-bold text-stone-800">New order</h2></div>
          <button onClick={close} aria-label="Close" className="p-1.5 rounded-lg text-stone-400 hover:bg-stone-100"><IcX className="w-5 h-5" /></button>
        </div>
        <div className="p-5">
          {step === "paste" && <div className="space-y-3">
            <label htmlFor="order-msg" className="block text-sm text-stone-600">Paste the buyer&apos;s WhatsApp message. Munshiji reads it into a draft for you to check.</label>
            <textarea id="order-msg" value={rawMsg} onChange={(e) => setRawMsg(e.target.value)} rows={5} maxLength={5000} placeholder="e.g. Sharma ji, 500 BOPP tape aur 2000 medium boxes chahiye, 28th tak"
              className="w-full px-3 py-2.5 rounded-xl border border-stone-300 text-sm text-stone-800 placeholder-stone-400 focus:outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-200" />
            {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
            <div className="flex flex-wrap gap-2">
              <button onClick={read} disabled={!rawMsg.trim()} className="h-11 px-5 rounded-xl bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 disabled:opacity-40">Read message</button>
              <button onClick={() => { setDraft({ initial: { items: [] } }); setStep("edit"); }} className="h-11 px-4 rounded-xl border border-stone-300 text-sm font-semibold text-stone-700 hover:bg-stone-50">Enter it yourself</button>
            </div>
          </div>}
          {step === "reading" && <div className="flex flex-col items-center py-8 gap-3" role="status"><Mascot pose="reading-phone" height={128} className="munshi-nod" decorative /><span className="text-sm text-stone-600 font-medium">Munshiji is reading the message…</span></div>}
          {step === "edit" && draft && <OrderEditor mode="new" initial={draft.initial} warning={draft.warning} onCancel={onClose} onSaved={() => { onSaved(); onClose(); }} />}
        </div>
      </div>
    </div>
  );
}
