"use client";
import { useCallback, useEffect, useState } from "react";

interface Status { configured: boolean; from: string; test_sender: boolean; problem: string; recent: { recipient: string; kind: string; status: string; error: string; created_at: string }[] }
const KIND: Record<string, string> = { invite: "Invite", verify_email: "Email confirmation", reset_password: "Password reset", test: "Test" };

/** Owner: whether email (Resend) works, what happened to recent emails, and a test button. */
export function EmailSettings() {
  const [s, setS] = useState<Status | null>(null);
  const [res, setRes] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => { fetch("/api/email").then((r) => (r.ok ? r.json() : null)).then(setS).catch(() => {}); }, []);
  useEffect(() => { load(); }, [load]);
  async function test() {
    setBusy(true); setRes(null);
    const r = await fetch("/api/email", { method: "POST" }).catch(() => null);
    const d = r ? await r.json().catch(() => ({})) : {};
    setBusy(false);
    setRes(d.sent ? { ok: true, text: `Sent to ${d.to}. Check the inbox (and spam).` } : { ok: false, text: d.error || "Couldn't send." });
    load();
  }
  if (!s) return null;
  return (
    <div className="rounded-2xl border border-stone-200 bg-white shadow-card p-5">
      <h3 className="text-sm font-bold text-stone-800 mb-1">Email</h3>
      <p className="text-xs text-stone-500 mb-3">Password resets, email confirmations and team invites are sent through Resend.</p>
      <div className={`rounded-xl px-3 py-2 text-sm ${s.problem ? "bg-amber-50 border border-amber-200 text-amber-900" : "bg-emerald-50 border border-emerald-200 text-emerald-800"}`}>
        {s.problem || <>Set up. Sending from <b>{s.from}</b>.</>}
      </div>
      <button onClick={test} disabled={busy || !s.configured} className="mt-3 h-10 px-4 rounded-xl bg-emerald-600 text-white text-sm font-semibold disabled:opacity-40">{busy ? "Sending…" : "Send a test email to me"}</button>
      {res && <p role="status" className={`mt-2 text-sm ${res.ok ? "text-emerald-700" : "text-red-700"}`}>{res.text}</p>}
      {s.recent.length > 0 && <>
        <div className="text-xs font-medium text-stone-500 mt-4 mb-1">Recent emails</div>
        <ul className="divide-y divide-stone-100 text-sm">{s.recent.map((m, i) => (
          <li key={i} className="py-2 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1">
            <span className="min-w-0 truncate"><b className="text-stone-800">{KIND[m.kind] || m.kind}</b> <span className="text-stone-500">to {m.recipient} · {m.created_at.slice(0, 16).replace("T", " ")}</span></span>
            <span className={`text-xs font-semibold ${m.status === "sent" ? "text-emerald-700" : m.status === "failed" ? "text-red-700" : "text-amber-700"}`}>{m.status === "sent" ? "Sent" : m.status === "failed" ? `Failed: ${m.error}` : `Not sent: ${m.error}`}</span>
          </li>))}</ul>
      </>}
    </div>
  );
}
