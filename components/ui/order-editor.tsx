"use client";
/* The one order form: new orders (pasted or typed), edits, and WhatsApp drafts awaiting approval.
   Every line must be a catalog product; unknown items are matched or added to the catalog here.
   Saving is safe to retry: the same idempotency key is reused until the server confirms. */
import { useEffect, useMemo, useRef, useState } from "react";
import { formatINR } from "@/lib/types";
import { GST_STATES } from "@/lib/gst";
import { useStatus } from "./shared";
import { IcPlus, IcTrash, IcAlertTriangle, IcCheck } from "../icons";

interface Product { id: string; name: string; unit: string; price: number; hsn_code: string; gst_rate: number; current_stock?: number; track_stock?: number; active?: number }
interface Customer { id: string; name: string; phone: string; gstin: string; state_code?: string }
export interface EditorLine { product_id: string | null; name: string; qty: number; price?: number }
export interface EditorInitial { customer?: { id?: string; name?: string; phone?: string; gstin?: string } | null; items: EditorLine[]; delivery_date?: string; delivery_state?: string; notes?: string; raw_message?: string }

const input = "w-full h-10 px-3 rounded-[10px] border border-stone-300 bg-white text-sm text-stone-800 placeholder-stone-400 focus:outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-200 disabled:bg-stone-50 disabled:text-stone-500";
const newKey = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `k-${Date.now()}-${Math.random().toString(36).slice(2)}`);

