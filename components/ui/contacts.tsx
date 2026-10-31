"use client";
/* Contacts: customers and suppliers, added and edited here (not only through orders and purchases). */
import { useMemo, useState } from "react";
import { checkGstin, GST_STATES } from "@/lib/gst";
import { formatINR } from "@/lib/types";
import { IcPlus } from "../icons";

export interface Contact { id: string; name: string; phone?: string; email?: string; address?: string; gstin?: string; state_code?: string; stats?: { order_count?: number; total_value?: number; purchases?: number; spent?: number } }
type Kind = "customer" | "supplier";
const field = "w-full h-11 px-3 rounded-[10px] border border-stone-300 bg-white text-sm text-stone-800 placeholder-stone-400 focus:outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-200";
const STATES = Object.entries(GST_STATES).sort((a, b) => a[1].localeCompare(b[1]));

function ContactForm({ kind, initial, onDone, onCancel }: { kind: Kind; initial?: Contact; onDone: (msg: string) => void; onCancel: () => void }) {
  const [f, setF] = useState({ name: initial?.name || "", phone: initial?.phone || "", email: initial?.email || "", gstin: initial?.gstin || "", state_code: initial?.state_code || "", address: initial?.address || "" });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const g = f.gstin.trim().toUpperCase();
  const check = g.length === 15 ? checkGstin(g) : null;
  async function save() {
    setBusy(true); setErr(null);
    const url = kind === "customer" ? "/api/customers" : "/api/suppliers";
    const body = { ...(initial ? { id: initial.id } : {}), ...f, gstin: g, state_code: g ? undefined : f.state_code };
    const r = await fetch(url, { method: initial ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
    const d = r ? await r.json().catch(() => ({})) : {};
    setBusy(false);
    if (r?.ok) onDone(initial ? `${f.name} saved.` : `${f.name} added.`);
    else setErr(d.error || "Couldn't reach Munshiji. Try again.");
  }
  return (
    <div className="rounded-2xl border border-emerald-200 bg-emerald-50/60 p-4 space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="text-xs font-medium text-stone-700">Name<input autoFocus aria-label="Name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder={kind === "customer" ? "e.g. Hindustan Foods Pvt Ltd" : "e.g. Shree Paper Mills"} className={`${field} mt-1.5`} /></label>
        <label className="text-xs font-medium text-stone-700">Phone<input aria-label="Phone" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} inputMode="tel" placeholder="98765 43210" className={`${field} mt-1.5`} /></label>
        <label className="text-xs font-medium text-stone-700">GSTIN (optional)
          <input aria-label="GSTIN" value={f.gstin} onChange={(e) => setF({ ...f, gstin: e.target.value.toUpperCase().replace(/\s/g, "") })} maxLength={15} placeholder="27AAAAA0000A1Z5" className={`${field} mt-1.5 font-mono uppercase`} />
          {check && (check.valid ? <span className="block mt-1 text-[12px] text-emerald-700">✓ Valid · {check.stateName} · PAN {check.pan}</span> : <span className="block mt-1 text-[12px] text-red-700">{check.error}</span>)}
          {!g && kind === "supplier" && <span className="block mt-1 text-[12px] text-stone-500">Without a GSTIN, purchases from this supplier can&apos;t count as input credit.</span>}
        </label>
        <label className="text-xs font-medium text-stone-700">Email (optional)<input aria-label="Email" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} placeholder="accounts@company.in" className={`${field} mt-1.5`} /></label>
        {!g && <label className="text-xs font-medium text-stone-700">State
          <select aria-label="State" value={f.state_code} onChange={(e) => setF({ ...f, state_code: e.target.value })} className={`${field} mt-1.5`}><option value="">Your own state</option>{STATES.map(([c, n]) => <option key={c} value={c}>{n}</option>)}</select>
          {kind === "customer" && <span className="block mt-1 text-[12px] text-stone-500">Used for GST when there&apos;s no GSTIN: another state means IGST.</span>}
        </label>}
        <label className={`text-xs font-medium text-stone-700 ${g ? "sm:col-span-2" : ""}`}>Address<input aria-label="Address" value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} placeholder="Plot, area, city, PIN" className={`${field} mt-1.5`} /></label>
      </div>
      {err && <p role="alert" className="text-sm text-red-700">{err}</p>}
      <div className="flex gap-2">
        <button onClick={save} disabled={busy || f.name.trim().length < 2 || (check !== null && !check.valid)} className="h-11 px-5 rounded-xl bg-emerald-600 text-white text-sm font-semibold disabled:opacity-40">{busy ? "Saving…" : initial ? "Save changes" : kind === "customer" ? "Add customer" : "Add supplier"}</button>
        <button onClick={onCancel} className="h-11 px-4 rounded-xl border border-stone-300 bg-white text-sm font-semibold text-stone-700">Cancel</button>
      </div>
    </div>
  );
}

