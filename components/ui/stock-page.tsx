"use client";
/* Stock for trading SKUs: balances, purchase receipts (goods in), stock counts, and each item's ledger. */
import { useCallback, useEffect, useRef, useState } from "react";
import { formatINR } from "@/lib/types";
import { useStatus } from "./shared";
import { Card } from "./kit";
import { IcPlus, IcTrash, IcAlertTriangle } from "../icons";

interface P { id: string; name: string; unit: string; price: number; gst_rate: number; track_stock: number; current_stock: number; reorder_level: number; kind?: "product" | "material" }
interface S { id: string; name: string; gstin: string }
interface L { id: number; direction: string; qty: number; balance_after: number | null; ref_type: string; ref_id: string; notes: string; created_at: string }
interface R { id: string; supplier_name: string; bill_number: string; bill_date: string; grand_total: number; items: { item_name: string; qty: number; unit: string; rate: number }[] }
const field = "h-10 px-3 rounded-[10px] border border-stone-300 bg-white text-sm text-stone-800 placeholder-stone-400 focus:outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-200";
const REF: Record<string, string> = { receipt: "Purchase receipt", order_dispatch: "Dispatched for order", order_cancel: "Returned (order cancelled)", adjustment: "Stock count", opening: "Opening stock", purchase_order: "Purchase order" };
const newKey = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `k-${Date.now()}-${Math.random()}`);

