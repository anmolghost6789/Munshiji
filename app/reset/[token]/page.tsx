"use client";
import { useState, use } from "react";
import Link from "next/link";
import { AuthCard, authField, authButton } from "@/components/ui/auth-card";

export default function ResetPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [password, setPassword] = useState("");
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError("");
    const r = await fetch("/api/auth/reset", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, password }) }).catch(() => null);
    setBusy(false);
    if (r?.ok) setDone(true); else setError((await r?.json().catch(() => ({})))?.error || "Couldn't reach Munshiji. Try again.");
  }
  return (
    <AuthCard title={done ? "Password changed" : "Choose a new password"} sub={done ? "You've been signed out on every device. Sign in with your new password." : undefined} pose={done ? "thumbs-up" : "waving"}>
      {!done ? <form onSubmit={submit} className="bg-white rounded-2xl border border-stone-200 shadow-sm p-6 space-y-4">
        <label className="block text-xs font-medium text-stone-600">New password<input type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" placeholder="At least 8 characters" className={`${authField} mt-1.5`} /></label>
        {error && <p role="alert" className="text-sm text-red-700">{error} {/not valid/.test(error) && <Link href="/forgot" className="font-semibold underline">Get a new link</Link>}</p>}
        <button type="submit" disabled={busy} className={authButton}>{busy ? "Saving…" : "Save new password"}</button>
      </form> : <Link href="/login" className={`${authButton} inline-flex items-center justify-center`}>Sign in</Link>}
    </AuthCard>
  );
}
