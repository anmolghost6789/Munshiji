"use client";
/* The sidebar business card: shows the current business and switches between your businesses. */
import { useEffect, useRef, useState } from "react";
import { LogoTile } from "../brand";
import { IcChevronsUpDown, IcCheck, IcPlus } from "../icons";

export interface MeBusiness { id: string; name: string; role: string }
const ROLE: Record<string, string> = { owner: "Owner", manager: "Manager", staff: "Staff" };

export function BusinessSwitcher({ businesses, current, label }: { businesses: MeBusiness[]; current: MeBusiness | null; label: string }) {
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) { setOpen(false); setCreating(false); } };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); setCreating(false); } };
    document.addEventListener("mousedown", close); document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", esc); };
  }, []);

  async function switchTo(id: string) {
    if (id === current?.id) { setOpen(false); return; }
    setBusy(true);
    const r = await fetch("/api/session/business", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ business_id: id }) });
    if (r.ok) window.location.reload(); else { setBusy(false); setErr((await r.json().catch(() => ({}))).error || "Couldn't switch."); }
  }
  async function create() {
    setBusy(true); setErr(null);
    const r = await fetch("/api/businesses", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) });
    if (r.ok) window.location.reload(); else { setBusy(false); setErr((await r.json().catch(() => ({}))).error || "Couldn't create the business."); }
  }

  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen(!open)} aria-haspopup="menu" aria-expanded={open}
        className="w-full flex items-center gap-2.5 p-2 rounded-2xl border border-stone-200 bg-white text-left hover:border-stone-300 focus-visible:outline-2 focus-visible:outline-emerald-600">
        <LogoTile size={36} />
        <span className="min-w-0 flex-1"><span className="block text-sm font-semibold text-stone-800 leading-tight line-clamp-2">{label}</span><span className="block text-xs text-stone-500 mt-0.5">{current ? `${ROLE[current.role] || current.role}${businesses.length > 1 ? ` · ${businesses.length} businesses` : ""}` : "on Munshiji"}</span></span>
        <IcChevronsUpDown className="w-4 h-4 text-stone-400" />
      </button>
      {open && <div role="menu" className="absolute left-0 right-0 top-full mt-1.5 z-50 rounded-2xl border border-stone-200 bg-white shadow-xl p-1.5">
        <div className="px-2.5 pt-1.5 pb-1 text-xs font-medium text-stone-500">Your businesses</div>
        {businesses.map((b) => (
          <button key={b.id} type="button" role="menuitem" onClick={() => switchTo(b.id)} disabled={busy}
            className="w-full flex items-center gap-2 px-2.5 py-2 rounded-xl text-left hover:bg-stone-50 disabled:opacity-50">
            <span className="min-w-0 flex-1"><span className="block text-sm font-medium text-stone-800 truncate">{b.name || "Unnamed business"}</span><span className="block text-xs text-stone-500">{ROLE[b.role] || b.role}</span></span>
            {b.id === current?.id && <IcCheck className="w-4 h-4 text-emerald-600" />}
          </button>
        ))}
        <div className="border-t border-stone-100 my-1" />
        {!creating ? <button type="button" role="menuitem" onClick={() => setCreating(true)} className="w-full flex items-center gap-2 px-2.5 py-2 rounded-xl text-sm font-medium text-emerald-700 hover:bg-emerald-50"><IcPlus className="w-4 h-4" /> Create another business</button>
          : <div className="p-2 space-y-2">
              <input autoFocus aria-label="New business name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Business name" className="w-full h-10 px-3 rounded-[10px] border border-stone-300 text-sm focus:outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-200" />
              <div className="flex gap-2"><button type="button" onClick={create} disabled={busy || name.trim().length < 2} className="flex-1 h-9 rounded-[10px] bg-emerald-600 text-white text-[13px] font-semibold disabled:opacity-40">{busy ? "Creating…" : "Create"}</button><button type="button" onClick={() => setCreating(false)} className="h-9 px-3 rounded-[10px] border border-stone-300 text-[13px] font-semibold text-stone-700">Cancel</button></div>
              <p className="text-xs text-stone-500">You&apos;ll be its owner. Its orders, stock and bills are kept completely separate.</p>
            </div>}
        {err && <p role="alert" className="px-2.5 pb-2 text-xs text-red-700">{err}</p>}
      </div>}
    </div>
  );
}
