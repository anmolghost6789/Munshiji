"use client";
/* Munshiji UI kit — the building blocks of the approved design sample:
   avatars, stat tiles, change badges, period switcher, bar chart, gauge, orders table. */
import { useEffect, useMemo, useRef, useState } from "react";
import { formatINR } from "@/lib/types";
import { StateBadge, useStatus, type Order } from "./shared";
import { IcSearch, IcChevronRight, IcSend } from "../icons";
import { Mascot } from "../brand";

/* ── Avatars: initials on a soft tint picked from the name, so the same customer is always the same colour ── */
const AVATAR_TINTS = [
  "bg-emerald-50 text-emerald-800", "bg-amber-50 text-amber-800", "bg-blue-50 text-blue-800",
  "bg-pink-50 text-pink-800", "bg-teal-50 text-teal-800", "bg-violet-50 text-violet-800", "bg-orange-50 text-orange-800",
];
export function initials(name: string) {
  const words = (name || "?").replace(/[^\p{L}\p{N} ]/gu, " ").split(/\s+/).filter((w) => w && !/^(pvt|ltd|llp|private|limited|and|&)$/i.test(w));
  return ((words[0]?.[0] || "?") + (words[1]?.[0] || "")).toUpperCase();
}
function tintFor(name: string) {
  let h = 0;
  for (const ch of name || "") h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_TINTS[h % AVATAR_TINTS.length];
}
export function Avatar({ name, size = 32 }: { name: string; size?: number }) {
  return (
    <span aria-hidden="true" className={`inline-grid place-items-center rounded-full font-semibold shrink-0 ${tintFor(name)}`}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.4) }}>
      {initials(name)}
    </span>
  );
}

/* ── Card shell ── */
export function Card({ children, className = "", ...rest }: React.HTMLAttributes<HTMLElement> & { children: React.ReactNode }) {
  return <section {...rest} className={`bg-white border border-stone-200 rounded-[20px] shadow-card p-5 sm:p-6 min-w-0 ${className}`}>{children}</section>;
}