export function StockPage() {
  const { role } = useStatus();
  const canManage = role === "owner" || role === "manager";
  const [products, setProducts] = useState<P[]>([]);
  const [receipts, setReceipts] = useState<R[]>([]);
  const [panel, setPanel] = useState<null | "receipt" | { count: P } | { ledger: P }>(null);
  const load = useCallback(async () => {
    const [s, r] = await Promise.all([fetch("/api/stock").then((x) => x.json()), fetch("/api/receipts").then((x) => x.json())]);
    // Finished goods that track stock, and raw materials (e.g. kraft paper reels) — both are bought and counted here.
    const goods = (s.products || []).filter((p: P) => p.track_stock).map((p: P) => ({ ...p, kind: "product" as const }));
    const mats = (s.materials || []).map((m: P) => ({ ...m, price: 0, gst_rate: 0, track_stock: 1, kind: "material" as const }));
    setProducts([...mats, ...goods]); setReceipts(r.receipts || []);
  }, []);
  useEffect(() => { load(); }, [load]);
  const low = products.filter((p) => p.current_stock <= p.reorder_level);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-2xl sm:text-[28px] font-bold tracking-tight text-stone-800">Stock</h1>
        {canManage && <button onClick={() => setPanel("receipt")} className="inline-flex items-center gap-2 h-10 px-4 rounded-[10px] bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700"><IcPlus className="w-4 h-4" /> Record purchase</button>}
      </div>
      {low.length > 0 && <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 flex flex-wrap items-center gap-2"><IcAlertTriangle className="w-4 h-4" /><b>Low stock:</b> {low.map((p) => `${p.name} (${p.current_stock} ${p.unit})`).join(", ")}</div>}
      {panel === "receipt" && <ReceiptForm products={products} onCancel={() => setPanel(null)} onDone={() => { setPanel(null); load(); }} />}
      {panel && typeof panel === "object" && "count" in panel && <CountForm p={panel.count} onCancel={() => setPanel(null)} onDone={() => { setPanel(null); load(); }} />}
      {panel && typeof panel === "object" && "ledger" in panel && <Ledger p={panel.ledger} onClose={() => setPanel(null)} />}

      <Card>
        <h2 className="text-lg font-bold text-stone-800 mb-3">Items<span className="ml-2 text-[13px] font-medium text-stone-500">{products.length}</span></h2>
        {products.length === 0 ? <p className="text-sm text-stone-500 py-6 text-center">No stocked products yet. Add products in Catalog, then record a purchase.</p> :
        <>
        <ul className="sm:hidden divide-y divide-stone-200 border border-stone-200 rounded-xl">{products.map((p) => (
          <li key={p.id} className="p-3">
            <div className="flex items-baseline justify-between gap-3"><span className="font-medium text-stone-800">{p.name}</span><span className={`font-semibold whitespace-nowrap ${p.current_stock <= p.reorder_level ? "text-amber-700" : "text-stone-800"}`}>{p.current_stock} {p.unit}</span></div>
            <div className="mt-1 flex items-center justify-between text-[13px]"><span className="text-stone-500">{p.reorder_level ? `Reorder at ${p.reorder_level}` : "No reorder level"}</span>
              <span className="flex gap-4"><button onClick={() => setPanel({ ledger: p })} className="font-semibold text-stone-700">History</button>{canManage && <button onClick={() => setPanel({ count: p })} className="font-semibold text-emerald-700">Count</button>}</span></div>
          </li>))}</ul>
        <div className="hidden sm:block border border-stone-200 rounded-xl overflow-hidden overflow-x-auto"><table className="w-full text-sm min-w-[560px]">
          <thead><tr className="bg-stone-50 border-b border-stone-200 text-left text-[13px] text-stone-500"><th className="px-4 py-3 font-semibold">Item</th><th className="px-4 py-3 font-semibold text-right">In stock</th><th className="px-4 py-3 font-semibold text-right">Reorder at</th><th className="px-4 py-3"><span className="sr-only">Actions</span></th></tr></thead>
          <tbody className="divide-y divide-stone-200">{products.map((p) => (
            <tr key={p.id}><td className="px-4 py-3 font-medium text-stone-800">{p.name}</td>
              <td className={`px-4 py-3 text-right font-semibold ${p.current_stock <= p.reorder_level ? "text-amber-700" : "text-stone-800"}`}>{p.current_stock} {p.unit}</td>
              <td className="px-4 py-3 text-right text-stone-500">{p.reorder_level || "—"}</td>
              <td className="px-4 py-3 text-right whitespace-nowrap"><button onClick={() => setPanel({ ledger: p })} className="text-[13px] font-semibold text-stone-700 hover:underline mr-3">History</button>{canManage && <button onClick={() => setPanel({ count: p })} className="text-[13px] font-semibold text-emerald-700 hover:underline">Count</button>}</td></tr>
          ))}</tbody></table></div>
        </>}
      </Card>

      <Card>
        <h2 className="text-lg font-bold text-stone-800 mb-3">Recent purchases</h2>
        {receipts.length === 0 ? <p className="text-sm text-stone-500">No purchases recorded yet.</p> : <ul className="divide-y divide-stone-200">{receipts.map((r) => (
          <li key={r.id} className="py-2.5 flex justify-between gap-3 text-sm"><span><b className="text-stone-800">{r.supplier_name}</b>{r.bill_number ? ` · Bill ${r.bill_number}` : ""} · {r.bill_date}<span className="block text-[13px] text-stone-500">{r.items.map((i) => `${i.qty} ${i.unit} ${i.item_name}`).join(", ")}</span></span><span className="font-semibold text-stone-800 whitespace-nowrap">{formatINR(r.grand_total)}</span></li>
        ))}</ul>}
      </Card>
    </div>
  );
}

