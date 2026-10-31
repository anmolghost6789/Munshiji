/* ═══════════════════════════════════════════════════════════════
   BUSINESS CAPABILITIES
   The app never asks "is this retail?" — it asks what the business
   does (capabilities). Templates are just starting bundles of
   capabilities + wording. Safe to import on client and server.
   ═══════════════════════════════════════════════════════════════ */
import { ORDER_FLOW, type StatusStyles } from "./types";
import { parseRegistration, type Registration } from "./gst";

export interface Capabilities {
  /** Orders are confirmed before work starts */
  confirm_step: boolean;
  /** Makes its own products from raw materials (materials, BOM, production step wording) */
  production: boolean;
  /** Buys raw materials from suppliers and tracks their stock */
  purchases: boolean;
  /** Delivers orders to customers */
  delivery: boolean;
  /** Customers pay later (credit / udhaar): payment terms, overdue, reminders */
  credit: boolean;
  /** Kept for stored-settings compatibility. Invoice financing is not part of Munshiji; always false. */
  treds: boolean;
}

export type TemplateKey = "manufacturer" | "retail_delivery" | "custom";

export interface Vocabulary {
  customer: string;
  customers: string;
  preparing: string;
  dispatched: string;
  delivered: string;
}

const MAKER_WORDS: Vocabulary = { customer: "Buyer", customers: "Buyers", preparing: "In Production", dispatched: "Dispatched", delivered: "Delivered" };
const SHOP_WORDS: Vocabulary = { customer: "Customer", customers: "Customers", preparing: "Packing", dispatched: "Out for delivery", delivered: "Delivered" };

export const TEMPLATES: Record<Exclude<TemplateKey, "custom">, { name: string; description: string; caps: Capabilities; words: Vocabulary }> = {
  manufacturer: {
    name: "Manufacturer",
    description: "You make products and sell them to other businesses",
    caps: { confirm_step: true, production: true, purchases: true, delivery: true, credit: true, treds: false },
    words: MAKER_WORDS,
  },
  retail_delivery: {
    name: "Shop that delivers",
    description: "Customers order on WhatsApp or phone; you pack and deliver",
    caps: { confirm_step: false, production: false, purchases: false, delivery: true, credit: true, treds: false },
    words: SHOP_WORDS,
  },
};

/** The plain-language questions shown in setup and settings. TReDS isn't asked — it's a future feature. */
export const CAPABILITY_QUESTIONS: { key: Exclude<keyof Capabilities, "treds">; question: string; help: string }[] = [
  { key: "production", question: "Do you make your own products?", help: "Shows raw materials and a production step" },
  { key: "purchases", question: "Do you buy raw materials from suppliers?", help: "Shows purchases, suppliers and material stock" },
  { key: "confirm_step", question: "Do you confirm orders before starting work?", help: "Adds a “Confirmed” step" },
  { key: "delivery", question: "Do you deliver orders?", help: "Adds a delivery step" },
  { key: "credit", question: "Do customers pay you later?", help: "Tracks payment terms, overdue bills and reminders" },
];

export function parseCapabilities(raw: unknown, template: TemplateKey): Capabilities {
  const base = TEMPLATES[template === "custom" ? "manufacturer" : template].caps;
  let stored: Partial<Capabilities> = {};
  if (raw && typeof raw === "object") stored = raw as Partial<Capabilities>;
  else if (typeof raw === "string" && raw.trim()) { try { stored = JSON.parse(raw); } catch { stored = {}; } }
  const out = { ...base };
  for (const k of Object.keys(base) as (keyof Capabilities)[]) if (typeof stored[k] === "boolean") out[k] = stored[k] as boolean;
  out.treds = false; // no financing features
  return out;
}

export function parseTemplate(v: unknown): TemplateKey {
  return v === "retail_delivery" || v === "custom" ? v : "manufacturer";
}

export function wordsFor(template: TemplateKey, caps: Capabilities): Vocabulary {
  const w = template === "custom" ? (caps.production ? MAKER_WORDS : SHOP_WORDS) : TEMPLATES[template].words;
  return caps.delivery ? w : { ...w, delivered: "Handed over" };
}

/** The order steps this business uses, in order. "new", "delivered", "invoiced" and "paid" are anchors and always present. */
export function orderFlowKeys(caps: Capabilities): string[] {
  return ORDER_FLOW.map((s) => s.key).filter((k) => (k === "confirmed" ? caps.confirm_step : k === "dispatched" ? caps.delivery : true));
}

/** Next step for an order, skipping steps this business doesn't use. Works for orders sitting in a now-hidden step. */
export function nextStateIn(flow: string[], current: string): string | null {
  if (current === "overdue") return "paid";
  const lib = ORDER_FLOW.map((s) => s.key);
  const ci = lib.indexOf(current as (typeof lib)[number]);
  if (ci < 0) return null;
  return flow.find((k) => lib.indexOf(k as (typeof lib)[number]) > ci) ?? null;
}

/** Status labels from the template's wording, with the business's own renames on top. */
export function effectiveStatusStyles(words: Vocabulary, overrides: StatusStyles): StatusStyles {
  const defaults: StatusStyles = { preparing: { label: words.preparing }, dispatched: { label: words.dispatched }, delivered: { label: words.delivered } };
  const out: StatusStyles = { ...defaults };
  for (const [k, v] of Object.entries(overrides || {})) {
    const key = k as keyof StatusStyles;
    out[key] = { ...(out[key] || {}), ...(v?.color ? { color: v.color } : {}), ...(v?.label?.trim() ? { label: v.label } : {}) };
  }
  return out;
}

export interface BusinessSettings {
  template: TemplateKey;
  caps: Capabilities;
  words: Vocabulary;
  registration: Registration;
  flow: string[];
}

export function resolveBusiness(profile?: { template?: unknown; capabilities?: unknown; gst_registration?: unknown } | null): BusinessSettings {
  const template = parseTemplate(profile?.template);
  const caps = parseCapabilities(profile?.capabilities, template);
  return { template, caps, words: wordsFor(template, caps), registration: parseRegistration(profile?.gst_registration), flow: orderFlowKeys(caps) };
}

/** WhatsApp link for an Indian mobile number (adds 91 to 10-digit numbers). */
export function whatsappLink(phone: string | null | undefined, text: string): string {
  let d = (phone || "").replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("0")) d = d.slice(1);
  if (d.length === 10) d = `91${d}`;
  return d ? `https://wa.me/${d}?text=${encodeURIComponent(text)}` : `https://wa.me/?text=${encodeURIComponent(text)}`;
}

/** UPI payment link (works offline; any UPI app can read it as a QR code). */
export function upiLink(upiId: string, payeeName: string, amount: number, note: string): string {
  const p = new URLSearchParams({ pa: upiId.trim(), pn: payeeName.slice(0, 50), am: amount.toFixed(2), cu: "INR", tn: note.slice(0, 50) });
  return `upi://pay?${p.toString()}`;
}

export const isValidUpiId = (v?: string | null) => /^[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z][a-zA-Z0-9.\-]{1,63}$/.test((v || "").trim());
