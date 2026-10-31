import Link from "next/link";
import { Wordmark } from "./brand";
import { legal } from "@/lib/legal";

export function LegalLayout({ title, children }: { title: string; children: React.ReactNode }) {
  const l = legal();
  return (
    <main className="min-h-screen bg-stone-50">
      <div className="max-w-3xl mx-auto px-5 py-8 sm:py-12">
        <nav className="flex items-center justify-between mb-8"><Link href="/" aria-label="Munshiji home"><Wordmark height={24} /></Link>
          <span className="flex gap-4 text-sm"><Link href="/terms" className="text-stone-600 hover:underline">Terms</Link><Link href="/privacy" className="text-stone-600 hover:underline">Privacy</Link><Link href="/support" className="text-stone-600 hover:underline">Support</Link></span></nav>
        {!l.reviewed && <p role="note" className="mb-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">Draft for legal review. This page has not yet been approved by a lawyer and may change.</p>}
        <h1 className="text-3xl font-bold tracking-tight text-stone-800">{title}</h1>
        <p className="mt-2 text-sm text-stone-500">Last updated {l.updated}</p>
        <div className="mt-8 space-y-6 text-[16px] leading-[1.7] text-stone-700 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-stone-800 [&_h2]:mt-8 [&_h2]:mb-2 [&_ul]:list-disc [&_ul]:pl-6 [&_li]:mt-1 [&_a]:text-emerald-700 [&_a]:underline">{children}</div>
      </div>
    </main>
  );
}
