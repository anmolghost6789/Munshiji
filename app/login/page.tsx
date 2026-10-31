"use client";
import { useState, useEffect, Suspense } from "react";
import { signIn, useSession } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Mascot, Wordmark } from "@/components/brand";

const field = "w-full px-4 py-3 text-sm rounded-xl border border-stone-200 text-stone-800 placeholder-stone-400 focus:outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-200";

function AuthForm() {
  const params = useSearchParams();
  const [mode, setMode] = useState<"login" | "register">(params.get("signup") ? "register" : "login");
  const [name, setName] = useState("");
  const [business, setBusiness] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [agree, setAgree] = useState(false);
  const [path, setPath] = useState<"own" | "join" | null>(params.get("join") ? "join" : null); // what a new person wants to do
  const [code, setCode] = useState(params.get("code") || "");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const { status } = useSession();

  useEffect(() => { if (status === "authenticated") router.replace("/dashboard"); }, [status, router]);
  useEffect(() => { if (params.get("error") === "CredentialsSignin") setError("Email or password is incorrect."); }, [params]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(""); setLoading(true);
    const joiningWithCode = mode === "register" && path === "join" && code.trim().length > 0;
    const res = await signIn("credentials", {
      email, password, redirect: false,
      ...(mode === "register" ? (joiningWithCode
        ? { name, action: "accept_invite", token: code.trim(), accept_terms: agree ? "true" : "false" }
        : { name, business_name: path === "own" ? business : "", intent: path === "join" ? "join" : "own", action: "register", accept_terms: agree ? "true" : "false" }) : {}),
    });
    setLoading(false);
    if (res?.error) setError(res.error === "CredentialsSignin" ? "Email or password is incorrect." : res.error);
    else router.replace("/dashboard");
  }

  return (
    <form onSubmit={handleSubmit} className="bg-white rounded-2xl border border-stone-200 shadow-sm p-6 space-y-4">
      <div className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-stone-100" role="tablist" aria-label="Sign in or create an account">
        {(["login", "register"] as const).map((m) => (
          <button key={m} type="button" role="tab" aria-selected={mode === m} onClick={() => { setMode(m); setError(""); if (m === "login") setPath(null); }}
            className={`h-10 rounded-lg text-sm font-semibold ${mode === m ? "bg-white text-stone-800 shadow-sm" : "text-stone-500"}`}>
            {m === "login" ? "Sign in" : "New to Munshiji"}
          </button>
        ))}
      </div>
      {mode === "register" && !path && <div className="space-y-3">
        <p className="text-sm font-semibold text-stone-800">What would you like to do?</p>
        <button type="button" onClick={() => setPath("own")} className="w-full text-left rounded-2xl border border-stone-200 p-4 hover:border-emerald-600 hover:bg-emerald-50/40">
          <span className="block text-[15px] font-semibold text-stone-800">Set up my business</span>
          <span className="block text-sm text-stone-600 mt-0.5">I own or run the business. I&apos;ll invite my team.</span>
        </button>
        <button type="button" onClick={() => setPath("join")} className="w-full text-left rounded-2xl border border-stone-200 p-4 hover:border-emerald-600 hover:bg-emerald-50/40">
          <span className="block text-[15px] font-semibold text-stone-800">Join my team</span>
          <span className="block text-sm text-stone-600 mt-0.5">I work with a business that already uses Munshiji.</span>
        </button>
      </div>}
      {mode === "register" && path && <p className="text-sm text-stone-600">{path === "own" ? "Creates your account and your business. You can invite your team afterwards." : "Creates your account. Enter the invite code from your owner, or ask them to let you in next."} <button type="button" onClick={() => setPath(null)} className="font-semibold text-emerald-700 hover:underline">Change</button></p>}
      {mode === "register" && path && <>
        <label className="block text-xs font-medium text-stone-600">Your name<input value={name} onChange={(e) => setName(e.target.value)} required autoComplete="name" placeholder="e.g. Ramesh Sharma" className={`${field} mt-1.5`} /></label>
        {path === "own" && <label className="block text-xs font-medium text-stone-600">Business name<input value={business} onChange={(e) => setBusiness(e.target.value)} required autoComplete="organization" placeholder="e.g. Shree Ganesh Corrugators" className={`${field} mt-1.5`} /></label>}
        {path === "join" && <label className="block text-xs font-medium text-stone-600">Invite code (if you have one)<input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} autoComplete="off" placeholder="e.g. KE-7Q4M-X2" className={`${field} mt-1.5 font-mono uppercase tracking-wider placeholder:normal-case placeholder:tracking-normal`} /></label>}
      </>}
      {(mode === "login" || path) && <>
      <label className="block text-xs font-medium text-stone-600">Email<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" placeholder="you@business.com" className={`${field} mt-1.5`} /></label>
      <label className="block text-xs font-medium text-stone-600">Password<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={mode === "register" ? 8 : undefined} autoComplete={mode === "register" ? "new-password" : "current-password"} placeholder={mode === "register" ? "At least 8 characters" : "Your password"} className={`${field} mt-1.5`} /></label>
      {mode === "register" && <label className="flex items-start gap-2 text-sm text-stone-600"><input type="checkbox" required checked={agree} onChange={(e) => setAgree(e.target.checked)} className="mt-1" /><span>I agree to the <Link href="/terms" className="font-semibold text-emerald-700 underline" target="_blank">Terms of Service</Link> and <Link href="/privacy" className="font-semibold text-emerald-700 underline" target="_blank">Privacy Policy</Link>.</span></label>}
      {error && <p role="alert" className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-3 py-2">{error}</p>}
      </>}
      {(mode === "login" || path) && <button type="submit" disabled={loading || (mode === "register" && !agree)} className="w-full h-12 rounded-xl bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 disabled:opacity-50">
        {loading ? (mode === "register" ? (path === "own" ? "Creating your business…" : "Creating your account…") : "Signing in…") : (mode === "register" ? (path === "own" ? "Create account" : code.trim() ? "Join the team" : "Create account") : "Sign in")}
      </button>}
      {mode === "login" && <p className="text-center text-sm"><Link href="/forgot" className="font-semibold text-emerald-700 hover:underline">Forgot password?</Link></p>}
      {mode === "login" && <p className="text-center text-xs text-stone-500">Joining a team? Open the invite link you were sent.</p>}
    </form>
  );
}

export default function LoginPage() {
  return (
    <main className="min-h-screen bg-stone-50 flex flex-col items-center sm:justify-center px-4 py-6 sm:py-10">
      <div className="w-full max-w-sm">
        <div className="text-center mb-5 sm:mb-8">
          <Link href="/" aria-label="Munshiji home" className="inline-block mb-4 sm:mb-6"><Wordmark height={24} /></Link>
          <Mascot pose="waving" height={72} className="mx-auto mb-2 sm:hidden" decorative lightOnly />
          <Mascot pose="waving" height={132} className="mx-auto mb-3 hidden sm:block" decorative lightOnly />
          <h1 className="text-2xl font-bold text-stone-800">Namaste!</h1>
          <p className="text-sm text-stone-500 mt-1">Business ka hisab, aasaan.</p>
        </div>
        <Suspense><AuthForm /></Suspense>
      </div>
    </main>
  );
}
