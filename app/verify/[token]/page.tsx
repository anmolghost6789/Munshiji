"use client";
import { useEffect, useState, use } from "react";
import Link from "next/link";
import { AuthCard, authButton } from "@/components/ui/auth-card";

export default function VerifyPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [state, setState] = useState<"working" | "ok" | string>("working");
  useEffect(() => {
    fetch("/api/auth/verify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) })
      .then(async (r) => setState(r.ok ? "ok" : (await r.json().catch(() => ({}))).error || "This link didn't work."))
      .catch(() => setState("Couldn't reach Munshiji. Reload to try again."));
  }, [token]);
  return (
    <AuthCard title={state === "working" ? "Confirming…" : state === "ok" ? "Email confirmed" : "Couldn't confirm"} sub={state === "ok" ? "Thanks. You can always reset your password with this email." : state === "working" ? undefined : state} pose={state === "ok" ? "thumbs-up" : state === "working" ? "reading-phone" : "concerned"}>
      {state !== "working" && <Link href="/dashboard" className={`${authButton} inline-flex items-center justify-center`}>Open Munshiji</Link>}
    </AuthCard>
  );
}
