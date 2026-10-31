/* Munshiji mascot — from the designer's Mascot Kit (public/brand/mascot).
   Light mode uses the transparent art; dark mode swaps to the pale-mint outline version
   automatically (see .mascot-light / .mascot-dark in globals.css). Art is 480px tall,
   so it stays sharp up to ~180px on high-density screens. */

const POSES = {
  "arms-crossed": { w: 396, h: 480, alt: "Munshiji smiling with arms crossed" },
  "chai": { w: 456, h: 480, alt: "Munshiji relaxing with a cup of chai" },
  "concerned": { w: 470, h: 480, alt: "Munshiji looking thoughtful" },
  "folded-hands": { w: 464, h: 480, alt: "Munshiji with folded hands saying thank you" },
  "head": { w: 525, h: 480, alt: "Munshiji" },
  "ledger": { w: 529, h: 480, alt: "Munshiji reading his ledger" },
  "magnifying-glass": { w: 506, h: 480, alt: "Munshiji searching with a magnifying glass" },
  "pointing": { w: 580, h: 480, alt: "Munshiji pointing" },
  "reading-phone": { w: 501, h: 480, alt: "Munshiji reading a message on his phone" },
  "tablet": { w: 476, h: 480, alt: "Munshiji holding a tablet" },
  "thinking": { w: 429, h: 480, alt: "Munshiji thinking" },
  "thumbs-up": { w: 476, h: 480, alt: "Munshiji giving a thumbs up" },
  "waving": { w: 495, h: 480, alt: "Munshiji waving hello" },
} as const;

export type MascotPose = keyof typeof POSES;

export function Mascot({ pose, height = 120, className = "", decorative = false, lightOnly = false }: { pose: MascotPose; height?: number; className?: string; decorative?: boolean; lightOnly?: boolean }) {
  const p = POSES[pose];
  const width = Math.round((p.w / p.h) * height);
  const common = { width, height, alt: decorative ? "" : p.alt, draggable: false, decoding: "async" as const };
  if (lightOnly) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={`/brand/mascot/${pose}.webp`} {...common} aria-hidden={decorative || undefined} className={`select-none ${className}`} />;
  }
  return (
    <span className={`block shrink-0 ${className}`} style={{ width, height }} aria-hidden={decorative || undefined} role={decorative ? undefined : "img"} aria-label={decorative ? undefined : p.alt}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={`/brand/mascot/${pose}.webp`} {...common} alt="" className="mascot-light select-none block" />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={`/brand/mascot/dark/${pose}.webp`} {...common} alt="" loading="lazy" className="mascot-dark select-none" />
    </span>
  );
}

/** Round Munshiji head for places where Munshiji "speaks". Mint in light mode, dark ring in dark mode. */
export function MunshijiAvatar({ size = 32, className = "", lightOnly = false }: { size?: number; className?: string; lightOnly?: boolean }) {
  const file = size > 48 ? 192 : 96;
  return (
    <span className={`inline-block shrink-0 rounded-full ${className}`} style={{ width: size, height: size }} aria-hidden="true">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={`/brand/avatar/munshiji-mint-${file}.webp`} width={size} height={size} alt="" className={`${lightOnly ? "" : "mascot-light "}block rounded-full`} />
      {!lightOnly && /* eslint-disable-next-line @next/next/no-img-element */ <img src={`/brand/avatar/munshiji-dark-${file}.webp`} width={size} height={size} alt="" loading="lazy" className="mascot-dark rounded-full" />}
    </span>
  );
}
