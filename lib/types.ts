export const ORDER_STATES = [
  { key: "new", label: "New", labelHi: "नया", color: "grey" },
  { key: "confirmed", label: "Confirmed", labelHi: "पक्का", color: "blue" },
  { key: "preparing", label: "In Production", labelHi: "उत्पादन", color: "amber" },
  { key: "dispatched", label: "Dispatched", labelHi: "भेजा", color: "violet" },
  { key: "delivered", label: "Delivered", labelHi: "पहुँचा", color: "teal" },
  { key: "invoiced", label: "Invoiced", labelHi: "बिल", color: "sky" },
  { key: "paid", label: "Paid", labelHi: "भुगतान", color: "green" },
  { key: "credited", label: "Credited", labelHi: "क्रेडिट", color: "grey" },
  // Not a step in the flow: an invoiced order becomes "overdue" automatically
  // once its invoice is older than the business's overdue threshold.
  { key: "overdue", label: "Overdue", labelHi: "बकाया", color: "red" },
] as const;

export type OrderStateKey = (typeof ORDER_STATES)[number]["key"];

/** The steps a user moves an order through, in order. */
/** The steps an order moves through. "overdue" is computed from age, and "credited" only ever comes from credit notes. */
export const ORDER_FLOW = ORDER_STATES.filter((s) => s.key !== "overdue" && s.key !== "credited");

/** States where money is still owed by the buyer. "overdue" is legacy data from when it was set by hand. */
export const RECEIVABLE_STATES = ["invoiced", "overdue"] as const;

export function getNextState(current: string): string | null {
  if (current === "overdue") return "paid";
  const idx = ORDER_FLOW.findIndex((s) => s.key === current);
  if (idx < 0 || idx >= ORDER_FLOW.length - 1) return null;
  return ORDER_FLOW[idx + 1].key;
}

export function getStateInfo(key: string) {
  return ORDER_STATES.find((s) => s.key === key) || ORDER_STATES[0];
}

/* ── Configurable status labels & colours ────────────────────────
   Class strings are written out in full so Tailwind can find them. */
export const STATUS_COLORS = {
  grey:   { name: "Grey",   badge: "bg-stone-100 text-stone-700 border-stone-300",    dot: "bg-stone-500" },
  blue:   { name: "Blue",   badge: "bg-blue-50 text-blue-700 border-blue-200",        dot: "bg-blue-500" },
  sky:    { name: "Sky",    badge: "bg-sky-50 text-sky-800 border-sky-200",           dot: "bg-sky-500" },
  amber:  { name: "Amber",  badge: "bg-amber-50 text-amber-800 border-amber-200",     dot: "bg-amber-500" },
  orange: { name: "Orange", badge: "bg-orange-50 text-orange-800 border-orange-200",  dot: "bg-orange-500" },
  violet: { name: "Violet", badge: "bg-violet-50 text-violet-700 border-violet-200",  dot: "bg-violet-500" },
  pink:   { name: "Pink",   badge: "bg-pink-50 text-pink-700 border-pink-200",        dot: "bg-pink-500" },
  teal:   { name: "Teal",   badge: "bg-teal-50 text-teal-800 border-teal-200",        dot: "bg-teal-500" },
  green:  { name: "Green",  badge: "bg-emerald-50 text-emerald-700 border-emerald-200", dot: "bg-emerald-500" },
  red:    { name: "Red",    badge: "bg-red-50 text-red-700 border-red-200",           dot: "bg-red-500" },
} as const;

export type StatusColor = keyof typeof STATUS_COLORS;
export type StatusStyles = Partial<Record<OrderStateKey, { label?: string; color?: StatusColor }>>;

/** Label + colour for a state, applying the business's overrides on top of the defaults. */
export function resolveStatus(key: string, overrides?: StatusStyles | null) {
  const base = getStateInfo(key);
  const o = overrides?.[base.key as OrderStateKey];
  const color = (o?.color && o.color in STATUS_COLORS ? o.color : base.color) as StatusColor;
  return { key: base.key, label: o?.label?.trim() || base.label, color, classes: STATUS_COLORS[color] };
}

export function parseStatusStyles(raw: unknown): StatusStyles {
  if (!raw) return {};
  if (typeof raw === "object") return raw as StatusStyles;
  try { const v = JSON.parse(String(raw)); return v && typeof v === "object" ? v : {}; } catch { return {}; }
}

export const DEFAULT_OVERDUE_DAYS = 30;

export function clampOverdueDays(n: unknown): number {
  const v = Math.round(Number(n));
  return Number.isFinite(v) && v >= 1 && v <= 365 ? v : DEFAULT_OVERDUE_DAYS;
}

/** ₹1,56,450 for whole rupees; ₹22,702.50 (always two paise digits) otherwise. */
export function formatINR(n: number): string {
  const v = Math.round(Number(n) * 100) / 100;
  const whole = Number.isInteger(v);
  return `${v < 0 ? "−" : ""}₹${Math.abs(v).toLocaleString("en-IN", { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 })}`;
}

export function genOrderId(): string {
  return `ORD-${Date.now().toString(36).toUpperCase().slice(-4)}${Math.random().toString(36).slice(2, 4).toUpperCase()}`;
}

export function genInvoiceNumber(): string {
  const now = new Date();
  return `INV-${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}

export const UNITS = ["piece", "box", "kg", "gram", "litre", "bag", "dozen", "quintal", "sq.ft", "sheet", "roll", "set"] as const;

export { GST_RATES } from "./gst";

export const SAMPLE_MESSAGES = [
  "Rajesh here from Hindustan Foods. Need 2000 pcs 5-ply medium boxes with partitions. Bhosari warehouse delivery by 28th. 9820012345",
  "QuickKart - 5000 mailer boxes chahiye with logo. White outside. 26th tak deliver karo Hinjewadi. 9820056789",
  "FreshBite se - 1500 large 5-ply boxes aur 3000 plain sheets chahiye. Food grade hona chahiye. Chakan delivery. 9820098765",
  "हिंदुस्तान फूड्स — ३००० पीस 3-प्लाई मीडियम बॉक्स चाहिए। भोसरी वेयरहाउस। 9820012345",
  "Deccan Agro - 4000 small 5-ply boxes. Hadapsar delivery. PO number DA-2026-089. 9820076543",
  "Need urgent 500 heavy duty 7-ply boxes for export shipment. FreshBite, Chakan. Kal chahiye. 9820098765",
];

export const TREDS_STATUSES = {
  uploading: { label: "Uploading", color: "warning" },
  uploaded: { label: "On TReDS", color: "info" },
  accepted: { label: "Buyer Accepted", color: "info" },
  bidding: { label: "Bidding", color: "violet" },
  funded: { label: "Funded", color: "success" },
  settled: { label: "Settled", color: "success" },
  rejected: { label: "Rejected", color: "danger" },
  expired: { label: "Expired", color: "danger" },
} as const;

export const PO_STATES = [
  { key: "draft", label: "Draft", variant: "default" as const },
  { key: "ordered", label: "Ordered", variant: "info" as const },
  { key: "partial", label: "Partial", variant: "warning" as const },
  { key: "received", label: "Received", variant: "success" as const },
  { key: "cancelled", label: "Cancelled", variant: "danger" as const },
] as const;

export function getPOStateInfo(key: string) {
  return PO_STATES.find(s => s.key === key) || PO_STATES[0];
}

export function genPOId(): string {
  return `PO-${Date.now().toString(36).toUpperCase().slice(-4)}${Math.random().toString(36).slice(2, 4).toUpperCase()}`;
}
