"use client";
/* Order details: every action shows its result (or the server's reason for refusing), and only the
   actions this person's role allows are offered. Payments and history live here too. */
import { useCallback, useEffect, useRef, useState } from "react";
import { IcX, IcPhone, IcMapPin, IcSend, IcArrowRight, IcFile, IcEdit, IcBan } from "../icons";
import { ORDER_FLOW, formatINR } from "@/lib/types";
import { nextStateIn, whatsappLink } from "@/lib/business";
import { Mascot } from "../brand";
import { StateBadge, GstBreakdown, useStatus, type Order } from "./shared";
import { OrderEditor } from "./order-editor";
import { reminderText } from "./modals";
import { TransportSection, IrnSection, CreditNotesSection, CreditNoteView, type CreditNote } from "./gst-docs";

interface Payment { id: string; amount: number; mode: string; reference: string; received_on: string; voided: number; void_reason: string }
interface Hist { id: number; user_name: string; action: string; details: string; created_at: string }
const MODES = [["upi", "UPI"], ["bank", "Bank transfer"], ["cash", "Cash"], ["cheque", "Cheque"], ["other", "Other"]] as const;
const ACTION_TEXT: Record<string, string> = { "order.create": "created the order", "order.edit": "edited the order", "order.advance": "moved it forward", "order.cancel": "cancelled it", "invoice.create": "made the bill", "payment.record": "recorded a payment", "payment.void": "removed a payment" };
const key = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `k-${Date.now()}-${Math.random()}`);
const today = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);

