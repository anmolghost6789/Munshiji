import Link from "next/link";
import { Mascot, Wordmark, type MascotPose } from "../brand";
/** The shared look of sign-in, invite, reset and confirmation pages. */
export function AuthCard({ title, sub, pose = "waving", children }: { title: string; sub?: string; pose?: MascotPose; children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-stone-50 flex flex-col items-center sm:justify-center px-4 py-6 sm:py-10">
      <div className="w-full max-w-sm">
        <div className="text-center mb-6 sm:mb-8">
          <Link href="/" aria-label="Munshiji home" className="inline-block mb-4 sm:mb-6"><Wordmark height={24} /></Link>
          <Mascot pose={pose} height={72} className="mx-auto mb-2 sm:hidden" decorative lightOnly />
          <Mascot pose={pose} height={120} className="mx-auto mb-3 hidden sm:block" decorative lightOnly />
          <h1 className="text-2xl font-bold text-stone-800">{title}</h1>
          {sub && <p className="text-sm text-stone-600 mt-1">{sub}</p>}
        </div>
        {children}
      </div>
    </main>
  );
}
export const authField = "w-full px-4 py-3 text-sm rounded-xl border border-stone-200 text-stone-800 placeholder-stone-400 focus:outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-200";
export const authButton = "w-full h-12 rounded-xl bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 disabled:opacity-50";
