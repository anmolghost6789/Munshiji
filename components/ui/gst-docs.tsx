"use client";
/* Order-panel sections for GST documents: e-way bill and transport, e-invoice IRN, and credit notes. */
import { useRef, useState } from "react";
import { formatINR } from "@/lib/types";
import type { Order } from "./shared";

const field = "w-full h-10 px-3 rounded-[10px] border border-stone-300 bg-white text-sm text-stone-800 placeholder-stone-400 focus:outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-200";
const key = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `k-${Date.now()}-${Math.random()}`);
const EXEMPT = ["Value below the limit in this state", "Exempt goods", "Non-motorised transport", "Under 50 km to the transporter (Part B not needed)", "Other (see notes)"];
async function send(url: string, method: string, body: object, headers: Record<string, string> = {}) {
  const r = await fetch(url, { method, headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) }).catch(() => null);
  const d = r ? await r.json().catch(() => ({})) : {};
  return r?.ok ? { ok: true as const, d } : { ok: false as const, error: (d as { error?: string }).error || "Couldn't reach Munshiji. Try again." };
}

type O = Order & { ewb_number?: string; vehicle_number?: string; transporter_name?: string; transporter_id?: string; distance_km?: number | null; ewb_exempt_reason?: string };

/* ── E-way bill and transport ── */
export function TransportSection({ order, threshold, registered, open, onSaved }: { order: O; threshold: number; registered: boolean; open?: boolean; onSaved: () => void }) {
  const needed = registered && order.grand_total > threshold;
  const [editing, setEditing] = useState(!!open);
  const [f, setF] = useState({ ewb_number: order.ewb_number || "", vehicle_number: order.vehicle_number || "", transporter_name: order.transporter_name || "", transporter_id: order.transporter_id || "", distance_km: order.distance_km ? String(order.distance_km) : "", ewb_exempt_reason: order.ewb_exempt_reason || "" });
  const [err, setErr] = useState<string | null>(null);
  const has = order.ewb_number || order.vehicle_number || order.ewb_exempt_reason;
  if (!needed && !has && !editing) return <button onClick={() => setEditing(true)} className="text-[13px] font-semibold text-stone-600 hover:underline">+ Add vehicle / e-way bill</button>;
  return (
    <section aria-label="Transport and e-way bill" className={`rounded-2xl border p-3 ${needed && !order.ewb_number && !order.ewb_exempt_reason ? "border-amber-300 bg-amber-50" : "border-stone-200"}`}>
      <div className="flex items-center justify-between gap-2"><span className="text-[13px] font-semibold text-stone-700">Transport and e-way bill</span>{!editing && <button onClick={() => setEditing(true)} className="text-[13px] font-semibold text-emerald-700">Edit</button>}</div>
      {needed && !order.ewb_number && !order.ewb_exempt_reason && <p className="text-[13px] text-amber-900 mt-1">This consignment is above {formatINR(threshold)}, so it needs an e-way bill before it leaves. Generate it on the e-way bill portal, then enter the number here.</p>}
      {!editing ? (
        <dl className="mt-1 text-sm text-stone-700 grid grid-cols-2 gap-x-3 gap-y-0.5">
          {order.ewb_number && <><dt className="text-stone-500">E-way bill</dt><dd className="font-mono">{order.ewb_number.replace(/(\d{4})(?=\d)/g, "$1 ")}</dd></>}
          {order.vehicle_number && <><dt className="text-stone-500">Vehicle</dt><dd className="font-mono">{order.vehicle_number}</dd></>}
          {order.transporter_name && <><dt className="text-stone-500">Transporter</dt><dd>{order.transporter_name}</dd></>}
          {order.ewb_exempt_reason && <><dt className="text-stone-500">No e-way bill</dt><dd>{order.ewb_exempt_reason}</dd></>}
        </dl>
      ) : (
        <div className="mt-2 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <input aria-label="E-way bill number" value={f.ewb_number} onChange={(e) => setF({ ...f, ewb_number: e.target.value })} placeholder="E-way bill no. (12 digits)" inputMode="numeric" className={`${field} col-span-2 font-mono`} />
            <input aria-label="Vehicle number" value={f.vehicle_number} onChange={(e) => setF({ ...f, vehicle_number: e.target.value.toUpperCase() })} placeholder="Vehicle e.g. MH12AB1234" className={`${field} font-mono`} />
            <input aria-label="Distance in km" value={f.distance_km} onChange={(e) => setF({ ...f, distance_km: e.target.value.replace(/\D/g, "") })} placeholder="Distance (km)" inputMode="numeric" className={field} />
            <input aria-label="Transporter name" value={f.transporter_name} onChange={(e) => setF({ ...f, transporter_name: e.target.value })} placeholder="Transporter (optional)" className={field} />
            <input aria-label="Transporter ID" value={f.transporter_id} onChange={(e) => setF({ ...f, transporter_id: e.target.value.toUpperCase() })} placeholder="Transporter ID / GSTIN" className={`${field} font-mono`} />
          </div>
          {needed && <label className="block text-xs text-stone-600">No e-way bill needed because…<select aria-label="E-way bill exemption" value={f.ewb_exempt_reason} onChange={(e) => setF({ ...f, ewb_exempt_reason: e.target.value })} className={`${field} mt-1`}><option value="">It's needed (enter the number above)</option>{EXEMPT.map((x) => <option key={x}>{x}</option>)}</select></label>}
          {err && <p role="alert" className="text-sm text-red-700">{err}</p>}
          <div className="flex gap-2"><button onClick={async () => { setErr(null); const r = await send("/api/orders", "PATCH", { id: order.id, action: "transport", ...f, distance_km: f.distance_km ? Number(f.distance_km) : undefined }); if (r.ok) { setEditing(false); onSaved(); } else setErr(r.error); }} className="h-9 px-4 rounded-[10px] bg-emerald-600 text-white text-[13px] font-semibold">Save</button>
            <button onClick={() => setEditing(false)} className="h-9 px-3 rounded-[10px] border border-stone-300 text-[13px] font-semibold text-stone-700">Cancel</button></div>
        </div>
      )}
    </section>
  );
}

/* ── E-invoice IRN ── */
export function IrnSection({ kind, id, number, onSaved }: { kind: "invoice" | "credit_note"; id: string; number: string; onSaved: () => void }) {
  const [f, setF] = useState({ irn: "", ack_no: "", ack_date: "", signed_qr: "" });
  const [err, setErr] = useState<string | null>(null);
  return (
    <section aria-label="E-invoice registration" className="rounded-2xl border border-amber-300 bg-amber-50 p-3 space-y-2">
      <p className="text-sm font-semibold text-amber-900">IRN needed for {number}</p>
      <p className="text-[13px] text-stone-700">This business is under e-invoicing. Register the {kind === "invoice" ? "bill" : "credit note"} on the Invoice Registration Portal, then copy its IRN, acknowledgement and signed QR here. Until then it isn&apos;t a valid tax invoice for the buyer.</p>
      <input aria-label="IRN" value={f.irn} onChange={(e) => setF({ ...f, irn: e.target.value.trim() })} placeholder="IRN (64 characters)" className={`${field} font-mono text-xs`} />
      <div className="grid grid-cols-2 gap-2">
        <input aria-label="Acknowledgement number" value={f.ack_no} onChange={(e) => setF({ ...f, ack_no: e.target.value.replace(/\D/g, "") })} placeholder="Ack no." inputMode="numeric" className={`${field} font-mono`} />
        <input aria-label="Acknowledgement date" type="datetime-local" value={f.ack_date} onChange={(e) => setF({ ...f, ack_date: e.target.value })} className={field} />
      </div>
      <textarea aria-label="Signed QR code" value={f.signed_qr} onChange={(e) => setF({ ...f, signed_qr: e.target.value.trim() })} placeholder="Signed QR code text" rows={2} className="w-full px-3 py-2 rounded-[10px] border border-stone-300 bg-white text-xs font-mono" />
      {err && <p role="alert" className="text-sm text-red-700">{err}</p>}
      <button onClick={async () => { setErr(null); const r = await send("/api/einvoice", "POST", { kind, id, ...f, ack_date: f.ack_date.replace("T", " ") }); if (r.ok) onSaved(); else setErr(r.error); }} className="h-9 px-4 rounded-[10px] bg-emerald-600 text-white text-[13px] font-semibold">Save IRN</button>
    </section>
  );
}

/* ── Credit notes ── */
export interface CreditNote { id: string; number: string; reason: string; reason_note: string; created_at: string; subtotal: number; cgst: number; sgst: number; igst: number; grand_total: number; restocked: number; einvoice_required: number; irn: string; items: { product_name: string; qty: number; unit: string; price: number; total: number; hsn_code: string; gst_rate: number; gst_amount: number }[] }
const REASONS: [string, string][] = [["goods_returned", "Goods returned"], ["deficiency", "Goods short or defective"], ["price_reduction", "Price reduced after the sale"], ["discount", "Discount after the sale"], ["excess_tax", "Tax charged too high"], ["other", "Other"]];
export const reasonLabel = (r: string) => REASONS.find((x) => x[0] === r)?.[1] || r;

export function CreditNotesSection({ order, notes, billNumber, canIssue, onSaved, onView }: { order: Order; notes: CreditNote[]; billNumber: string; canIssue: boolean; onSaved: () => void; onView: (n: CreditNote) => void }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("goods_returned");
  const [note, setNote] = useState("");
  const [restock, setRestock] = useState(true);
  const [vals, setVals] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const k = useRef(key());
  const byQty = reason === "goods_returned" || reason === "deficiency";
  const left = Math.round((order.grand_total - ((order as { amount_credited?: number }).amount_credited || 0)) * 100) / 100;
  const products = [...new Map(order.items.map((i) => [i.product_id, i])).values()];

  async function issue() {
    setBusy(true); setErr(null);
    const lines = products.filter((p) => Number(vals[p.product_id]) > 0).map((p) => (byQty ? { product_id: p.product_id, qty: Number(vals[p.product_id]) } : { product_id: p.product_id, amount: Number(vals[p.product_id]) }));
    const r = await send("/api/credit-notes", "POST", { order_id: order.id, reason, reason_note: note, restock: byQty && reason === "goods_returned" && restock, lines }, { "Idempotency-Key": k.current });
    setBusy(false);
    if (r.ok) { setOpen(false); setVals({}); setNote(""); k.current = key(); onSaved(); } else setErr(r.error);
  }
  return (
    <section aria-label="Credit notes" className="space-y-2">
      <div className="flex items-center justify-between"><span className="text-[13px] font-medium text-stone-500">Credit notes</span>{canIssue && left > 0 && !open && <button onClick={() => setOpen(true)} className="text-[13px] font-semibold text-emerald-700">+ Issue credit note</button>}</div>
      {notes.length === 0 && !open && <p className="text-sm text-stone-500">None. Use a credit note for returns, short supply or a price change after billing.</p>}
      {notes.map((n) => (
        <button key={n.id} onClick={() => onView(n)} className="w-full text-left flex justify-between items-center text-sm rounded-xl border border-stone-200 px-3 py-2 hover:bg-stone-50">
          <span><b className="font-mono">{n.number}</b> · {reasonLabel(n.reason)}{n.einvoice_required && !n.irn ? <span className="ml-1 text-xs font-semibold text-amber-800">IRN needed</span> : null}</span><span className="font-semibold">− {formatINR(n.grand_total)}</span>
        </button>
      ))}
      {open && <div className="rounded-2xl border border-stone-300 bg-stone-50 p-3 space-y-2">
        <p className="text-xs text-stone-600">Against bill {billNumber}. Up to {formatINR(left)} can still be credited. GST is reversed at the bill&apos;s rates.</p>
        <select aria-label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} className={field}>{REASONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        {products.map((p) => (
          <label key={p.product_id} className="flex items-center gap-2 text-sm">
            <span className="flex-1 min-w-0 truncate">{p.product_name} <span className="text-xs text-stone-500">({p.qty} {p.unit} at {formatINR(p.price)})</span></span>
            <input aria-label={`${byQty ? "Quantity" : "Amount"} for ${p.product_name}`} type="number" inputMode="decimal" min={0} value={vals[p.product_id] || ""} onChange={(e) => setVals({ ...vals, [p.product_id]: e.target.value })} placeholder={byQty ? "Qty" : "₹ before GST"} className={`${field} w-28 text-right`} />
          </label>
        ))}
        {reason === "goods_returned" && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={restock} onChange={(e) => setRestock(e.target.checked)} /> Put returned goods back in stock</label>}
        <input aria-label="Note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="Note (e.g. 25 rolls damaged in transit)" className={field} />
        {err && <p role="alert" className="text-sm text-red-700">{err}</p>}
        <div className="flex gap-2"><button onClick={issue} disabled={busy || !products.some((p) => Number(vals[p.product_id]) > 0)} className="h-10 px-4 rounded-xl bg-emerald-600 text-white text-sm font-semibold disabled:opacity-40">{busy ? "Issuing…" : "Issue credit note"}</button>
          <button onClick={() => setOpen(false)} className="h-10 px-4 rounded-xl border border-stone-300 bg-white text-sm font-semibold text-stone-700">Cancel</button></div>
      </div>}
    </section>
  );
}

/** A printable credit note. */
export function CreditNoteView({ note, order, billNumber, seller, onClose }: { note: CreditNote; order: Order; billNumber: string; seller: { name: string; gstin: string; address: string }; onClose: () => void }) {
  const taxed = note.cgst + note.sgst + note.igst > 0;
  return (
    <div className="fixed inset-0 z-[60] bg-black/40 flex items-end sm:items-center justify-center sm:p-4 print:bg-white print:static" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={`Credit note ${note.number}`} className="bg-white w-full sm:max-w-xl max-h-[92vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl p-6 print:max-h-none print:shadow-none" onClick={(e) => e.stopPropagation()}>
        <div className="text-center"><div className="text-lg font-bold">{seller.name}</div><div className="text-xs text-stone-600">{seller.address}{seller.gstin ? ` · GSTIN ${seller.gstin}` : ""}</div>
          <div className="mt-3 text-sm font-bold tracking-wide">{taxed ? "CREDIT NOTE (GST)" : "CREDIT NOTE"}</div></div>
        <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
          <div><div className="text-xs text-stone-500">Credit note</div><div className="font-mono font-semibold">{note.number}</div><div className="text-xs">{note.created_at.slice(0, 10)}</div></div>
          <div className="text-right"><div className="text-xs text-stone-500">Against bill</div><div className="font-mono font-semibold">{billNumber}</div><div className="text-xs">Order {order.id}</div></div>
          <div className="col-span-2"><div className="text-xs text-stone-500">To</div><div className="font-semibold">{order.customer_name}</div>{order.customer_gstin && <div className="text-xs">GSTIN {order.customer_gstin}</div>}</div>
          <div className="col-span-2 text-xs text-stone-600">Reason: {reasonLabel(note.reason)}{note.reason_note ? `: ${note.reason_note}` : ""}</div>
        </div>
        <table className="w-full text-sm mt-4"><thead><tr className="border-b-2 border-stone-800 text-left text-xs"><th className="py-1">Item</th><th className="py-1">HSN</th><th className="py-1 text-right">Qty</th><th className="py-1 text-right">Taxable</th></tr></thead>
          <tbody>{note.items.map((i, k) => <tr key={k} className="border-b border-stone-200"><td className="py-1.5">{i.product_name}</td><td className="py-1.5 font-mono text-xs">{i.hsn_code}</td><td className="py-1.5 text-right">{i.qty ? `${i.qty} ${i.unit}` : "value"}</td><td className="py-1.5 text-right">{formatINR(i.total)}</td></tr>)}</tbody></table>
        <div className="mt-3 text-sm space-y-0.5 ml-auto max-w-xs">
          <div className="flex justify-between"><span>Taxable value</span><span>{formatINR(note.subtotal)}</span></div>
          {note.igst > 0 && <div className="flex justify-between"><span>IGST</span><span>{formatINR(note.igst)}</span></div>}
          {note.cgst > 0 && <><div className="flex justify-between"><span>CGST</span><span>{formatINR(note.cgst)}</span></div><div className="flex justify-between"><span>SGST</span><span>{formatINR(note.sgst)}</span></div></>}
          <div className="flex justify-between font-bold border-t border-stone-300 pt-1"><span>Total credited</span><span>{formatINR(note.grand_total)}</span></div>
        </div>
        {note.irn ? <p className="mt-3 text-[11px] font-mono break-all text-stone-600">IRN {note.irn}</p> : note.einvoice_required ? <p className="mt-3 text-xs font-semibold text-amber-800">IRN pending: not yet a valid e-invoice credit note.</p> : null}
        <div className="mt-5 flex gap-2 print:hidden"><button onClick={() => window.print()} className="h-10 px-4 rounded-xl bg-emerald-600 text-white text-sm font-semibold">Print or save as PDF</button><button onClick={onClose} className="h-10 px-4 rounded-xl border border-stone-300 text-sm font-semibold text-stone-700">Close</button></div>
      </div>
    </div>
  );
}