function ReceiptForm({ products, onDone, onCancel }: { products: P[]; onDone: () => void; onCancel: () => void }) {
  const [suppliers, setSuppliers] = useState<S[]>([]);
  const [sup, setSup] = useState(""); const [newSup, setNewSup] = useState({ name: "", gstin: "" });
  const [bill, setBill] = useState({ number: "", date: new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10) });
  const [lines, setLines] = useState([{ item_id: "", qty: "", rate: "" }]);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  const k = useRef(newKey());
  useEffect(() => { fetch("/api/suppliers").then((r) => r.json()).then((d) => setSuppliers(d.suppliers || [])); }, []);
  const set = (i: number, patch: object) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const total = lines.reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.rate) || 0), 0);
  const ok = (sup && sup !== "__new" ? true : newSup.name.trim().length >= 2) && lines.every((l) => l.item_id && Number(l.qty) > 0 && Number(l.rate) >= 0);
  async function save() {
    setBusy(true); setErr(null);
    try {
      const r = await fetch("/api/receipts", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": k.current }, body: JSON.stringify({
        ...(sup && sup !== "__new" ? { supplier_id: sup } : { supplier_name: newSup.name.trim(), supplier_gstin: newSup.gstin.trim() }),
        bill_number: bill.number.trim(), bill_date: bill.date, items: lines.map((l) => { const [t, ...rest] = l.item_id.split(":"); return { item_type: t === "material" ? "material" : "product", item_id: rest.join(":"), qty: Number(l.qty), rate: Number(l.rate) }; }) }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) setErr(d.error || "Couldn't save the purchase."); else onDone();
    } catch { setErr("Couldn't reach Munshiji. Tap Save again; it won't be added twice."); } finally { setBusy(false); }
  }
  return (
    <Card aria-label="Record purchase" className="space-y-3">
      <h2 className="text-lg font-bold text-stone-800">Record purchase (goods received)</h2>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <select aria-label="Supplier" value={sup} onChange={(e) => setSup(e.target.value)} className={field}><option value="">Choose supplier…</option>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}<option value="__new">+ New supplier</option></select>
        <input aria-label="Supplier bill number" value={bill.number} onChange={(e) => setBill({ ...bill, number: e.target.value })} placeholder="Supplier bill no." className={field} />
        <input aria-label="Bill date" type="date" value={bill.date} onChange={(e) => setBill({ ...bill, date: e.target.value })} className={field} />
      </div>
      {sup === "__new" && <div className="grid grid-cols-1 sm:grid-cols-2 gap-2"><input aria-label="New supplier name" value={newSup.name} onChange={(e) => setNewSup({ ...newSup, name: e.target.value })} placeholder="Supplier name *" className={field} /><input aria-label="New supplier GSTIN" value={newSup.gstin} onChange={(e) => setNewSup({ ...newSup, gstin: e.target.value.toUpperCase() })} placeholder="GSTIN (for input credit)" maxLength={15} className={`${field} uppercase`} /></div>}
      {lines.map((l, i) => (
        <div key={i} className="grid grid-cols-12 gap-2">
          <select aria-label={`Item ${i + 1}`} value={l.item_id} onChange={(e) => set(i, { item_id: e.target.value })} className={`${field} col-span-12 sm:col-span-6`}><option value="">Choose item…</option>
            {products.some((p) => p.kind === "material") && <optgroup label="Raw materials">{products.filter((p) => p.kind === "material").map((p) => <option key={p.id} value={`material:${p.id}`}>{p.name} ({p.unit})</option>)}</optgroup>}
            {products.some((p) => p.kind !== "material") && <optgroup label="Finished goods">{products.filter((p) => p.kind !== "material").map((p) => <option key={p.id} value={`product:${p.id}`}>{p.name} ({p.unit})</option>)}</optgroup>}
          </select>
          <input aria-label={`Quantity ${i + 1}`} type="number" inputMode="decimal" value={l.qty} onChange={(e) => set(i, { qty: e.target.value })} placeholder="Qty" className={`${field} col-span-5 sm:col-span-2 text-right`} />
          <input aria-label={`Purchase rate ${i + 1}`} type="number" inputMode="decimal" value={l.rate} onChange={(e) => set(i, { rate: e.target.value })} placeholder="Rate ₹" className={`${field} col-span-5 sm:col-span-3 text-right`} />
          <button type="button" aria-label={`Remove item ${i + 1}`} disabled={lines.length === 1} onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} className="col-span-2 sm:col-span-1 grid place-items-center text-stone-400 hover:text-red-600 disabled:opacity-30"><IcTrash className="w-4 h-4" /></button>
        </div>
      ))}
      <button type="button" onClick={() => setLines((ls) => [...ls, { item_id: "", qty: "", rate: "" }])} className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-stone-700"><IcPlus className="w-4 h-4" /> Add item</button>
      <p className="text-sm text-stone-600">Before GST: <b>{formatINR(total)}</b>. GST is taken from each item&apos;s rate.</p>
      {err && <p role="alert" className="text-sm text-red-700">{err}</p>}
      <div className="flex gap-2"><button onClick={save} disabled={busy || !ok} className="h-10 px-4 rounded-xl bg-emerald-600 text-white text-sm font-semibold disabled:opacity-40">{busy ? "Saving…" : "Save purchase"}</button><button onClick={onCancel} className="h-10 px-4 rounded-xl border border-stone-300 text-sm font-semibold text-stone-700">Cancel</button></div>
    </Card>
  );
}

