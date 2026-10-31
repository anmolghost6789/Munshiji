"use client";
/* Homepage. One bold moment: the hero shows a WhatsApp order turning into a paid GST bill.
   Everything else stays quiet: the four real steps, the real dashboard, and a ledger page. */
import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { Wordmark, Mascot } from "@/components/brand";

const C = { ledger: "#05362A", leaf: "#65B765", mint: "#E9F6EE", paper: "#FBFCFA", ink: "#18201C", stamp: "#C8412F" };

/* ── Hero demonstration: message → read → bill → paid ── */
function OrderToBill() {
  const [phase, setPhase] = useState(0);
  const play = useCallback(() => {
    const reduce = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) { setPhase(7); return () => {}; } // show the finished bill, stamp included
    setPhase(0);
    const steps = [350, 1300, 2200, 2700, 3200, 3800, 4700];
    const timers = steps.map((t, i) => setTimeout(() => setPhase(i + 1), t));
    return () => timers.forEach(clearTimeout);
  }, []);
  useEffect(() => play(), [play]);
  const hl = (on: boolean) => ({ backgroundColor: on ? "rgba(101,183,101,0.32)" : "transparent", boxShadow: on ? "0 0 0 2px rgba(101,183,101,0.32)" : "none", borderRadius: 4, transition: "background-color .5s, box-shadow .5s" });
  const show = (on: boolean, dy = 12) => ({ opacity: on ? 1 : 0, transform: on ? "none" : `translateY(${dy}px)`, transition: "opacity .45s ease, transform .45s ease" });

  return (
    <div className="relative" role="img" aria-label="A WhatsApp order for 5,000 boxes becomes a GST bill of ₹3,54,000, stamped paid">
      {/* WhatsApp message */}
      <div className="relative z-10 w-[86%] sm:w-[340px] rounded-2xl overflow-hidden shadow-[0_18px_40px_-12px_rgba(0,0,0,0.45)]" style={{ background: "#EFEAE2", ...show(phase >= 1, 16) }}>
        <div className="flex items-center gap-2.5 px-4 py-3 text-white" style={{ background: "#075E54" }}>
          <span className="grid place-items-center w-8 h-8 rounded-full bg-white/20 text-[13px] font-semibold">RS</span>
          <span className="text-[14px] font-semibold leading-tight">Rajesh, Hindustan Foods<span className="block text-[12px] font-normal opacity-80">WhatsApp</span></span>
        </div>
        <div className="p-3">
          <p className="max-w-[92%] rounded-xl rounded-tl-sm bg-white px-3 py-2 text-[15px] leading-relaxed text-[#111B21]">
            Sharma ji, <span style={hl(phase >= 2)}>5000 medium 5-ply box</span> chahiye, logo print ke saath. <span style={hl(phase >= 2)}>Partition</span> bhi. <span style={hl(phase >= 2)}>28th tak</span> Bhosari.
            <span className="block text-right text-[11px] text-[#667781] mt-0.5">9:14 AM</span>
          </p>
        </div>
      </div>

      {/* Munshiji reading */}
      <img src="/brand/mascot/dark/reading-phone.webp" alt="" width={120} height={115} className="hidden sm:block absolute z-20 left-[6px] top-[214px] w-[92px] h-auto drop-shadow-xl" style={show(phase >= 2, 8)} />

      {/* GST bill */}
      <div className="relative z-10 ml-auto -mt-4 sm:-mt-10 w-[94%] sm:w-[400px] rounded-[6px] bg-white text-[#18201C] shadow-[0_24px_50px_-14px_rgba(0,0,0,0.5)]" style={show(phase >= 3, 20)}>
        <div className="px-5 pt-4 pb-3 border-b-2" style={{ borderColor: C.ink }}>
          <div className="flex justify-between items-baseline"><span className="text-[15px] font-bold">Sharma Corrugated Industries</span><span className="text-[12px] font-semibold text-[#4B5550]">Tax invoice</span></div>
          <div className="flex justify-between text-[12px] text-[#4B5550] mt-1"><span>Bill INV/26-27/0042</span><span>To: Hindustan Foods Pvt Ltd</span></div>
        </div>
        <table className="w-full text-[13px]">
          <tbody>
            {[["5-Ply Box Medium", "5,000 × ₹52", "₹2,60,000", 4], ["Partition insert", "5,000 × ₹8", "₹40,000", 5]].map(([n, q, t, p]) => (
              <tr key={n as string} className="border-b border-[#E6E8E6]" style={show(phase >= (p as number), 6)}>
                <td className="px-5 py-2"><span className="font-semibold">{n}</span><span className="block text-[12px] text-[#6B746F]">HSN 4819 · {q}</span></td>
                <td className="px-5 py-2 text-right font-semibold tabular-nums">{t}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="px-5 py-3 text-[13px]" style={show(phase >= 6, 6)}>
          <div className="flex justify-between text-[#4B5550]"><span>CGST 9% + SGST 9%</span><span className="tabular-nums">₹54,000</span></div>
          <div className="flex justify-between text-[17px] font-bold mt-1"><span>Total</span><span className="tabular-nums">₹3,54,000</span></div>
        </div>
        {/* The stamp */}
        <div aria-hidden className="absolute left-[32%] -bottom-9 sm:left-auto sm:right-[34%] sm:bottom-[10px] select-none rounded-md border-[3px] px-3 py-1 text-center font-bold leading-none bg-white/0"
          style={{ color: C.stamp, borderColor: C.stamp, opacity: phase >= 7 ? 0.92 : 0, transform: phase >= 7 ? "rotate(-9deg) scale(1)" : "rotate(-9deg) scale(1.7)", transition: "opacity .25s ease, transform .3s cubic-bezier(.2,1.6,.4,1)" }}>
          <span className="block text-[22px]" lang="hi">चुकता</span><span className="block text-[11px] tracking-wide">Paid in full</span>
        </div>
      </div>

      <button type="button" onClick={() => play()} className="mt-10 sm:mt-4 ml-auto block text-[13px] font-medium text-[#CFE9D8] underline underline-offset-4 decoration-white/30 hover:decoration-white focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#65B765] rounded">
        Play again
      </button>
    </div>
  );
}

const STEPS = [
  { pose: "reading-phone", title: "Forward the order", body: "Buyer ka WhatsApp message Munshiji ko forward kijiye, ya app mein paste kijiye. Hindi, Hinglish ya English." },
  { pose: "thumbs-up", title: "Check and confirm", body: "Munshiji buyer, items aur rate bhar deta hai. Aap dekhte hain, ek tap mein confirm." },
  { pose: "ledger", title: "Send a correct bill", body: "CGST + SGST ya IGST, HSN code, aur bill number jo aapke GST return se match kare." },
  { pose: "folded-hands", title: "Get paid", body: "Kaun kitna dega, sab dikhe. Ek tap mein reminder, har bill pe UPI QR, part payment bhi." },
] as const;

const LEDGER = [
  ["Bill numbers", "Har bill ka agla number. Na gap, na repeat. Ek order, ek bill."],
  ["Stock", "Maal aaya to stock badha, dispatch hua to ghata. Ek hi baar, hamesha."],
  ["Payments", "Part payment bhi record hota hai. Order tabhi Paid, jab poora paisa aaye."],
  ["Team", "Owner, manager, staff: har kisi ko sirf wahi dikhe jo unke kaam ka hai."],
  ["Control", "Aapke bina na order confirm hota, na bill jaata, na GST file hota."],
] as const;

export default function Home() {
  return (
    <main className="min-h-screen" style={{ background: C.paper, color: C.ink }}>
      {/* ═══ Hero ═══ */}
      <section className="relative overflow-hidden" style={{ background: C.ledger }}>
        <div aria-hidden className="pointer-events-none absolute -right-40 -top-40 w-[720px] h-[720px] rounded-full" style={{ background: "radial-gradient(closest-side, rgba(101,183,101,0.16), transparent)" }} />
        <nav className="relative max-w-6xl mx-auto px-5 sm:px-8 pt-6 flex items-center justify-between">
          <Wordmark height={30} tone="reverse" />
          <div className="flex items-center gap-5 text-[15px]">
            <a href="#how" className="hidden sm:inline text-[#CFE9D8] hover:text-white">How it works</a>
            <Link href="/login" className="h-10 px-4 inline-flex items-center rounded-full border border-white/30 text-white font-medium hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#65B765]">Sign in</Link>
          </div>
        </nav>
        <div className="relative max-w-6xl mx-auto px-5 sm:px-8 pt-14 sm:pt-20 pb-20 sm:pb-28 grid lg:grid-cols-12 gap-12 lg:gap-8 items-center">
          <div className="lg:col-span-6">
            <p className="text-[16px] text-[#A9D9B7] mb-5">For businesses that take orders on WhatsApp</p>
            <h1 className="text-[44px] sm:text-[64px] lg:text-[72px] font-semibold leading-[1.02] tracking-[-0.025em] text-white">
              WhatsApp pe order aaya. Munshiji ne sab sambhal liya.
            </h1>
            <p className="mt-6 max-w-[34rem] text-[18px] leading-[1.6] text-[#CFE9D8]">
              Order se GST bill tak, stock se payment tak. Aap order forward kijiye; Munshiji bill banata hai, stock sambhalta hai aur yaad dilata hai kaun kitna dega.
            </p>
            <div className="mt-9 flex flex-wrap items-center gap-4">
              <Link href="/login" className="h-12 px-6 inline-flex items-center rounded-full text-[16px] font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white" style={{ background: C.leaf, color: C.ledger }}>Start with Munshiji</Link>
              <a href="#how" className="text-[16px] font-medium text-white underline underline-offset-[6px] decoration-white/40 hover:decoration-white">See the four steps</a>
            </div>
          </div>
          <div className="lg:col-span-6 lg:pl-6">
            <OrderToBill />
          </div>
        </div>
      </section>

      {/* ═══ Four steps (a real sequence, so numbered) ═══ */}
      <section id="how" className="max-w-6xl mx-auto px-5 sm:px-8 py-20 sm:py-28">
        <h2 className="text-[32px] sm:text-[40px] font-semibold tracking-[-0.02em] leading-tight max-w-[22ch]">Ek order, chaar kadam. Aapka kaam sirf do.</h2>
        <p className="mt-4 max-w-[38rem] text-[18px] leading-[1.6] text-[#4B5550]">Forward kijiye aur confirm kijiye. Bill, stock aur reminder Munshiji ka kaam hai.</p>
        <ol className="mt-14 grid sm:grid-cols-2 lg:grid-cols-4 gap-x-8 gap-y-14">
          {STEPS.map((s, i) => (
            <li key={s.title} className="relative">
              <div className="flex items-end gap-3 h-[120px]">
                <span className="text-[72px] leading-[0.8] font-light tabular-nums" style={{ color: C.leaf }} aria-hidden>{i + 1}</span>
                <Mascot pose={s.pose} height={112} decorative lightOnly />
              </div>
              <h3 className="mt-5 text-[20px] font-semibold"><span className="sr-only">Step {i + 1}: </span>{s.title}</h3>
              <p className="mt-2 text-[16px] leading-[1.6] text-[#4B5550]">{s.body}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* ═══ The real dashboard ═══ */}
      <section style={{ background: C.mint }}>
        <div className="max-w-6xl mx-auto px-5 sm:px-8 py-20 sm:py-28 grid lg:grid-cols-12 gap-12 items-center">
          <div className="lg:col-span-4">
            <h2 className="text-[32px] sm:text-[40px] font-semibold tracking-[-0.02em] leading-tight">Poora business, ek screen pe.</h2>
            <p className="mt-4 text-[18px] leading-[1.6] text-[#4B5550]">Naye order, aaj ki sales, kis buyer se kitna paisa aana hai, aur kaun sa bill late hai. Laptop pe bhi, phone pe bhi.</p>
          </div>
          <div className="lg:col-span-8 relative pb-10 sm:pb-0">
            <div className="rounded-xl overflow-hidden border border-[#CFE9D8] bg-white shadow-[0_30px_60px_-20px_rgba(5,54,42,0.35)]">
              <div className="flex gap-1.5 px-3 py-2.5 border-b border-[#E6E8E6] bg-[#F3F4F3]" aria-hidden><span className="w-2.5 h-2.5 rounded-full bg-[#D0D4D1]" /><span className="w-2.5 h-2.5 rounded-full bg-[#D0D4D1]" /><span className="w-2.5 h-2.5 rounded-full bg-[#D0D4D1]" /></div>
              <img src="/landing/dashboard.webp" width={1800} height={1125} alt="The Munshiji overview: an order ready to confirm, this month's sales, money to collect and recent orders" className="block w-full h-auto" loading="lazy" />
            </div>
            <div className="absolute -bottom-2 right-2 sm:-right-4 sm:-bottom-10 w-[30%] max-w-[190px] rounded-[26px] border-[6px] border-[#18201C] overflow-hidden bg-[#18201C] shadow-[0_24px_50px_-16px_rgba(0,0,0,0.5)]">
              <img src="/landing/phone.webp" width={585} height={1266} alt="Munshiji on a phone" className="block w-full h-auto" loading="lazy" />
            </div>
          </div>
        </div>
      </section>

      {/* ═══ Ledger page ═══ */}
      <section className="max-w-6xl mx-auto px-5 sm:px-8 py-20 sm:py-28 grid lg:grid-cols-12 gap-12 items-start">
        <div className="lg:col-span-4">
          <h2 className="text-[32px] sm:text-[40px] font-semibold tracking-[-0.02em] leading-tight">Hisab hamesha sahi.</h2>
          <p className="mt-4 text-[18px] leading-[1.6] text-[#4B5550]">Jo cheez paise ya maal ko chhooti hai, Munshiji use do baar nahi hone deta. Galti se do baar tap ho jaye, tab bhi.</p>
          <Mascot pose="magnifying-glass" height={150} className="mt-10 hidden lg:block" decorative lightOnly />
        </div>
        <div className="lg:col-span-8">
          <div className="relative rounded-[4px] bg-white border border-[#E6E8E6] shadow-[0_2px_0_#E6E8E6]">
            <div aria-hidden className="absolute top-0 bottom-0 left-[132px] sm:left-[168px] w-px" style={{ background: C.stamp, opacity: 0.55 }} />
            <div aria-hidden className="absolute top-0 bottom-0 left-[136px] sm:left-[172px] w-px" style={{ background: C.stamp, opacity: 0.55 }} />
            <dl>
              {LEDGER.map(([k, v], i) => (
                <div key={k} className={`grid grid-cols-[132px_1fr] sm:grid-cols-[168px_1fr] ${i ? "border-t border-[#D9E7F2]" : ""}`}>
                  <dt className="px-5 py-5 text-[16px] font-semibold">{k}</dt>
                  <dd className="pl-6 pr-5 py-5 text-[16px] leading-[1.6] text-[#33403A]">{v}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      </section>

      {/* ═══ Closing call to action ═══ */}
      <section style={{ background: C.ledger }}>
        <div className="max-w-6xl mx-auto px-5 sm:px-8 py-16 sm:py-20 flex flex-col sm:flex-row items-center gap-8 sm:gap-12">
          <img src="/brand/mascot/dark/arms-crossed.webp" alt="" width={132} height={160} className="w-[120px] sm:w-[140px] h-auto" />
          <div className="flex-1 text-center sm:text-left">
            <h2 className="text-[30px] sm:text-[40px] font-semibold tracking-[-0.02em] leading-tight text-white">Pehla order aaj hi Munshiji mein daaliye.</h2>
            <p className="mt-3 text-[18px] text-[#CFE9D8]">Setup do minute ka hai. Aapka GSTIN daaliye, baaki Munshiji samjha dega.</p>
          </div>
          <Link href="/login" className="h-12 px-6 inline-flex items-center rounded-full text-[16px] font-semibold shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white" style={{ background: C.leaf, color: C.ledger }}>Start with Munshiji</Link>
        </div>
      </section>

      <footer className="max-w-6xl mx-auto px-5 sm:px-8 py-10 flex flex-col sm:flex-row items-center justify-between gap-4 text-[14px] text-[#6B746F]">
        <Wordmark height={26} tagline />
        <p>GST bills and returns prepared from your own data. Filing stays with you or your CA.</p>
        <span className="flex gap-4"><Link href="/support" className="hover:underline">Help</Link><Link href="/terms" className="hover:underline">Terms</Link><Link href="/privacy" className="hover:underline">Privacy</Link><Link href="/login" className="font-medium text-[#18201C] hover:underline">Sign in</Link></span>
      </footer>
    </main>
  );
}
