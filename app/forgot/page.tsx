"use client";
import { useState } from "react";
import Link from "next/link";
import { AuthCard, authField, authButton } from "@/components/ui/auth-card";

export default function ForgotPage() {
  const [email, setEmail] = useState("");
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError("");
    const r = await fetch("/api/auth/forgot", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email }) }).catch(() => null);
    setBusy(false);
    if (r?.ok) setDone(true); else setError((await r?.json().catch(() => ({})))?.error || "Couldn't reach Munshiji. Try again.");
  }
  return (
    <AuthCard title={done ? "Check your email" : "Forgot your password?"} sub={done ? `If ${email} has a Munshiji account, a reset link is on its way. It works once, for 1 hour.` : "We'll email you a link to choose a new one."} pose={done ? "thumbs-up" : "thinking"}>
      {!done ? <form onSubmit={submit} className="bg-white rounded-2xl border border-stone-200 shadow-sm p-6 space-y-4">
        <label className="block text-xs font-medium text-stone-600">Email<input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" className={`${authField} mt-1.5`} /></label>
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
        <button type="submit" disabled={busy} className={authButton}>{busy ? "Sending…" : "Email me a reset link"}</button>
      </form> : <p className="text-center text-sm text-stone-500">Didn&apos;t get it? Check spam, or <button onClick={() => setDone(false)} className="font-semibold text-emerald-700 hover:underline">try again</button>.</p>}
      <p className="text-center text-sm text-stone-500 mt-4"><Link href="/login" className="font-semibold text-emerald-700 hover:underline">Back to sign in</Link></p>
    </AuthCard>
  );
}
