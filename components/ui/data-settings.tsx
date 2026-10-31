"use client";
import { useState } from "react";
import { signOut } from "next-auth/react";

const field = "w-full h-10 px-3 rounded-[10px] border border-stone-300 bg-white text-sm text-stone-800 focus:outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-200";
export function DataSettings({ isOwner, businessName }: { isOwner: boolean; businessName: string }) {
  const [del, setDel] = useState(false);
  const [pw, setPw] = useState("");
  const [confirm, setConfirm] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function remove() {
    setBusy(true); setErr(null);
    const r = await fetch("/api/account/delete", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: pw, confirm }) }).catch(() => null);
    const d = r ? await r.json().catch(() => ({})) : {};
    if (r?.ok) { await signOut({ callbackUrl: "/" }); return; }
    setBusy(false); setErr(d.error || "Couldn't delete the account. Try again.");
  }
  return (
    <div className="rounded-2xl border border-stone-200 bg-white shadow-card p-5">
      <h3 className="text-sm font-bold text-stone-800 mb-1">Your data</h3>
      <p className="text-xs text-stone-500 mb-4">Your rights under India&apos;s data protection law. See the <a href="/privacy" className="underline">Privacy Policy</a>.</p>
      <div className="flex flex-wrap gap-2">
        <a href="/api/export/me" className="h-10 px-4 inline-flex items-center rounded-xl border border-stone-300 text-sm font-semibold text-stone-700 hover:bg-stone-50">Download my data</a>
        {isOwner && <a href="/api/export/business" className="h-10 px-4 inline-flex items-center rounded-xl border border-stone-300 text-sm font-semibold text-stone-700 hover:bg-stone-50">Download all data for {businessName}</a>}
      </div>
      <div className="mt-6 pt-5 border-t border-stone-100">
        {!del ? <button onClick={() => setDel(true)} className="text-sm font-semibold text-red-700 hover:underline">Delete my account…</button> : (
          <div className="rounded-xl border border-red-200 bg-red-50 p-4 space-y-2 max-w-md">
            <p className="text-sm text-red-900"><b>This can&apos;t be undone.</b> Your name, email and number are erased and you&apos;re signed out everywhere. Bills and payments you made stay in your businesses, because GST law requires them to be kept. If you&apos;re a business&apos;s only owner, make someone else an owner first.</p>
            <input aria-label="Your password" type="password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="Your password" className={field} />
            <input aria-label="Type DELETE to confirm" value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="Type DELETE to confirm" className={field} />
            {err && <p role="alert" className="text-sm text-red-700">{err}</p>}
            <div className="flex gap-2"><button onClick={remove} disabled={busy || !pw || confirm !== "DELETE"} className="h-10 px-4 rounded-xl bg-red-600 text-white text-sm font-semibold disabled:opacity-40">{busy ? "Deleting…" : "Delete my account"}</button>
              <button onClick={() => setDel(false)} className="h-10 px-4 rounded-xl border border-stone-300 bg-white text-sm font-semibold text-stone-700">Keep my account</button></div>
          </div>
        )}
      </div>
    </div>
  );
}