function CountForm({ p, onDone, onCancel }: { p: P; onDone: () => void; onCancel: () => void }) {
  const [qty, setQty] = useState(String(p.current_stock)); const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  async function save() {
    setBusy(true); setErr(null);
    try {
      const r = await fetch("/api/stock", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ item_type: p.kind || "product", item_id: p.id, new_qty: Number(qty), reason }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) setErr(d.error || "Couldn't save the count."); else onDone();
    } catch { setErr("Couldn't reach Munshiji. Try again."); } finally { setBusy(false); }
  }
  return (
    <Card aria-label={`Count ${p.name}`} className="space-y-3">
      <h2 className="text-lg font-bold text-stone-800">Count: {p.name}</h2>
      <p className="text-sm text-stone-600">Munshiji shows {p.current_stock} {p.unit}. Enter what you actually counted.</p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2"><input aria-label="Counted quantity" type="number" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} className={field} /><input aria-label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason, e.g. monthly count, damaged" maxLength={200} className={`${field} sm:col-span-2`} /></div>
      {err && <p role="alert" className="text-sm text-red-700">{err}</p>}
      <div className="flex gap-2"><button onClick={save} disabled={busy || qty === "" || reason.trim().length < 3} className="h-10 px-4 rounded-xl bg-emerald-600 text-white text-sm font-semibold disabled:opacity-40">{busy ? "Saving…" : "Save count"}</button><button onClick={onCancel} className="h-10 px-4 rounded-xl border border-stone-300 text-sm font-semibold text-stone-700">Cancel</button></div>
    </Card>
  );
}

function Ledger({ p, onClose }: { p: P; onClose: () => void }) {
  const [rows, setRows] = useState<L[]>([]);
  useEffect(() => { fetch(`/api/stock?item_type=${p.kind || "product"}&item_id=${encodeURIComponent(p.id)}`).then((r) => r.json()).then((d) => setRows(d.entries || [])); }, [p.id]);
  return (
    <Card aria-label={`History of ${p.name}`}>
      <div className="flex justify-between items-center mb-3"><h2 className="text-lg font-bold text-stone-800">History: {p.name}</h2><button onClick={onClose} className="text-[13px] font-semibold text-stone-600 hover:underline">Close</button></div>
      {rows.length === 0 ? <p className="text-sm text-stone-500">No stock movements yet.</p> : <ul className="divide-y divide-stone-200 text-sm">{rows.map((r) => (
        <li key={r.id} className="py-2 flex justify-between gap-3"><span><span className={r.direction === "in" ? "text-emerald-700 font-semibold" : "text-red-700 font-semibold"}>{r.direction === "in" ? "+" : "−"}{r.qty}</span> {REF[r.ref_type] || r.ref_type} {r.ref_type.startsWith("order") ? r.ref_id : ""}{r.notes ? ` · ${r.notes}` : ""}<span className="block text-xs text-stone-500">{r.created_at.slice(0, 16)}</span></span><span className="text-stone-700 whitespace-nowrap">Balance {r.balance_after ?? "—"} {p.unit}</span></li>
      ))}</ul>}
    </Card>
  );
}
