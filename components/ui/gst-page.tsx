"use client";
import { useEffect, useState } from "react";
import { IcAlertTriangle, IcCheck, IcDownload, IcFile } from "../icons";
import { formatINR } from "@/lib/types";
import { Mascot } from "../brand";

type Totals = { taxable: number; igst: number; cgst: number; sgst: number };
interface Check { level: "error" | "warning" | "info"; message: string; refs?: string[] }
interface Regular {
  registration: "regular"; month: string; checks: Check[];
  gstr1: { bills: number; b2b: unknown[]; b2cl: unknown[]; b2cs: unknown[]; hsn: unknown[]; cdnr: unknown[]; cdnur: unknown[]; totals: { b2b: Totals; b2cl: Totals; b2cs: Totals; cdnr: Totals; cdnur: Totals; nilExempt: number }; due: string };
  gstr3b: { outward: Totals; nilExempt: number; itc: { igst: number; cgst: number; sgst: number }; estimatedPayable: number; due: string };
}
interface Composition {
  registration: "composition"; month: string; checks: Check[];
  cmp08: { quarter: string; bills: number; turnover: number; rate: number; tax: number; cgst: number; sgst: number; due: string };
}
type Data = Regular | Composition;

const thisMonth = () => new Date().toISOString().slice(0, 7);
const prettyDate = (d: string) => new Date(d + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
const monthName = (m: string) => new Date(m + "-01T00:00:00").toLocaleDateString("en-IN", { month: "long", year: "numeric" });

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return <div className={`flex justify-between gap-4 py-1.5 ${strong ? "border-t border-stone-200 mt-1 pt-2.5 font-bold text-stone-800" : "text-sm text-stone-700"}`}><span>{label}</span><span className="font-mono">{value}</span></div>;
}

function Checklist({ checks }: { checks: Check[] }) {
  const blocking = checks.filter((c) => c.level !== "info");
  return (
    <div className={`rounded-[20px] border p-4 sm:p-5 mb-5 flex gap-4 items-start ${blocking.length ? "border-amber-200 bg-amber-50" : "border-emerald-200 bg-emerald-50"}`}>
      <Mascot pose={blocking.length ? "pointing" : "ledger"} height={88} decorative className="hidden sm:block" />
      <div className="min-w-0 flex-1">
      <div className="flex items-center gap-2 mb-1">
        {blocking.length ? <IcAlertTriangle className="w-4 h-4 text-amber-700" /> : <IcCheck className="w-4 h-4 text-emerald-700" />}
        <h2 className={`text-sm font-semibold ${blocking.length ? "text-amber-900" : "text-emerald-800"}`}>
          {blocking.length ? `${blocking.length} ${blocking.length === 1 ? "thing" : "things"} to fix before filing` : "Your bills look ready"}
        </h2>
      </div>
      {checks.length > 0 && <ul className="mt-2 space-y-2">
        {checks.map((c, i) => (
          <li key={i} className="text-sm">
            <span className={`font-semibold ${c.level === "error" ? "text-red-700" : c.level === "warning" ? "text-amber-800" : "text-stone-600"}`}>{c.level === "error" ? "Fix: " : c.level === "warning" ? "Check: " : "Note: "}</span>
            <span className="text-stone-700">{c.message}</span>
            {c.refs && c.refs.length > 0 && <details className="mt-1"><summary className="text-xs text-stone-600 cursor-pointer">Show {c.refs.length}</summary><ul className="mt-1 text-xs font-mono text-stone-600 space-y-0.5">{c.refs.slice(0, 50).map((r) => <li key={r}>{r}</li>)}</ul></details>}
          </li>
        ))}
      </ul>}
      </div>
    </div>
  );
}

