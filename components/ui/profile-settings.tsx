"use client";
import { useEffect, useState } from "react";

const field = "w-full h-10 px-3 rounded-[10px] border border-stone-300 bg-white text-sm text-stone-800 focus:outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-200";
const pretty = (p: string) => (p.length === 12 && p.startsWith("91") ? `+91 ${p.slice(2, 7)} ${p.slice(7)}` : p ? `+${p}` : "");

export function ProfileSettings({ name, email, phone, pending, munshijiNumber, onChanged }: { name: string; email: string; phone: string; pending: string; munshijiNumber: string; onChanged: () => void }) {
  const [n, setN] = useState(name);
  const [num, setNum] = useState(pending ? pretty(pending) : "");
  const [link, setLink] = useState<{ pending: string; message: string; send_to: string } | null>(null);
  const [pw, setPw] = useState({ current: "", next: "" });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // While a code is waiting, check every few seconds whether WhatsApp confirmed it.
  useEffect(() => { if (!link) return; const t = setInterval(onChanged, 4000); const stop = setTimeout(() => clearInterval(t), 120_000); return () => { clearInterval(t); clearTimeout(stop); }; }, [link, onChanged]);
  useEffect(() => { if (phone && link) { setLink(null); setMsg({ ok: true, text: "WhatsApp number linked." }); } }, [phone, link]);

  async function call(url: string, method: string, body?: object) {
    setMsg(null);
    const r = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined }).catch(() => null);
    const d = r ? await r.json().catch(() => ({})) : {};
    if (!r?.ok) { setMsg({ ok: false, text: d.error || "Couldn't save. Try again." }); return null; }
    return d;
  }
  const waUrl = link ? `https://wa.me/${link.send_to.replace(/\D/g, "")}?text=${encodeURIComponent(link.message)}` : "";

  return (
    <div className="rounded-2xl border border-stone-200 bg-white shadow-card p-5">
      <h3 className="text-sm font-bold text-stone-800 mb-1">Your profile</h3>
      <p className="text-xs text-stone-500 mb-4">Signed in as {email}.</p>
      <label className="text-xs font-medium text-stone-700 block max-w-md">Name<input value={n} onChange={(e) => setN(e.target.value)} className={`${field} mt-1.5`} /></label>
      <button onClick={async () => { if (await call("/api/profile", "PATCH", { name: n })) { setMsg({ ok: true, text: "Name saved." }); onChanged(); } }} className="mt-3 h-10 px-4 rounded-xl bg-emerald-600 text-white text-sm font-semibold">Save name</button>

      <div className="mt-6 pt-5 border-t border-stone-100">
        <h4 className="text-sm font-semibold text-stone-800">WhatsApp number</h4>
        <p className="text-xs text-stone-500 mt-0.5 mb-3">Link your number to forward buyers&apos; orders to Munshiji{munshijiNumber ? ` (${munshijiNumber})` : ""}. Only linked numbers are accepted.</p>
        {phone ? (
          <div className="flex flex-wrap items-center gap-3"><span className="text-sm font-semibold text-stone-800">{pretty(phone)}</span><span className="text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2 py-0.5">Linked</span>
            <button onClick={async () => { if (await call("/api/profile/phone", "DELETE")) { setMsg({ ok: true, text: "Number unlinked." }); onChanged(); } }} className="text-[13px] font-semibold text-red-700 hover:underline">Unlink</button></div>
        ) : !link ? (
          <div className="flex flex-col sm:flex-row gap-2 max-w-md">
            <input aria-label="Your WhatsApp number" value={num} onChange={(e) => setNum(e.target.value)} inputMode="tel" placeholder="98765 43210" className={field} />
            <button onClick={async () => { const d = await call("/api/profile/phone", "POST", { phone: num }); if (d) setLink(d); }} disabled={num.replace(/\D/g, "").length < 10} className="h-10 px-4 rounded-xl bg-emerald-600 text-white text-sm font-semibold disabled:opacity-40 shrink-0">Link number</button>
          </div>
        ) : (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 max-w-md">
            <p className="text-sm text-stone-800">From WhatsApp on <b>{pretty(link.pending)}</b>, send this message{link.send_to ? <> to <b>{link.send_to}</b></> : " to the Munshiji number"}:</p>
            <p className="mt-2 text-2xl font-bold tracking-wider text-stone-800 font-mono">{link.message}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {link.send_to && <a href={waUrl} target="_blank" rel="noopener noreferrer" className="h-10 px-4 inline-flex items-center rounded-xl bg-emerald-600 text-white text-sm font-semibold">Open WhatsApp</a>}
              <button onClick={() => setLink(null)} className="h-10 px-4 rounded-xl border border-stone-300 bg-white text-sm font-semibold text-stone-700">Cancel</button>
            </div>
            <p className="mt-2 text-xs text-stone-600">The code works for 30 minutes. This page updates once it&apos;s linked.</p>
          </div>
        )}
      </div>

      <div className="mt-6 pt-5 border-t border-stone-100">
        <h4 className="text-sm font-semibold text-stone-800 mb-3">Password</h4>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-xl">
          <label className="text-xs font-medium text-stone-700">Current password<input type="password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} className={`${field} mt-1.5`} /></label>
          <label className="text-xs font-medium text-stone-700">New password<input type="password" autoComplete="new-password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} placeholder="At least 8 characters" className={`${field} mt-1.5`} /></label>
        </div>
        <button onClick={async () => { if (await call("/api/profile", "POST", pw)) { setPw({ current: "", next: "" }); setMsg({ ok: true, text: "Password changed." }); } }} disabled={!pw.current || pw.next.length < 8} className="mt-3 h-10 px-4 rounded-xl border border-stone-300 text-sm font-semibold text-stone-700 disabled:opacity-40">Change password</button>
      </div>
      {msg && <p role="status" className={`mt-4 text-sm ${msg.ok ? "text-emerald-700" : "text-red-700"}`}>{msg.text}</p>}
    </div>
  );
}
