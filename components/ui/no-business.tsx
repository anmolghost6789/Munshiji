"use client";
import { useCallback, useEffect, useState } from "react";
import { signOut } from "next-auth/react";
import { AuthCard, authField, authButton } from "./auth-card";

interface Req { contact: string; status: string; created_at: string }
const post = async (url: string, body?: object, method = "POST") => {
  const r = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined }).catch(() => null);
  const d = r ? await r.json().catch(() => ({})) : {};
  return r?.ok ? { ok: true as const, d } : { ok: false as const, error: (d as { error?: string }).error || "Couldn't reach Munshiji. Try again." };
};

/** For someone signed in who isn't part of any business: join a team (code or request), or set up their own. */
export function NoBusiness({ name }: { name: string }) {
  const [code, setCode] = useState("");
  const [contact, setContact] = useState("");
  const [biz, setBiz] = useState("");
  const [reqs, setReqs] = useState<Req[]>([]);
  const [msg, setMsg] = useState<{ ok: boolean; text: string; where: "code" | "ask" | "own" } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [own, setOwn] = useState(false);

  const load = useCallback(async () => { const r = await fetch("/api/join/request").catch(() => null); if (r?.ok) setReqs((await r.json()).requests || []); }, []);
  useEffect(() => { load(); }, [load]);
  // While a request is waiting, check every few seconds whether an owner let them in.
  useEffect(() => {
    if (!reqs.some((r) => r.status === "pending")) return;
    const t = setInterval(async () => { const me = await fetch("/api/me").then((r) => (r.ok ? r.json() : null)).catch(() => null); if (me?.businesses?.length) window.location.reload(); else load(); }, 6000);
    return () => clearInterval(t);
  }, [reqs, load]);

  async function join(e: React.FormEvent) {
    e.preventDefault(); setBusy("code"); setMsg(null);
    const r = await post("/api/join/code", { code });
    if (r.ok) { window.location.reload(); return; }
    setBusy(null); setMsg({ ok: false, text: r.error, where: "code" });
  }
  async function ask(e: React.FormEvent) {
    e.preventDefault(); setBusy("ask"); setMsg(null);
    const r = await post("/api/join/request", { contact });
    setBusy(null);
    if (r.ok) { setContact(""); setMsg({ ok: true, text: (r.d as { message: string }).message, where: "ask" }); load(); }
    else setMsg({ ok: false, text: r.error, where: "ask" });
  }
  async function create(e: React.FormEvent) {
    e.preventDefault(); setBusy("own"); setMsg(null);
    const r = await post("/api/businesses", { name: biz });
    if (r.ok) { window.location.reload(); return; }
    setBusy(null); setMsg({ ok: false, text: r.error, where: "own" });
  }
  const note = (where: "code" | "ask" | "own") => msg && msg.where === where && <p role={msg.ok ? "status" : "alert"} className={`text-sm ${msg.ok ? "text-emerald-700" : "text-red-700"}`}>{msg.text}</p>;
  const STATUS: Record<string, string> = { pending: "Waiting for them to let you in", approved: "Approved", declined: "Declined. Ask them for an invite code." };

  return (
    <AuthCard title={`Namaste${name ? `, ${name.split(" ")[0]}` : ""}`} sub="Join your team, or set up your own business." pose="waving">
      <div className="space-y-4">
        <section className="bg-white rounded-2xl border border-stone-200 shadow-sm p-5 space-y-4">
          <h2 className="text-[16px] font-bold text-stone-800">Join your team</h2>
          <form onSubmit={join} className="space-y-2">
            <label className="block text-xs font-medium text-stone-600">Invite code from your owner<input aria-label="Invite code" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="e.g. KE-7Q4M-X2" autoComplete="off" className={`${authField} mt-1.5 font-mono uppercase tracking-wider placeholder:normal-case placeholder:tracking-normal`} /></label>
            {note("code")}
            <button type="submit" disabled={busy === "code" || code.replace(/[^A-Za-z0-9]/g, "").length < 8} className={authButton}>{busy === "code" ? "Joining…" : "Join with this code"}</button>
          </form>
          <div className="border-t border-stone-100 pt-4">
            <form onSubmit={ask} className="space-y-2">
              <label className="block text-xs font-medium text-stone-600">No code? Ask the owner to let you in<input aria-label="Owner's phone or email" value={contact} onChange={(e) => setContact(e.target.value)} placeholder="Owner's phone number or email" autoComplete="off" className={`${authField} mt-1.5`} /></label>
              {note("ask")}
              <button type="submit" disabled={busy === "ask" || contact.trim().length < 6} className="w-full h-11 rounded-xl border border-emerald-600 text-emerald-700 text-sm font-semibold disabled:opacity-40">{busy === "ask" ? "Asking…" : "Ask to join"}</button>
            </form>
            {reqs.length > 0 && <ul className="mt-3 divide-y divide-stone-100 text-sm">{reqs.map((r) => (
              <li key={r.contact} className="py-2 flex items-center justify-between gap-2">
                <span className="min-w-0"><b className="text-stone-800">{r.contact}</b><span className={`block text-xs ${r.status === "declined" ? "text-red-700" : "text-stone-500"}`}>{STATUS[r.status] || r.status}</span></span>
                {r.status === "pending" && <button onClick={async () => { await post(`/api/join/request?contact=${encodeURIComponent(r.contact)}`, undefined, "DELETE"); load(); }} className="text-xs font-semibold text-stone-500 hover:underline">Cancel</button>}
              </li>))}</ul>}
          </div>
        </section>

        <section className="bg-white rounded-2xl border border-stone-200 shadow-sm p-5">
          {!own ? <button onClick={() => setOwn(true)} className="w-full text-left">
            <span className="block text-[16px] font-bold text-stone-800">Set up my own business</span>
            <span className="block text-sm text-stone-600 mt-0.5">I own or run a business and want to use Munshiji for it.</span>
          </button> : <form onSubmit={create} className="space-y-3">
            <h2 className="text-[16px] font-bold text-stone-800">Set up my own business</h2>
            <label className="block text-xs font-medium text-stone-600">Business name<input aria-label="Your business name" value={biz} onChange={(e) => setBiz(e.target.value)} required minLength={2} placeholder="e.g. Kulkarni Electronics" className={`${authField} mt-1.5`} /></label>
            {note("own")}
            <button type="submit" disabled={busy === "own" || biz.trim().length < 2} className={authButton}>{busy === "own" ? "Creating…" : "Create your business"}</button>
          </form>}
        </section>
      </div>
      <p className="text-center text-sm mt-4"><button onClick={() => signOut({ callbackUrl: "/login" })} className="font-semibold text-emerald-700 hover:underline">Sign out</button></p>
    </AuthCard>
  );
}