export function OrderEditor({ mode, initial, orderId, version, inboundId, warning, onSaved, onCancel }: {
  mode: "new" | "edit" | "approve"; initial: EditorInitial; orderId?: string; version?: number; inboundId?: string; warning?: string;
  onSaved: (order: { id: string }) => void; onCancel: () => void;
}) {
  const { role, biz, sellerState } = useStatus();
  const canOverride = role === "owner" || role === "manager";
  const [products, setProducts] = useState<Product[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [lines, setLines] = useState<EditorLine[]>(initial.items.length ? initial.items : [{ product_id: null, name: "", qty: 1 }]);
  const [custId, setCustId] = useState<string>(initial.customer?.id || (initial.customer?.name ? "__new" : ""));
  const [newCust, setNewCust] = useState({ name: initial.customer?.name || "", phone: initial.customer?.phone || "", gstin: initial.customer?.gstin || "" });
  const [delivery, setDelivery] = useState(initial.delivery_date || "");
  const [deliveryState, setDeliveryState] = useState(initial.delivery_state || "");
  const [notes, setNotes] = useState(initial.notes || "");
  const [adding, setAdding] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dupOf, setDupOf] = useState<string | null>(null);
  const key = useRef(newKey());

  useEffect(() => {
    Promise.all([fetch("/api/products").then((r) => r.json()), fetch("/api/customers").then((r) => r.json())])
      .then(([p, c]) => { setProducts((p.products || []).filter((x: Product) => x.active !== 0)); setCustomers(c.customers || []); })
      .catch(() => setError("Couldn't load your catalog. Check the connection and reopen this form."));
  }, []);

  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const setLine = (i: number, patch: Partial<EditorLine>) => setLines((ls) => ls.map((l, k) => (k === i ? { ...l, ...patch } : l)));
  const chooseProduct = (i: number, id: string) => { const p = byId.get(id); setLine(i, { product_id: id || null, name: p?.name || lines[i].name, price: undefined }); };

  const priced = lines.map((l) => {
    const p = l.product_id ? byId.get(l.product_id) : undefined;
    const rate = l.price ?? p?.price ?? 0;
    const total = Math.round((Number(l.qty) || 0) * rate * 100) / 100;
    const gst = biz.registration === "regular" && p ? Math.round(total * p.gst_rate) / 100 : 0;
    return { ...l, p, rate, total, gst };
  });
  const subtotal = priced.reduce((s, l) => s + l.total, 0);
  const gstTotal = priced.reduce((s, l) => s + l.gst, 0);
  const unknown = priced.filter((l) => !l.p).length;
  const shortStock = priced.filter((l) => l.p?.track_stock && (l.p.current_stock ?? 0) < (Number(l.qty) || 0));
  const custOk = custId && custId !== "__new" ? true : newCust.name.trim().length >= 2;
  const chosen = custId && custId !== "__new" ? customers.find((c) => c.id === custId) : null;
  const buyerGstin = chosen ? chosen.gstin : newCust.gstin.trim();
  const askState = biz.registration === "regular" && !(buyerGstin && buyerGstin.length === 15);
  const stateNow = deliveryState || chosen?.state_code || sellerState || "";
  const interState = askState && !!sellerState && stateNow !== sellerState;
  const linesOk = priced.length > 0 && priced.every((l) => l.p && Number(l.qty) > 0 && l.rate > 0);

  async function save(confirmDuplicate = false) {
    setError(null); setSaving(true);
    const customer = custId && custId !== "__new" ? { id: custId } : { name: newCust.name.trim(), phone: newCust.phone.trim() || undefined, gstin: newCust.gstin.trim().toUpperCase() || undefined };
    const items = priced.map((l) => ({ product_id: l.product_id!, qty: Number(l.qty), ...(canOverride && l.price !== undefined ? { price: Number(l.price) } : {}) }));
    try {
      const r = mode === "edit"
        ? await fetch("/api/orders", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: orderId, action: "edit", version, customer, items, delivery_date: delivery, delivery_state: askState ? stateNow : "", notes }) })
        : await fetch("/api/orders", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": key.current }, body: JSON.stringify({ customer, items, delivery_date: delivery, delivery_state: askState ? stateNow : "", notes, raw_message: initial.raw_message || "", inbound_id: inboundId, confirm_duplicate: confirmDuplicate || undefined }) });
      const d = await r.json().catch(() => ({}));
      if (r.ok) { onSaved(d.order); return; }
      if (r.status === 409 && d.details?.possible_duplicate) { setDupOf(d.details.possible_duplicate); setError(d.error); }
      else setError(d.error || `Couldn't save (error ${r.status}). Nothing was changed.`);
    } catch {
      setError("Couldn't reach Munshiji. The order may not be saved yet. Tap Save again; it won't be saved twice.");
    } finally { setSaving(false); }
  }

  return (
    <div className="space-y-4">
      {warning && <p className="text-[13px] text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">{warning}</p>}
      {initial.raw_message && <details className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2"><summary className="text-[13px] font-medium text-emerald-800 cursor-pointer">Original message</summary><p className="text-sm text-stone-700 italic mt-1 whitespace-pre-wrap">{initial.raw_message}</p></details>}

      {/* Buyer */}
      <fieldset className="space-y-2">
        <legend className="text-[13px] font-semibold text-stone-700 mb-1">{biz.words.customer}</legend>
        <select aria-label={biz.words.customer} value={custId} onChange={(e) => setCustId(e.target.value)} className={input}>
          <option value="">Choose {biz.words.customer.toLowerCase()}…</option>
          {customers.map((c) => <option key={c.id} value={c.id}>{c.name}{c.phone ? ` · ${c.phone}` : ""}</option>)}
          <option value="__new">+ New {biz.words.customer.toLowerCase()}</option>
        </select>
        {custId === "__new" && <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <input aria-label="New buyer name" value={newCust.name} onChange={(e) => setNewCust({ ...newCust, name: e.target.value })} placeholder="Name *" className={input} />
          <input aria-label="New buyer phone" value={newCust.phone} onChange={(e) => setNewCust({ ...newCust, phone: e.target.value })} placeholder="Phone" inputMode="tel" className={input} />
          <input aria-label="New buyer GSTIN" value={newCust.gstin} onChange={(e) => setNewCust({ ...newCust, gstin: e.target.value.toUpperCase() })} placeholder="GSTIN (optional)" maxLength={15} className={`${input} uppercase`} />
        </div>}
      </fieldset>

      {/* Lines */}
      <fieldset>
        <legend className="text-[13px] font-semibold text-stone-700 mb-2">Items</legend>
        <div className="space-y-2">
          {priced.map((l, i) => (
            <div key={i} className={`rounded-xl border p-3 ${l.p || !l.name ? "border-stone-200 bg-white" : "border-amber-300 bg-amber-50"}`}>
              {!l.p && l.name && <p className="flex items-center gap-1.5 text-[13px] text-amber-900 mb-2"><IcAlertTriangle className="w-4 h-4 shrink-0" />“{l.name}” isn&apos;t in your catalog. Choose the matching product{canOverride ? " or add it" : ""}.</p>}
              <div className="grid grid-cols-12 gap-2 items-center">
                <select aria-label={`Product for line ${i + 1}`} value={l.product_id || ""} onChange={(e) => chooseProduct(i, e.target.value)} className={`${input} col-span-12 sm:col-span-5`}>
                  <option value="">Choose product…</option>
                  {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                <label className="col-span-4 sm:col-span-2"><span className="sr-only">Quantity</span>
                  <input type="number" inputMode="decimal" min={0} step="any" value={l.qty} onChange={(e) => setLine(i, { qty: e.target.value === "" ? ("" as unknown as number) : Number(e.target.value) })} className={`${input} text-right`} placeholder="Qty" /></label>
                <label className="col-span-4 sm:col-span-2"><span className="sr-only">Rate</span>
                  <input type="number" inputMode="decimal" min={0} step="any" value={l.price ?? l.p?.price ?? ""} disabled={!canOverride || !l.p} title={canOverride ? "Rate (catalog rate by default)" : "Only an owner or manager can change rates"}
                    onChange={(e) => setLine(i, { price: e.target.value === "" ? undefined : Number(e.target.value) })} className={`${input} text-right`} placeholder="Rate" /></label>
                <span className="col-span-3 sm:col-span-2 text-right text-sm font-semibold text-stone-800">{formatINR(l.total)}</span>
                <button type="button" onClick={() => setLines((ls) => ls.filter((_, k) => k !== i))} disabled={lines.length === 1} aria-label={`Remove line ${i + 1}`} className="col-span-1 h-10 grid place-items-center rounded-[10px] text-stone-400 hover:text-red-600 disabled:opacity-30"><IcTrash className="w-4 h-4" /></button>
              </div>
              {l.p && <p className="text-xs text-stone-500 mt-1">{l.p.unit} · HSN {l.p.hsn_code || "—"} · GST {l.p.gst_rate}%{l.p.track_stock ? ` · ${l.p.current_stock ?? 0} in stock` : ""}{l.price !== undefined && Math.abs(l.price - l.p.price) > 0.005 ? ` · catalog rate ₹${l.p.price}` : ""}</p>}
              {!l.p && canOverride && (adding === i
                ? <AddProduct name={l.name} onCancel={() => setAdding(null)} onAdded={(p) => { setProducts((ps) => [...ps, p]); setLine(i, { product_id: p.id, name: p.name, price: undefined }); setAdding(null); }} />
                : <button type="button" onClick={() => setAdding(i)} className="mt-2 text-[13px] font-semibold text-emerald-700 hover:underline">{l.name ? `+ Add “${l.name}” to catalog` : "+ New product (not in catalog yet)"}</button>)}
            </div>
          ))}
        </div>
        <button type="button" onClick={() => setLines((ls) => [...ls, { product_id: null, name: "", qty: 1 }])} className="mt-2 inline-flex items-center gap-1.5 text-[13px] font-semibold text-stone-700 hover:text-stone-900"><IcPlus className="w-4 h-4" /> Add line</button>
      </fieldset>

      {askState && <label className="block text-[13px] font-semibold text-stone-700">Delivery state
        <select aria-label="Delivery state" value={stateNow} onChange={(e) => setDeliveryState(e.target.value)} className={`${input} mt-1`}>
          {Object.entries(GST_STATES).sort((a, b) => a[1].localeCompare(b[1])).map(([code, name]) => <option key={code} value={code}>{name}</option>)}
        </select>
        <span className="block text-xs font-normal text-stone-500 mt-1">The buyer has no GSTIN, so GST follows where the goods are delivered: {interState ? "IGST (another state)" : "CGST + SGST (your state)"}.</span>
      </label>}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="text-[13px] font-semibold text-stone-700">Delivery date<input type="date" value={delivery} onChange={(e) => setDelivery(e.target.value)} className={`${input} mt-1`} /></label>
        <label className="text-[13px] font-semibold text-stone-700">Notes<input value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={1000} placeholder="Packing, branding, address…" className={`${input} mt-1`} /></label>
      </div>

      <div className="rounded-xl bg-stone-50 border border-stone-200 p-3 text-sm">
        <div className="flex justify-between text-stone-600"><span>Subtotal</span><span className="font-mono">{formatINR(subtotal)}</span></div>
        <div className="flex justify-between text-stone-600"><span>GST</span><span className="font-mono">{formatINR(gstTotal)}</span></div>
        <div className="flex justify-between font-bold text-stone-800 mt-1"><span>Total</span><span className="font-mono">{formatINR(subtotal + gstTotal)}</span></div>
        <p className="text-xs text-stone-500 mt-1">Rates and GST come from your catalog and are checked again when you save.</p>
      </div>
      {shortStock.length > 0 && <p className="text-[13px] text-amber-800">Low stock: {shortStock.map((l) => `${l.p!.name} (${l.p!.current_stock ?? 0} of ${l.qty})`).join(", ")}. You can still save; dispatch will need stock.</p>}

      {error && <div role="alert" className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-3 py-2">{error}
        {dupOf && <div className="mt-2 flex gap-2"><button type="button" onClick={() => { setDupOf(null); save(true); }} className="h-9 px-3 rounded-[10px] bg-red-600 text-white text-[13px] font-semibold">Save anyway, it&apos;s a separate order</button><button type="button" onClick={onCancel} className="h-9 px-3 rounded-[10px] border border-stone-300 text-[13px] font-semibold text-stone-700">Don&apos;t save</button></div>}
      </div>}

      <div className="flex gap-2 pt-1">
        <button type="button" onClick={() => save()} disabled={saving || !linesOk || !custOk || unknown > 0}
          className="flex-1 h-11 rounded-xl bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 disabled:opacity-40 inline-flex items-center justify-center gap-2">
          {saving ? "Saving…" : <><IcCheck className="w-4 h-4" />{mode === "edit" ? "Save changes" : mode === "approve" ? "Approve order" : "Save order"}</>}
        </button>
        <button type="button" onClick={onCancel} disabled={saving} className="h-11 px-4 rounded-xl border border-stone-300 bg-white text-sm font-semibold text-stone-700 hover:bg-stone-50">Cancel</button>
      </div>
      {(unknown > 0 || !custOk) && <p className="text-xs text-stone-500 -mt-2">{!custOk ? `Choose a ${biz.words.customer.toLowerCase()}. ` : ""}{unknown > 0 ? `${unknown} ${unknown === 1 ? "line needs" : "lines need"} a catalog product.` : ""}</p>}
    </div>
  );
}

function AddProduct({ name, onAdded, onCancel }: { name: string; onAdded: (p: Product) => void; onCancel: () => void }) {
  const [f, setF] = useState({ name, unit: "piece", price: "", hsn_code: "", gst_rate: "18" });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function add() {
    setBusy(true); setErr(null);
    try {
      const r = await fetch("/api/products", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: f.name, unit: f.unit, price: Number(f.price), hsn_code: f.hsn_code, gst_rate: Number(f.gst_rate), track_stock: true }) });
      const d = await r.json();
      if (!r.ok) setErr(d.error || "Couldn't add the product."); else onAdded({ ...d, current_stock: 0, track_stock: 1 });
    } catch { setErr("Couldn't reach Munshiji. Try again."); } finally { setBusy(false); }
  }
  return (
    <div className="mt-2 grid grid-cols-2 sm:grid-cols-6 gap-2 items-end">
      <input aria-label="Product name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} className={`${input} col-span-2`} placeholder="Product name" />
      <input aria-label="Unit" value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })} className={input} placeholder="Unit" />
      <input aria-label="Rate" type="number" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} className={input} placeholder="Rate ₹" />
      <input aria-label="HSN code" value={f.hsn_code} onChange={(e) => setF({ ...f, hsn_code: e.target.value.replace(/\D/g, "").slice(0, 8) })} className={input} placeholder="HSN" inputMode="numeric" />
      <select aria-label="GST rate" value={f.gst_rate} onChange={(e) => setF({ ...f, gst_rate: e.target.value })} className={input}>{[0, 3, 5, 18, 40].map((r) => <option key={r} value={r}>{r}%</option>)}</select>
      <div className="col-span-2 sm:col-span-6 flex gap-2">
        <button type="button" onClick={add} disabled={busy || f.name.trim().length < 2 || !(Number(f.price) > 0)} className="h-9 px-3 rounded-[10px] bg-emerald-600 text-white text-[13px] font-semibold disabled:opacity-40">{busy ? "Adding…" : "Add to catalog"}</button>
        <button type="button" onClick={onCancel} className="h-9 px-3 rounded-[10px] border border-stone-300 text-[13px] font-semibold text-stone-700">Cancel</button>
        {err && <span role="alert" className="text-[13px] text-red-700 self-center">{err}</span>}
      </div>
    </div>
  );
}