export function OrderDrawer({ order: initial, onClose, onRefresh, onViewBill }: { order: Order | null; onClose: () => void; onRefresh: () => void; onViewBill?: (o: Order) => void }) {
  const { resolve, overdueDays, biz, upiId, companyName, role } = useStatus();
  const [order, setOrder] = useState<Order | null>(initial);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [history, setHistory] = useState<Hist[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"view" | "edit" | "pay" | "cancel">("view");
  const [bill, setBill] = useState<{ id: string; invoice_number: string; einvoice_required: number; irn: string } | null>(null);
  const [notes, setNotes] = useState<CreditNote[]>([]);
  const [viewNote, setViewNote] = useState<CreditNote | null>(null);
  const [extra, setExtra] = useState<{ ewb_threshold: number; seller: { name: string; gstin: string; address: string } }>({ ewb_threshold: 50000, seller: { name: "", gstin: "", address: "" } });
  const [transportOpen, setTransportOpen] = useState(false);
  const canMoney = role === "owner" || role === "manager";

  const load = useCallback(async (id: string) => {
    const r = await fetch(`/api/orders?id=${encodeURIComponent(id)}`);
    if (!r.ok) return;
    const d = await r.json();
    setOrder({ ...d.order, items: d.items }); setPayments(d.payments || []); setHistory(d.history || []);
    setBill(d.bill || null); setNotes(d.credit_notes || []); setExtra({ ewb_threshold: d.ewb_threshold ?? 50000, seller: d.seller || { name: "", gstin: "", address: "" } });
  }, []);
  useEffect(() => { setOrder(initial); setMode("view"); setError(null); if (initial) load(initial.id); }, [initial, load]);

  if (!order) return null;
  const shown = order.display_state || order.state;
  const next = nextStateIn(biz.flow, order.state);
  const credited = (order as { amount_credited?: number }).amount_credited || 0;
  const balance = Math.max(0, Math.round((order.grand_total - (order.amount_paid || 0) - credited) * 100) / 100);
  const refundDue = Math.max(0, Math.round(((order.amount_paid || 0) - (order.grand_total - credited)) * 100) / 100);
  const daysLate = (order.bill_age_days ?? 0) - overdueDays;
  const editable = ["new", "confirmed", "preparing"].includes(order.state) && !order.stock_deducted && !order.invoice_number;
  const canAdvance = next && next !== "paid" && order.state !== "cancelled" && (next !== "invoiced" || canMoney);

  async function act(body: object) {
    setBusy(true); setError(null);
    try {
      const r = await fetch("/api/orders", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: order!.id, ...body }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setError(d.error || `Couldn't update (error ${r.status}).`); if (d.details?.needs) setTransportOpen(true); return false; }
      await load(order!.id); onRefresh(); return true;
    } catch { setError("Couldn't reach Munshiji. Nothing was changed. Try again."); return false; }
    finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 bg-black/30 z-50" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={`Order ${order.id}`} className="absolute top-0 right-0 h-full w-full sm:max-w-lg bg-white shadow-2xl flex flex-col stone-fade-in" onClick={(e) => e.stopPropagation()}>
        <div className="p-5 border-b border-stone-100 shrink-0 flex justify-between items-start">
          <div>
            <div className="flex items-center gap-2.5"><h2 className="text-lg font-bold text-stone-800">{order.id}</h2><StateBadge state={shown} /></div>
            <div className="text-xs text-stone-500 mt-0.5">{order.created_at?.slice(0, 10)}{order.source === "whatsapp" ? " · from WhatsApp" : ""}{order.invoice_number ? ` · Bill ${order.invoice_number}` : ""}</div>
          </div>
          <button onClick={onClose} aria-label="Close" className="p-1.5 rounded-lg text-stone-400 hover:bg-stone-100"><IcX className="w-5 h-5" /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4 stone-scrollbar">
          {mode === "edit" ? (
            <OrderEditor mode="edit" orderId={order.id} version={order.version}
              initial={{ customer: { id: order.customer_id }, items: order.items.map((i) => ({ product_id: i.product_id, name: i.product_name, qty: i.qty, price: i.price })), delivery_date: order.delivery_date, delivery_state: (order as { delivery_state?: string }).delivery_state, notes: order.notes, raw_message: order.raw_message }}
              onCancel={() => setMode("view")} onSaved={async () => { setMode("view"); await load(order.id); onRefresh(); }} />
          ) : <>
            <div>
              <div className="text-base font-semibold text-stone-800">{order.customer_name}</div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1 text-xs text-stone-500">
                {order.customer_phone && <span className="flex items-center gap-1"><IcPhone className="w-3 h-3" />{order.customer_phone}</span>}
                {order.customer_address && <span className="flex items-center gap-1"><IcMapPin className="w-3 h-3" />{order.customer_address}</span>}
                {order.delivery_date && <span>Deliver by {order.delivery_date}</span>}
              </div>
            </div>
            {order.state === "cancelled" && <div className="rounded-2xl border border-stone-300 bg-stone-50 p-3 text-sm text-stone-700"><b>Cancelled.</b> {order.cancel_reason}</div>}
            {order.raw_message && <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3"><div className="text-[13px] font-medium text-emerald-700 mb-1">Original message</div><p className="text-sm text-stone-700 italic whitespace-pre-wrap">{order.raw_message}</p></div>}
            <div className="rounded-2xl border border-stone-200 overflow-hidden">{order.items.map((it, i) => (
              <div key={i} className={`flex justify-between items-center px-4 py-3 ${i ? "border-t border-stone-100" : ""}`}>
                <div><div className="text-sm font-medium text-stone-800">{it.product_name}</div><div className="text-xs text-stone-500">{it.qty} {it.unit} × {formatINR(it.price)} · HSN {it.hsn_code || "—"} · {it.gst_rate}%</div></div>
                <div className="text-sm font-semibold text-stone-800">{formatINR(it.total)}</div>
              </div>))}
            </div>
            <div className="rounded-xl border border-stone-200 bg-stone-50 p-4 space-y-1.5">
              <div className="flex justify-between text-xs text-stone-500"><span>Subtotal</span><span className="font-mono">{formatINR(order.subtotal)}</span></div>
              <GstBreakdown items={order.items} customerGstin={order.customer_gstin} deliveryState={(order as { delivery_state?: string }).delivery_state} />
              <div className="flex justify-between text-base font-bold text-stone-800 pt-2 border-t border-stone-200"><span>Total</span><span className="font-mono">{formatINR(order.grand_total)}</span></div>
              {credited > 0 && <div className="flex justify-between text-sm text-stone-600"><span>Credit notes</span><span className="font-mono">− {formatINR(credited)}</span></div>}
              {(order.amount_paid || 0) > 0 && <div className="flex justify-between text-sm text-emerald-700"><span>Received</span><span className="font-mono">− {formatINR(order.amount_paid || 0)}</span></div>}
              {refundDue > 0 && <div className="flex justify-between text-sm font-bold text-amber-800"><span>Refund due to buyer</span><span className="font-mono">{formatINR(refundDue)}</span></div>}
              {order.invoice_number && order.state !== "paid" && <div className="flex justify-between text-sm font-bold text-stone-800"><span>Balance due</span><span className="font-mono">{formatINR(balance)}</span></div>}
            </div>
            {order.state !== "cancelled" && <div><div className="text-[13px] font-medium text-stone-500 mb-2">Progress</div><div className="flex flex-wrap gap-1.5">{ORDER_FLOW.filter((s) => biz.flow.includes(s.key)).map((s, i, arr) => {
              const ci = arr.findIndex((x) => x.key === (order.state === "overdue" ? "invoiced" : order.state));
              return <span key={s.key} className={`text-xs px-2 py-0.5 rounded-full font-semibold border ${i <= ci ? "bg-emerald-600 text-white border-emerald-600" : "bg-white text-stone-500 border-stone-200"}`}>{resolve(s.key).label}</span>;
            })}</div></div>}

            {order.state === "paid" && <div className="flex items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-3"><Mascot pose="folded-hands" height={64} decorative /><div><p className="text-sm font-semibold text-emerald-800">Payment received. Dhanyavaad!</p><p className="text-[13px] text-stone-600">This order is complete.</p></div></div>}
            {biz.caps.credit && shown === "overdue" && <div className="flex items-center gap-3 rounded-2xl border border-red-200 bg-red-50 p-3"><Mascot pose="concerned" height={64} decorative /><div><p className="text-sm font-semibold text-red-700">Payment is {daysLate} {daysLate === 1 ? "day" : "days"} late</p><p className="text-[13px] text-stone-600">{formatINR(balance)} still due. Bill is {order.bill_age_days} days old; your terms are {overdueDays} days.</p></div></div>}

            {order.state !== "cancelled" && order.state !== "new" && <TransportSection key={`${order.id}-${order.version}-${transportOpen}`} order={order} threshold={extra.ewb_threshold} registered={biz.registration !== "none"} open={transportOpen} onSaved={async () => { setTransportOpen(false); setError(null); await load(order.id); onRefresh(); }} />}
            {canMoney && bill?.einvoice_required === 1 && !bill.irn && <IrnSection kind="invoice" id={bill.id} number={bill.invoice_number} onSaved={async () => { await load(order.id); onRefresh(); }} />}
            {canMoney && order.invoice_number && <CreditNotesSection order={order} notes={notes} billNumber={order.invoice_number} canIssue={canMoney} onSaved={async () => { await load(order.id); onRefresh(); }} onView={setViewNote} />}
            {canMoney && order.invoice_number && <section aria-label="Payments" className="space-y-2">
              <div className="text-[13px] font-medium text-stone-500">Payments</div>
              {payments.length === 0 ? <p className="text-sm text-stone-500">No payments recorded yet.</p> : payments.map((p) => (
                <div key={p.id} className={`flex justify-between items-center text-sm rounded-xl border px-3 py-2 ${p.voided ? "border-stone-200 text-stone-400 line-through" : "border-stone-200"}`}>
                  <span>{p.received_on} · {MODES.find((m) => m[0] === p.mode)?.[1] || p.mode}{p.reference ? ` · ${p.reference}` : ""}{p.voided ? ` (removed: ${p.void_reason})` : ""}</span>
                  <span className="flex items-center gap-2 font-semibold">{formatINR(p.amount)}{!p.voided && role === "owner" && <VoidButton id={p.id} onDone={async () => { await load(order.id); onRefresh(); }} onError={setError} />}</span>
                </div>
              ))}
              {mode === "pay" && <PaymentForm orderId={order.id} balance={balance} onDone={async () => { setMode("view"); await load(order.id); onRefresh(); }} onCancel={() => setMode("view")} />}
            </section>}

            {mode === "cancel" && <CancelForm busy={busy} onCancel={() => setMode("view")} onConfirm={async (reason) => { if (await act({ action: "cancel", reason })) setMode("view"); }} />}

            {history.length > 0 && <details><summary className="text-[13px] font-medium text-stone-500 cursor-pointer">History</summary>
              <ul className="mt-2 space-y-1 text-xs text-stone-600">{history.map((h) => <li key={h.id}><span className="text-stone-400">{h.created_at.slice(0, 16)}</span> · <b>{h.user_name}</b> {ACTION_TEXT[h.action] || h.action}{(() => { try { const d = JSON.parse(h.details || "{}"); return d.to ? ` → ${resolve(d.to).label}` : d.amount ? ` (${formatINR(d.amount)})` : d.invoice_number ? ` ${d.invoice_number}` : d.reason ? `: ${d.reason}` : ""; } catch { return ""; } })()}</li>)}</ul>
            </details>}
          </>}
        </div>

        {viewNote && <CreditNoteView note={viewNote} order={order} billNumber={order.invoice_number || ""} seller={extra.seller} onClose={() => setViewNote(null)} />}
        {mode === "view" && <div className="p-4 border-t border-stone-100 space-y-2 safe-bottom shrink-0">
          {error && <p role="alert" className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-3 py-2">{error}</p>}
          {canAdvance && <button onClick={() => act({ action: "advance", to: next, version: order.version })} disabled={busy} className="w-full h-11 inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 disabled:opacity-50">
            {busy ? "Working…" : next === "invoiced" ? <><IcFile className="w-4 h-4" /> Make the bill</> : <>Move to {resolve(next!).label} <IcArrowRight className="w-4 h-4" /></>}</button>}
          {canMoney && order.invoice_number && ["invoiced", "overdue"].includes(order.state) && <button onClick={() => setMode("pay")} className="w-full h-11 rounded-xl bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700">Record payment</button>}
          <div className="flex flex-wrap gap-2">
            {editable && <button onClick={() => setMode("edit")} className="flex-1 h-10 inline-flex items-center justify-center gap-1.5 rounded-xl border border-stone-300 text-sm font-semibold text-stone-700 hover:bg-stone-50"><IcEdit className="w-4 h-4" /> Edit</button>}
            {order.invoice_number && onViewBill && <button onClick={() => onViewBill(order)} className="flex-1 h-10 inline-flex items-center justify-center gap-1.5 rounded-xl border border-stone-300 text-sm font-semibold text-stone-700 hover:bg-stone-50"><IcFile className="w-4 h-4" /> View bill</button>}
            {biz.caps.credit && ["invoiced", "overdue"].includes(order.state) && <a href={whatsappLink(order.customer_phone, reminderText({ ...order, grand_total: balance }, companyName, upiId, shown === "overdue" ? daysLate : 0))} target="_blank" rel="noopener noreferrer" className="flex-1 h-10 inline-flex items-center justify-center gap-1.5 rounded-xl border border-emerald-600 text-sm font-semibold text-emerald-700 hover:bg-emerald-50"><IcSend className="w-4 h-4" /> Reminder</a>}
            {canMoney && !order.invoice_number && order.state !== "cancelled" && <button onClick={() => setMode("cancel")} className="h-10 px-3 inline-flex items-center justify-center gap-1.5 rounded-xl border border-stone-300 text-sm font-semibold text-red-700 hover:bg-red-50"><IcBan className="w-4 h-4" /> Cancel</button>}
          </div>
        </div>}
      </div>
    </div>
  );
}

function PaymentForm({ orderId, balance, onDone, onCancel }: { orderId: string; balance: number; onDone: () => void; onCancel: () => void }) {
  const [f, setF] = useState({ amount: String(balance), mode: "upi", reference: "", received_on: today() });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const k = useRef(key());
  const field = "h-10 px-3 rounded-[10px] border border-stone-300 bg-white text-sm text-stone-800 focus:outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-200";
  async function submit() {
    setBusy(true); setErr(null);
    try {
      const r = await fetch("/api/payments", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": k.current }, body: JSON.stringify({ order_id: orderId, amount: Number(f.amount), mode: f.mode, reference: f.reference, received_on: f.received_on }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) setErr(d.error || "Couldn't record the payment."); else onDone();
    } catch { setErr("Couldn't reach Munshiji. Tap Save again; it won't be recorded twice."); } finally { setBusy(false); }
  }
  return (
    <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-3 space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <label className="text-xs font-semibold text-stone-700">Amount ₹<input type="number" inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} className={`${field} w-full mt-1`} /></label>
        <label className="text-xs font-semibold text-stone-700">Received on<input type="date" value={f.received_on} max={today()} onChange={(e) => setF({ ...f, received_on: e.target.value })} className={`${field} w-full mt-1`} /></label>
        <label className="text-xs font-semibold text-stone-700">How<select value={f.mode} onChange={(e) => setF({ ...f, mode: e.target.value })} className={`${field} w-full mt-1`}>{MODES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
        <label className="text-xs font-semibold text-stone-700">Reference<input value={f.reference} maxLength={80} onChange={(e) => setF({ ...f, reference: e.target.value })} placeholder="UTR / cheque no." className={`${field} w-full mt-1`} /></label>
      </div>
      <p className="text-xs text-stone-600">Balance due: {formatINR(balance)}. A part payment keeps the order open until the rest arrives.</p>
      {err && <p role="alert" className="text-sm text-red-700">{err}</p>}
      <div className="flex gap-2"><button onClick={submit} disabled={busy || !(Number(f.amount) > 0)} className="h-10 px-4 rounded-xl bg-emerald-600 text-white text-sm font-semibold disabled:opacity-40">{busy ? "Saving…" : "Save payment"}</button><button onClick={onCancel} className="h-10 px-4 rounded-xl border border-stone-300 bg-white text-sm font-semibold text-stone-700">Cancel</button></div>
    </div>
  );
}

function VoidButton({ id, onDone, onError }: { id: string; onDone: () => void; onError: (m: string) => void }) {
  return <button aria-label="Remove this payment" title="Remove (recorded by mistake)" className="text-xs font-semibold text-red-700 hover:underline" onClick={async () => {
    const reason = window.prompt("Why remove this payment? (e.g. cheque bounced, entered twice)");
    if (!reason) return;
    const r = await fetch("/api/payments", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ payment_id: id, reason }) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) onError(d.error || "Couldn't remove the payment."); else onDone();
  }}>Remove</button>;
}

function CancelForm({ busy, onConfirm, onCancel }: { busy: boolean; onConfirm: (reason: string) => void; onCancel: () => void }) {
  const [reason, setReason] = useState("");
  return (
    <div className="rounded-2xl border border-red-200 bg-red-50 p-3 space-y-2">
      <label className="text-sm font-semibold text-red-800">Why cancel this order?<input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} placeholder="e.g. Buyer cancelled on phone" className="mt-1 w-full h-10 px-3 rounded-[10px] border border-stone-300 bg-white text-sm" /></label>
      <p className="text-xs text-stone-600">Any stock already dispatched goes back into stock.</p>
      <div className="flex gap-2"><button onClick={() => onConfirm(reason)} disabled={busy || reason.trim().length < 3} className="h-10 px-4 rounded-xl bg-red-600 text-white text-sm font-semibold disabled:opacity-40">Cancel order</button><button onClick={onCancel} className="h-10 px-4 rounded-xl border border-stone-300 bg-white text-sm font-semibold text-stone-700">Keep order</button></div>
    </div>
  );
}
