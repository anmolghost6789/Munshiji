/* ═══════════════════════════════════════════════════════════════
   GST RULES — the one place tax logic lives.
   Rates, thresholds and codes here change with GST Council decisions;
   keep them reviewed by a CA. Safe to import on client and server.
   ═══════════════════════════════════════════════════════════════ */

export type Registration = "regular" | "composition" | "none";

export const REGISTRATIONS: { key: Registration; label: string; help: string }[] = [
  { key: "regular", label: "Regular GST", help: "You charge GST on your bills and file GSTR-1 and GSTR-3B" },
  { key: "composition", label: "Composition scheme", help: "You don't charge GST; you issue bills of supply and file CMP-08" },
  { key: "none", label: "Not registered", help: "No GST on bills and no GST returns" },
];

/** Rates offered when adding products. Slabs since 22 Sep 2025: 0, 5, 18, 40 (3% remains for gold & jewellery). */
export const GST_RATES = [0, 3, 5, 18, 40] as const;
/** Slabs abolished on 22 Sep 2025. Products still carrying these need review. */
export const RETIRED_RATES = [12, 28];
export const RATE_CHANGE_DATE = "2025-09-22";
export const isRetiredRate = (r: number) => RETIRED_RATES.includes(Number(r));

/** Inter-state B2C invoices above this value are reported invoice-wise (B2CL) in GSTR-1. */
export const B2CL_THRESHOLD = 100000;

/** Composition tax rates (total of CGST + SGST). */
export const COMPOSITION_RATES = [
  { rate: 1, label: "1% — manufacturers and traders" },
  { rate: 5, label: "5% — restaurants" },
  { rate: 6, label: "6% — service providers" },
];

export const GST_STATES: Record<string, string> = {
  "01": "Jammu and Kashmir", "02": "Himachal Pradesh", "03": "Punjab", "04": "Chandigarh", "05": "Uttarakhand",
  "06": "Haryana", "07": "Delhi", "08": "Rajasthan", "09": "Uttar Pradesh", "10": "Bihar", "11": "Sikkim",
  "12": "Arunachal Pradesh", "13": "Nagaland", "14": "Manipur", "15": "Mizoram", "16": "Tripura", "17": "Meghalaya",
  "18": "Assam", "19": "West Bengal", "20": "Jharkhand", "21": "Odisha", "22": "Chhattisgarh", "23": "Madhya Pradesh",
  "24": "Gujarat", "26": "Dadra and Nagar Haveli and Daman and Diu", "27": "Maharashtra", "29": "Karnataka",
  "30": "Goa", "31": "Lakshadweep", "32": "Kerala", "33": "Tamil Nadu", "34": "Puducherry",
  "35": "Andaman and Nicobar Islands", "36": "Telangana", "37": "Andhra Pradesh", "38": "Ladakh", "97": "Other Territory",
};

export const STATE_NAMES = Object.values(GST_STATES).filter((s) => s !== "Other Territory").sort();

export function stateCodeFromName(name?: string | null): string | null {
  if (!name) return null;
  const n = name.trim().toLowerCase();
  const hit = Object.entries(GST_STATES).find(([, v]) => v.toLowerCase() === n);
  return hit ? hit[0] : null;
}

/* ── GSTIN: format + checksum, all offline and free ─────────────── */
const GSTIN_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const GSTIN_PATTERN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z][A-Z][0-9A-Z]$/;

export function gstinCheckChar(first14: string): string {
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const v = GSTIN_CHARS.indexOf(first14[i]);
    const p = v * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(p / 36) + (p % 36);
  }
  return GSTIN_CHARS[(36 - (sum % 36)) % 36];
}

export type GstinCheck =
  | { valid: true; gstin: string; stateCode: string; stateName: string; pan: string }
  | { valid: false; gstin: string; error: string };

export function checkGstin(raw?: string | null): GstinCheck {
  const g = (raw || "").trim().toUpperCase();
  if (g.length !== 15) return { valid: false, gstin: g, error: "A GSTIN has 15 characters" };
  if (!GSTIN_PATTERN.test(g)) return { valid: false, gstin: g, error: "This doesn't look like a GSTIN" };
  const state = GST_STATES[g.slice(0, 2)];
  if (!state) return { valid: false, gstin: g, error: "The first two digits aren't a valid state code" };
  if (gstinCheckChar(g.slice(0, 14)) !== g[14]) return { valid: false, gstin: g, error: "The last character doesn't match — check for a typo" };
  return { valid: true, gstin: g, stateCode: g.slice(0, 2), stateName: state, pan: g.slice(2, 12) };
}

export function stateCodeFromGstin(g?: string | null): string | null {
  const s = (g || "").trim().slice(0, 2);
  return GST_STATES[s] ? s : null;
}

/* ── Tax calculation ──────────────────────────────────────────── */
export const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

export const chargesGst = (reg: Registration) => reg === "regular";

/** Seller's state: from its GSTIN, else from the state name in its profile. */
export function sellerStateCode(biz?: { gstin?: string | null; state?: string | null } | null): string | null {
  return stateCodeFromGstin(biz?.gstin) || stateCodeFromName(biz?.state);
}

/** Place of supply: buyer's GSTIN state if known, else assume the seller's state (local sale). */
/** Place of supply for goods: the registered buyer's state (also covers bill-to-ship-to, s.10(1)(b) IGST Act);
    for buyers without a GSTIN, the state where the goods are delivered (s.10(1)(a)); otherwise the seller's state. */
export function placeOfSupply(sellerCode: string | null, buyerGstin?: string | null, deliveryState?: string | null): string | null {
  const ds = deliveryState && GST_STATES[deliveryState] ? deliveryState : null;
  return stateCodeFromGstin(buyerGstin) || ds || sellerCode;
}

export const isInterState = (sellerCode: string | null, pos: string | null) => !!sellerCode && !!pos && sellerCode !== pos;

export interface TaxLine { qty: number; price: number; total?: number; gst_rate?: number; gst_amount?: number }

/** Recalculate line GST for the registration. Composition / unregistered businesses charge no GST. */
export function applyTax<T extends TaxLine>(items: T[], reg: Registration): T[] {
  return items.map((it) => {
    const total = round2(Number(it.total ?? it.qty * it.price));
    const rate = Number(it.gst_rate ?? 0);
    return { ...it, total, gst_rate: rate, gst_amount: chargesGst(reg) ? round2((total * rate) / 100) : 0 };
  });
}

export function orderTotals(items: TaxLine[]) {
  const subtotal = round2(items.reduce((s, i) => s + Number(i.total ?? i.qty * i.price), 0));
  const gst = round2(items.reduce((s, i) => s + Number(i.gst_amount || 0), 0));
  return { subtotal, gst, grand_total: round2(subtotal + gst) };
}

export function splitTax(gst: number, interState: boolean) {
  return interState ? { igst: round2(gst), cgst: 0, sgst: 0 } : { igst: 0, cgst: round2(gst / 2), sgst: round2(gst - round2(gst / 2)) };
}

export function docTitle(reg: Registration): string {
  return reg === "regular" ? "Tax Invoice" : reg === "composition" ? "Bill of Supply" : "Invoice";
}

export function parseRegistration(v: unknown): Registration {
  return v === "composition" || v === "none" ? v : "regular";
}