export function ContactsPage({ customers, suppliers, customersLabel, canEditSuppliers, onChanged }: { customers: Contact[]; suppliers: Contact[]; customersLabel: string; canEditSuppliers: boolean; onChanged: () => void }) {
  const [tab, setTab] = useState<Kind>("customer");
  const [q, setQ] = useState("");
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const list = tab === "customer" ? customers : suppliers;
  const shown = useMemo(() => { const s = q.trim().toLowerCase(); return s ? list.filter((c) => [c.name, c.phone, c.gstin, c.email].some((v) => (v || "").toLowerCase().includes(s))) : list; }, [list, q]);
  const canEdit = tab === "customer" || canEditSuppliers;
  const done = (m: string) => { setAdding(false); setEditing(null); setMsg(m); onChanged(); };
  const switchTab = (k: Kind) => { setTab(k); setAdding(false); setEditing(null); setMsg(null); setQ(""); };

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-3">
        <h1 className="text-2xl sm:text-[28px] font-bold tracking-tight text-stone-800">Contacts</h1>
        {canEdit && !adding && <button onClick={() => { setAdding(true); setEditing(null); setMsg(null); }} className="inline-flex items-center gap-1.5 h-10 px-4 rounded-xl bg-emerald-600 text-white text-sm font-semibold"><IcPlus className="w-4 h-4" />{tab === "customer" ? "Add customer" : "Add supplier"}</button>}
      </div>
      <div role="tablist" aria-label="Contact type" className="flex gap-1 border-b border-stone-200 mb-4">
        {([["customer", customersLabel, customers.length], ["supplier", "Suppliers", suppliers.length]] as const).map(([k, label, n]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => switchTab(k)} className={`h-11 px-4 text-sm font-semibold border-b-2 -mb-px ${tab === k ? "border-emerald-600 text-stone-800" : "border-transparent text-stone-500"}`}>{label} <span className="text-stone-400 font-medium">{n}</span></button>
        ))}
      </div>
      {msg && <p role="status" className="mb-3 text-sm text-emerald-700">{msg}</p>}
      {adding && <div className="mb-4"><ContactForm kind={tab} onDone={done} onCancel={() => setAdding(false)} /></div>}
      {list.length > 3 && <input aria-label="Search contacts" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name, phone or GSTIN" className={`${field} mb-3`} />}
      {list.length === 0 && !adding && <div className="rounded-2xl border border-dashed border-stone-300 p-6 text-center text-sm text-stone-600">
        {tab === "customer" ? "No customers yet. Add one, or they'll be added from their first order." : "No suppliers yet. Add one, or record a purchase on the Stock page."}
      </div>}
      <ul className="space-y-2">{shown.map((c) => (
        <li key={c.id}>
          {editing === c.id ? <ContactForm kind={tab} initial={c} onDone={done} onCancel={() => setEditing(null)} /> : (
            <button disabled={!canEdit} onClick={() => { setEditing(c.id); setAdding(false); setMsg(null); }} className="w-full text-left rounded-2xl border border-stone-200 bg-white shadow-card p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-2 hover:border-stone-300 disabled:cursor-default">
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-stone-800">{c.name}</span>
                <span className="block text-xs text-stone-500 mt-0.5">{[c.phone, c.email, c.gstin ? `GSTIN ${c.gstin}` : "No GSTIN", !c.gstin && c.state_code ? GST_STATES[c.state_code] : ""].filter(Boolean).join(" · ")}</span>
              </span>
              <span className="text-xs text-stone-500 sm:text-right shrink-0">
                {tab === "customer" ? (Number(c.stats?.order_count) ? <>{c.stats!.order_count} {Number(c.stats!.order_count) === 1 ? "order" : "orders"} · {formatINR(Number(c.stats!.total_value || 0))}</> : "No orders yet")
                  : (Number(c.stats?.purchases) ? <>{c.stats!.purchases} {Number(c.stats!.purchases) === 1 ? "purchase" : "purchases"} · {formatINR(Number(c.stats!.spent || 0))}</> : "No purchases yet")}
                {canEdit && <span className="block text-emerald-700 font-semibold mt-0.5">Edit</span>}
              </span>
            </button>
          )}
        </li>
      ))}</ul>
    </div>
  );
}
