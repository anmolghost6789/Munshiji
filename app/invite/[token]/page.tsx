"use client";
import { useEffect, useState, use } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Mascot, Wordmark } from "@/components/brand";

interface Info { business_name: string; role: string; email: string; has_account: boolean }
const ROLE: Record<string, string> = { owner: "an owner", manager: "a manager", staff: "staff" };
const field = "w-full px-4 py-3 text-sm rounded-xl border border-stone-200 text-stone-800 placeholder-stone-400 focus:outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-200";

export default function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const router = useRouter();
  const [info, setInfo] = useState<Info | null>(null);
  const [problem, setProblem] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [agree, setAgree] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch(`/api/invites/${encodeURIComponent(token)}`).then(async (r) => {
      const d = await r.json().catch(() => ({}));
      if (r.ok) setInfo(d); else setProblem(d.error || "This invite link is not valid any more.");
    }).catch(() => setProblem("Couldn't reach Munshiji. Check your connection and reload."));
  }, [token]);

  async function join(e: React.FormEvent) {
    e.preventDefault();
    if (!info) return;
    setBusy(true); setError("");
    const res = await signIn("credentials", { action: "accept_invite", token, email: info.email, password, name, accept_terms: agree ? "true" : "false", redirect: false });
    if (res?.error) { setBusy(false); setError(res.error === "CredentialsSignin" ? "Couldn't join. Check your password." : res.error); return; }
    const me = await (await fetch("/api/me")).json().catch(() => null);
    const target = me?.businesses?.find((b: { name: string }) => b.name === info.business_name) || me?.businesses?.[me.businesses.length - 1];
    if (target) await fetch("/api/session/business", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ business_id: target.id }) });
    router.replace("/dashboard");
  }

  return (
    <main className="min-h-screen bg-stone-50 flex flex-col items-center sm:justify-center px-4 py-6 sm:py-10">
      <div className="w-full max-w-sm">
        <div className="text-center mb-6 sm:mb-8">
          <Link href="/" aria-label="Munshiji home" className="inline-block mb-6"><Wordmark height={24} /></Link>
          <Mascot pose={problem ? "concerned" : "waving"} height={72} className="mx-auto mb-2 sm:hidden" decorative lightOnly />
          <Mascot pose={problem ? "concerned" : "waving"} height={120} className="mx-auto mb-3 hidden sm:block" decorative lightOnly />
          {info && <h1 className="text-2xl font-bold text-stone-800">Join {info.business_name}</h1>}
          {info && <p className="text-sm text-stone-600 mt-1">You&apos;ve been invited as {ROLE[info.role] || info.role}.</p>}
          {problem && <h1 className="text-xl font-bold text-stone-800">{problem}</h1>}
        </div>
        {problem && <p className="text-center text-sm text-stone-600">Ask the person who invited you to send a new link. <Link href="/login" className="font-semibold text-emerald-700 hover:underline">Sign in</Link></p>}
        {info && <form onSubmit={join} className="bg-white rounded-2xl border border-stone-200 shadow-sm p-6 space-y-4">
          <label className="block text-xs font-medium text-stone-600">Email<input value={info.email} readOnly className={`${field} mt-1.5 bg-stone-50 text-stone-500`} /></label>
          {!info.has_account && <label className="block text-xs font-medium text-stone-600">Your name<input value={name} onChange={(e) => setName(e.target.value)} required autoComplete="name" className={`${field} mt-1.5`} /></label>}
          <label className="block text-xs font-medium text-stone-600">{info.has_account ? "Your Munshiji password" : "Choose a password"}
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={info.has_account ? undefined : 8} autoComplete={info.has_account ? "current-password" : "new-password"} placeholder={info.has_account ? "" : "At least 8 characters"} className={`${field} mt-1.5`} /></label>
          {!info.has_account && <label className="flex items-start gap-2 text-sm text-stone-600"><input type="checkbox" required checked={agree} onChange={(e) => setAgree(e.target.checked)} className="mt-1" /><span>I agree to the <Link href="/terms" target="_blank" className="font-semibold text-emerald-700 underline">Terms of Service</Link> and <Link href="/privacy" target="_blank" className="font-semibold text-emerald-700 underline">Privacy Policy</Link>.</span></label>}
          {info.has_account && <p className="text-xs text-stone-500">You already use Munshiji with this email. Sign in to add {info.business_name} to your businesses.</p>}
          {error && <p role="alert" className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-3 py-2">{error}</p>}
          <button type="submit" disabled={busy} className="w-full h-12 rounded-xl bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 disabled:opacity-50">{busy ? "Joining…" : `Join ${info.business_name}`}</button>
        </form>}
      </div>
    </main>
  );
}