/* ── Change badge with a drawn arrow ── */
export function Delta({ value, suffix = "%", tone }: { value: number | null; suffix?: string; tone?: "up" | "down" | "flat" | "bad" }) {
  if (value === null || !Number.isFinite(value)) return null;
  const t = tone || (value > 0 ? "up" : value < 0 ? "down" : "flat");
  const cls = t === "up" ? "bg-emerald-50 text-emerald-700" : t === "down" || t === "bad" ? "bg-red-50 text-red-700" : "bg-stone-100 text-stone-600";
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 text-xs font-semibold leading-[18px] ${cls}`}>
      {(t === "up" || t === "down") && <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" style={{ transform: t === "down" ? "rotate(180deg)" : undefined }}><path d="M5 1.5l3.5 4H6v3H4v-3H1.5z" fill="currentColor" /></svg>}
      {t === "up" || t === "down" ? `${Math.abs(value).toLocaleString("en-IN", { maximumFractionDigits: 1 })}${suffix}` : `${value}${suffix}`}
    </span>
  );
}
export function Pill({ children, tone = "flat" }: { children: React.ReactNode; tone?: "flat" | "bad" | "good" }) {
  const cls = tone === "bad" ? "bg-red-50 text-red-700" : tone === "good" ? "bg-emerald-50 text-emerald-700" : "bg-stone-100 text-stone-600";
  return <span className={`inline-flex items-center rounded-full px-2 text-xs font-semibold leading-[18px] ${cls}`}>{children}</span>;
}

/* ── Count-up for headline figures (respects reduced motion) ── */
export function CountUp({ value, money = true }: { value: number; money?: boolean }) {
  const [shown, setShown] = useState(value);
  const from = useRef(0);
  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) { setShown(value); from.current = value; return; }
    const start = from.current, t0 = performance.now(), d = 800;
    let raf = 0;
    const tick = (t: number) => { const p = Math.min(1, (t - t0) / d); const e = 1 - Math.pow(1 - p, 3); setShown(start + (value - start) * e); if (p < 1) raf = requestAnimationFrame(tick); else from.current = value; };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return <>{money ? formatINR(Math.round(shown)) : Math.round(shown).toLocaleString("en-IN")}</>;
}

/* ── Segmented switcher ── */
export function Segmented<T extends string>({ options, value, onChange, label }: { options: { key: T; label: string }[]; value: T; onChange: (v: T) => void; label: string }) {
  return (
    <div role="group" aria-label={label} className="inline-flex p-1 rounded-xl bg-stone-50 border border-stone-200">
      {options.map((o) => (
        <button key={o.key} type="button" aria-pressed={value === o.key} onClick={() => onChange(o.key)}
          className={`px-3 py-1 rounded-[9px] text-[13px] font-semibold transition-colors ${value === o.key ? "bg-white text-stone-800 shadow-card" : "text-stone-500 hover:text-stone-700"}`}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* ── Rounded bars over a track; the latest period is highlighted ── */
export function BarChart({ points, height = 168, emptyText = "No sales in this period yet" }: { points: { label: string; value: number }[]; height?: number; emptyText?: string }) {
  const max = Math.max(1, ...points.map((p) => p.value));
  const empty = points.every((p) => !p.value);
  const [ready, setReady] = useState(false);
  useEffect(() => { const id = requestAnimationFrame(() => setReady(true)); return () => cancelAnimationFrame(id); }, [points]);
  return (
    <div className="relative mt-4 flex-1 flex flex-col" style={{ minHeight: height }}>
      {empty && <p className="absolute inset-x-0 top-1/3 text-center text-[13px] text-stone-500 z-10">{emptyText}</p>}
      <ul className="flex-1 grid gap-2 sm:gap-3 items-end" style={{ gridTemplateColumns: `repeat(${points.length}, minmax(0,1fr))` }} aria-label="Sales by period">
        {points.map((p, i) => {
          const last = i === points.length - 1;
          return (
            <li key={p.label} className="group relative h-full rounded-xl bg-stone-100 flex items-end" tabIndex={0} aria-label={`${p.label}: ${formatINR(p.value)}`}>
              <span aria-hidden="true" className="pointer-events-none absolute left-1/2 -translate-x-1/2 -top-8 whitespace-nowrap rounded-lg bg-stone-800 px-2 py-0.5 text-xs font-semibold text-white opacity-0 group-hover:opacity-100 group-focus:opacity-100 transition-opacity">{formatINR(p.value)}</span>
              <span className={`block w-full rounded-xl transition-[height] duration-700 ease-out ${last ? "bg-emerald-600" : "bg-emerald-300 group-hover:bg-emerald-500"}`}
                style={{ height: ready ? `${p.value > 0 ? Math.max(4, (p.value / max) * 100) : 0}%` : "0%" }} />
            </li>
          );
        })}
      </ul>
      <div className="grid gap-2 sm:gap-3 mt-2 text-xs text-stone-500 text-center" style={{ gridTemplateColumns: `repeat(${points.length}, minmax(0,1fr))` }} aria-hidden="true">
        {points.map((p) => <span key={p.label}>{p.label}</span>)}
      </div>
    </div>
  );
}

/* ── Half gauge: share of money to collect that is overdue ── */
export function Gauge({ overdueShare, label }: { overdueShare: number; label: string }) {
  const over = Math.max(0, Math.min(100, Math.round(overdueShare)));
  return (
    <svg viewBox="0 0 220 118" className="w-full max-w-[300px]" role="img" aria-label={`${over}% ${label}`}>
      <path d="M20 108a90 90 0 01180 0" fill="none" className="stroke-stone-100" strokeWidth="18" strokeLinecap="round" />
      {over < 100 && <path d="M20 108a90 90 0 01180 0" fill="none" className="stroke-emerald-500" strokeWidth="18" strokeLinecap="round" pathLength={100} strokeDasharray={`${100 - over} 100`} strokeDashoffset={-over} />}
      {over > 0 && <path d="M20 108a90 90 0 01180 0" fill="none" stroke="#e5484d" strokeWidth="18" strokeLinecap="round" pathLength={100} strokeDasharray={`${over} 100`} />}
      <text x="110" y="92" textAnchor="middle" fontSize="28" fontWeight="700" className="fill-stone-800">{over}%</text>
      <text x="110" y="110" textAnchor="middle" fontSize="12" className="fill-stone-500">{label}</text>
    </svg>
  );
}

/* ── Stat tile ── */
export function StatTile({ label, value, foot, tone, onClick }: { label: string; value: React.ReactNode; foot?: React.ReactNode; tone?: "bad"; onClick?: () => void }) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag onClick={onClick} className={`w-full h-full text-left bg-white border border-stone-200 rounded-[20px] shadow-card p-4 sm:p-6 min-w-0 ${onClick ? "hover:border-stone-300 transition-colors" : ""}`}>
      <div className="text-[13px] sm:text-sm font-medium text-stone-600">{label}</div>
      <div className={`figure-num text-2xl sm:text-[28px] font-bold mt-0.5 ${tone === "bad" ? "text-red-700" : "text-stone-800"}`}>{value}</div>
      {foot && <div className="mt-1.5 flex items-center gap-2 text-[13px] text-stone-500 whitespace-nowrap overflow-hidden">{foot}</div>}
    </Tag>
  );
}

/* ── Orders table: a table on desktop, tappable cards on phones ── */
export function OrdersTable({ orders, onOpen, onRemind, showFilters = true, title = "Orders", action, initialStatus = "", searchRef }: {
  orders: Order[]; onOpen: (o: Order) => void; onRemind?: (o: Order) => void; showFilters?: boolean; title?: string; action?: React.ReactNode; initialStatus?: string; searchRef?: React.RefObject<HTMLInputElement | null>;
}) {
  const { resolve, biz, overdueDays } = useStatus();
  const [status, setStatus] = useState(initialStatus);
  const [cust, setCust] = useState("");
  const [q, setQ] = useState("");
  const statuses = useMemo(() => [...new Set(orders.map((o) => o.display_state || o.state))], [orders]);
  const customers = useMemo(() => [...new Set(orders.map((o) => o.customer_name))].sort(), [orders]);
  const list = orders.filter((o) => (!status || (o.display_state || o.state) === status) && (!cust || o.customer_name === cust) &&
    (!q || [o.id, o.customer_name, ...o.items.map((i) => i.product_name)].some((t) => t.toLowerCase().includes(q.toLowerCase()))));

  const dueText = (o: Order) => {
    const st = o.display_state || o.state;
    if (st === "overdue") { const late = (o.bill_age_days ?? 0) - overdueDays; return { text: `${late} ${late === 1 ? "day" : "days"} late`, late: true }; }
    if (st === "invoiced" && biz.caps.credit) { const left = overdueDays - (o.bill_age_days ?? 0); return { text: left <= 0 ? "Due today" : `Due in ${left} ${left === 1 ? "day" : "days"}`, late: false }; }
    if (st === "paid") return { text: "Paid", late: false };
    if (st === "delivered") return { text: "Bill pending", late: false };
    return { text: o.delivery_date ? `By ${new Date(o.delivery_date).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}` : "—", late: false };
  };
  const sel = "appearance-none h-10 pl-3 pr-8 rounded-[10px] border border-stone-300 bg-white text-[13px] font-medium text-stone-700 bg-[length:12px] bg-no-repeat bg-[right_10px_center] min-w-0";
  const chevron = { backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' fill='none' stroke='%236b746f' stroke-width='2'%3E%3Cpath d='M3 4.5l3 3 3-3'/%3E%3C/svg%3E\")" };

  return (
    <Card>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
        <h2 className="text-lg font-bold text-stone-800">{title}<span className="ml-2 text-[13px] font-medium text-stone-500">{list.length} {list.length === 1 ? "order" : "orders"}</span></h2>
        <div className="flex flex-wrap gap-2 items-center">
          {showFilters && <>
            <label className="relative flex-1 sm:flex-none min-w-[140px]">
              <span className="sr-only">Search orders</span>
              <IcSearch className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400" />
              <input ref={searchRef} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" className="h-10 w-full sm:w-44 pl-9 pr-3 rounded-[10px] border border-stone-300 bg-white text-[13px] text-stone-800 placeholder-stone-400 focus:outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-200" />
            </label>
            <label className="sr-only" htmlFor="ot-status">Status</label>
            <select id="ot-status" value={status} onChange={(e) => setStatus(e.target.value)} className={sel} style={chevron}>
              <option value="">All statuses</option>
              {statuses.map((s) => <option key={s} value={s}>{resolve(s).label}</option>)}
            </select>
            <label className="sr-only" htmlFor="ot-cust">{biz.words.customer}</label>
            <select id="ot-cust" value={cust} onChange={(e) => setCust(e.target.value)} className={`${sel} max-w-[200px]`} style={chevron}>
              <option value="">All {biz.words.customers.toLowerCase()}</option>
              {customers.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </>}
          {action}
        </div>
      </div>

      {list.length === 0 ? (
        <div className="py-8 flex flex-col items-center text-center">
          <Mascot pose="magnifying-glass" height={112} decorative />
          <p className="mt-2 text-sm font-semibold text-stone-800">{orders.length ? "No orders match" : "No orders yet"}</p>
          <p className="text-[13px] text-stone-500 mt-0.5">{orders.length ? "Try clearing the search or filters." : "Paste a WhatsApp message and Munshiji will turn it into an order."}</p>
          {(q || status || cust) && <button type="button" onClick={() => { setQ(""); setStatus(""); setCust(""); }} className="mt-3 h-9 px-3 rounded-[10px] border border-stone-300 bg-white text-[13px] font-semibold text-stone-700 hover:bg-stone-50">Clear filters</button>}
        </div>
      ) : <>
        {/* Desktop table */}
        <div className="hidden md:block border border-stone-200 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead><tr className="bg-stone-50 border-b border-stone-200 text-left text-[13px] font-semibold text-stone-500">
              <th className="px-4 py-3 font-semibold">{biz.words.customer}</th><th className="px-4 py-3 font-semibold">Items</th><th className="px-4 py-3 font-semibold">Status</th><th className="px-4 py-3 font-semibold">Due</th><th className="px-4 py-3 font-semibold text-right">Amount</th><th className="px-4 py-3"><span className="sr-only">Actions</span></th>
            </tr></thead>
            <tbody className="divide-y divide-stone-200">
              {list.map((o) => {
                const d = dueText(o); const st = o.display_state || o.state;
                const canRemind = onRemind && biz.caps.credit && (st === "overdue" || st === "invoiced");
                return (
                  <tr key={o.id} className="hover:bg-stone-50 cursor-pointer" onClick={() => onOpen(o)}>
                    <td className="px-4 py-3"><div className="flex items-center gap-3 min-w-0"><Avatar name={o.customer_name} /><div className="min-w-0"><div className="font-semibold text-stone-800 truncate max-w-[220px]">{o.customer_name}</div><div className="text-[13px] text-stone-500">{o.id}</div></div></div></td>
                    <td className="px-4 py-3 text-stone-600"><div className="truncate max-w-[260px]">{o.items.map((i) => `${i.qty} × ${i.product_name}`).join(", ")}</div></td>
                    <td className="px-4 py-3"><StateBadge state={st} /></td>
                    <td className={`px-4 py-3 text-[13px] whitespace-nowrap ${d.late ? "text-red-700 font-semibold" : "text-stone-600"}`}>{d.text}</td>
                    <td className="px-4 py-3 text-right font-bold text-stone-800 whitespace-nowrap">{formatINR(o.grand_total)}</td>
                    <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                      {canRemind
                        ? <button type="button" onClick={() => onRemind!(o)} aria-label={`Send payment reminder to ${o.customer_name}`} title="Send payment reminder" className="w-9 h-9 inline-grid place-items-center rounded-[10px] border border-stone-300 text-stone-600 hover:text-emerald-700 hover:border-emerald-500"><IcSend className="w-4 h-4" /></button>
                        : <button type="button" onClick={() => onOpen(o)} aria-label={`Open ${o.id}`} className="w-9 h-9 inline-grid place-items-center rounded-[10px] border border-stone-300 text-stone-600 hover:text-stone-800"><IcChevronRight className="w-4 h-4" /></button>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {/* Phone cards */}
        <ul className="md:hidden flex flex-col gap-2">
          {list.map((o) => {
            const d = dueText(o);
            return (
              <li key={o.id}>
                <button type="button" onClick={() => onOpen(o)} className="w-full text-left grid grid-cols-[auto_1fr_auto] gap-x-3 gap-y-1.5 items-center rounded-2xl border border-stone-200 bg-white p-3">
                  <Avatar name={o.customer_name} />
                  <span className="min-w-0"><span className="block font-semibold text-stone-800 line-clamp-2 leading-snug">{o.customer_name}</span><span className="block text-[13px] text-stone-500">{o.id}</span></span>
                  <span className="font-bold text-stone-800 whitespace-nowrap">{formatINR(o.grand_total)}</span>
                  <span className="col-start-2 col-span-2 text-[13px] text-stone-600 truncate">{o.items.map((i) => `${i.qty} × ${i.product_name}`).join(", ")}</span>
                  <span className="col-start-2"><StateBadge state={o.display_state || o.state} size="xs" /></span>
                  <span className={`text-[13px] text-right whitespace-nowrap ${d.late ? "text-red-700 font-semibold" : "text-stone-600"}`}>{d.text}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </>}
    </Card>
  );
}