export function GstPage() {
  const [month, setMonth] = useState(thisMonth());
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true); setError("");
    fetch(`/api/gst-returns?month=${month}`).then(async (r) => {
      const d = await r.json();
      if (!alive) return;
      if (!r.ok) { setError(d.error || "Couldn't prepare returns"); setData(null); } else setData(d);
    }).catch(() => alive && setError("Couldn't reach the server. Check your connection.")).finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [month]);

  const csv = (section: string) => `/api/gst-returns?month=${month}&format=csv&section=${section}`;

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3 mb-2">
        <div>
          <h1 className="text-2xl sm:text-[28px] font-bold tracking-tight text-stone-800">GST</h1>
          <p className="text-sm text-stone-600 mt-0.5">Munshiji prepares your return figures from your bills. File them on the GST portal, or share with your CA.</p>
        </div>
        <label className="text-xs font-medium text-stone-700 shrink-0">
          <span className="block mb-1">Month</span>
          <input type="month" value={month} max={thisMonth()} onChange={(e) => e.target.value && setMonth(e.target.value)} className="px-3 py-2 text-sm rounded-xl border border-stone-200 text-stone-800 font-mono focus:outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-200" />
        </label>
      </div>

      {loading && <div className="py-12 text-center text-sm text-stone-500" role="status">Preparing {monthName(month)}…</div>}
      {error && !loading && <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 mt-4" role="alert">{error}</div>}

      {data && !loading && <div className="mt-4">
        <Checklist checks={data.checks} />

        {data.registration === "composition" && <div className="rounded-2xl border border-stone-200 bg-white shadow-card p-5">
          <div className="flex items-start justify-between gap-3 mb-3">
            <div><h2 className="text-base font-bold text-stone-800 font-display">CMP-08 · {data.cmp08.quarter}</h2><p className="text-xs text-stone-600 mt-0.5">Quarterly statement for the composition scheme · usually due {prettyDate(data.cmp08.due)}</p></div>
            <IcFile className="w-5 h-5 text-stone-500" />
          </div>
          <Row label={`Turnover from ${data.cmp08.bills} ${data.cmp08.bills === 1 ? "bill" : "bills"}`} value={formatINR(data.cmp08.turnover)} />
          <Row label={`Composition tax @ ${data.cmp08.rate}%`} value={formatINR(data.cmp08.tax)} />
          <Row label="CGST" value={formatINR(data.cmp08.cgst)} />
          <Row label="SGST" value={formatINR(data.cmp08.sgst)} />
          <Row label="Tax to pay" value={formatINR(data.cmp08.tax)} strong />
          <p className="text-xs text-stone-500 mt-3">Your annual return (GSTR-4) is filed once a year. Confirm your composition rate with your CA.</p>
        </div>}

        {data.registration === "regular" && <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="rounded-2xl border border-stone-200 bg-white shadow-card p-5">
            <h2 className="text-base font-bold text-stone-800 font-display">GSTR-1 · {monthName(month)}</h2>
            <p className="text-xs text-stone-600 mt-0.5 mb-3">Your sales · usually due {prettyDate(data.gstr1.due)} for monthly filers</p>
            <Row label={`Business customers (${data.gstr1.b2b.length} bills)`} value={formatINR(data.gstr1.totals.b2b.taxable)} />
            {data.gstr1.b2cl.length > 0 && <Row label={`Large out-of-state consumer bills (${data.gstr1.b2cl.length})`} value={formatINR(data.gstr1.totals.b2cl.taxable)} />}
            {data.gstr1.cdnr.length > 0 && <Row label={`Credit notes to business buyers (${data.gstr1.cdnr.length})`} value={`− ${formatINR(data.gstr1.totals.cdnr.taxable)}`} />}
            {data.gstr1.cdnur.length > 0 && <Row label={`Credit notes on large consumer bills (${data.gstr1.cdnur.length})`} value={`− ${formatINR(data.gstr1.totals.cdnur.taxable)}`} />}
            <Row label="Consumers (summary by state and rate)" value={formatINR(data.gstr1.totals.b2cs.taxable)} />
            {data.gstr1.totals.nilExempt > 0 && <Row label="Nil-rated or exempt" value={formatINR(data.gstr1.totals.nilExempt)} />}
            <Row label={`Taxable value of ${data.gstr1.bills} ${data.gstr1.bills === 1 ? "bill" : "bills"}`} value={formatINR(data.gstr3b.outward.taxable)} strong />
            <div className="flex flex-wrap gap-2 mt-4">
              {[["b2b", "Business bills"], ...(data.gstr1.b2cl.length ? [["b2cl", "Large consumer bills"]] : []), ...(data.gstr1.cdnr.length ? [["cdnr", "Credit notes (business)"]] : []), ...(data.gstr1.cdnur.length ? [["cdnur", "Credit notes (large consumer)"]] : []), ["b2cs", "Consumer summary"], ["hsn", "HSN summary"]].map(([k, l]) => (
                <a key={k} href={csv(k)} className="inline-flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg border border-stone-200 text-stone-700 font-semibold hover:bg-stone-50"><IcDownload className="w-3.5 h-3.5" /> {l} CSV</a>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-stone-200 bg-white shadow-card p-5">
            <h2 className="text-base font-bold text-stone-800 font-display">GSTR-3B · {monthName(month)}</h2>
            <p className="text-xs text-stone-600 mt-0.5 mb-3">Summary and tax payment · usually due {prettyDate(data.gstr3b.due)} for monthly filers</p>
            <Row label="GST on sales" value={formatINR(data.gstr3b.outward.igst + data.gstr3b.outward.cgst + data.gstr3b.outward.sgst)} />
            <div className="pl-3 text-xs text-stone-600 font-mono">IGST {formatINR(data.gstr3b.outward.igst)} · CGST {formatINR(data.gstr3b.outward.cgst)} · SGST {formatINR(data.gstr3b.outward.sgst)}</div>
            <Row label="Input credit from purchases" value={`− ${formatINR(data.gstr3b.itc.igst + data.gstr3b.itc.cgst + data.gstr3b.itc.sgst)}`} />
            <Row label="Estimated tax to pay" value={formatINR(data.gstr3b.estimatedPayable)} strong />
            <p className="text-xs text-stone-500 mt-3">The sales part of GSTR-3B is filled from your GSTR-1 on the portal and can&apos;t be edited there, so get GSTR-1 right first. The final amount follows the portal&apos;s credit rules and your GSTR-2B.</p>
          </div>
        </div>}

        <p className="text-xs text-stone-500 mt-5">Due dates shown are the usual ones and can differ (quarterly filers, extensions). Filing directly from Munshiji is planned after the pilot.</p>
      </div>}
    </div>
  );
}

