/* Reads an order message into a DRAFT for a person to check. Never saves anything.
   Uses Azure OpenAI when configured; otherwise (or if it fails) a basic reader that matches
   quantities and catalog names. Unknown products are returned as unknown, never guessed. */
import { createOpenAI } from "@ai-sdk/openai";
import { generateText } from "ai";
import { getAllProducts, getAllCustomers } from "./db";
import { many, one, exec, tx, scalar } from "./sql";
import { istToday } from "./core/time";

export interface DraftLine { product_id: string | null; name: string; qty: number; unit?: string }
export interface DraftOrder {
  engine: "ai" | "basic";
  customer: { id?: string; name?: string; phone?: string; gstin?: string } | null;
  items: DraftLine[];
  delivery_date: string;
  notes: string;
  warning?: string;
}

const DEVANAGARI = "०१२३४५६७८९";
const normDigits = (t: string) => t.replace(/[०-९]/g, (d) => String(DEVANAGARI.indexOf(d)));
const STOP = new Set(["pcs", "pc", "piece", "pieces", "nos", "no", "chahiye", "chaiye", "bhejo", "bhej", "do", "dena", "and", "aur", "ke", "ki", "ka", "with", "the", "of", "for", "please", "pls", "ji", "sir", "bhai", "tak", "se", "me", "mein", "hai", "hain", "x", "qty"]);
/** Words that identify a product. Packaging trade conventions are kept whole: "5-ply", "5 ply" and "5ply" are one word,
    and sizes like 18x12x12, 18×12×12 and 18*12*12 are the same. */
const tokens = (t: string) => t.toLowerCase()
  .replace(/(\d)\s*[×✕*]\s*(?=\d)/g, "$1x")
  .replace(/(\d)\s*-?\s*ply\b/g, "$1ply")
  .replace(/[^\p{L}\p{N}\s-]/gu, " ").split(/[\s-]+/).filter((w) => w.length > 1 && !STOP.has(w));

/** Basic reader: "500 tape, 2000 medium boxes" style messages. */
export async function basicParse(message: string, today = istToday()): Promise<DraftOrder> {
  const text = normDigits(message);
  const products = (await getAllProducts()).filter((p) => (p as { active?: number }).active !== 0);
  const customers = await getAllCustomers();

  // Buyer: by phone number, then by a distinctive name word.
  let customer: DraftOrder["customer"] = null;
  const phones = (text.match(/(?:\+?91[\s-]?)?[6-9]\d{4}[\s-]?\d{5}/g) || []).map((p) => p.replace(/\D/g, "").slice(-10));
  const byPhone = customers.find((c) => phones.includes((c.phone || "").replace(/\D/g, "").slice(-10)));
  if (byPhone) customer = { id: byPhone.id, name: byPhone.name };
  else {
    const words = new Set(tokens(text));
    const scored = customers.map((c) => ({ c, s: tokens(c.name).filter((w) => w.length > 3 && !["private", "limited", "pvt", "ltd", "foods", "traders", "industries"].includes(w) && words.has(w)).length }))
      .filter((x) => x.s > 0).sort((a, b) => b.s - a.s);
    if (scored.length && (scored.length === 1 || scored[0].s > scored[1].s)) customer = { id: scored[0].c.id, name: scored[0].c.name };
  }

  // Lines: split on newlines, commas, "aur"/"and", "+"; each needs a quantity.
  const items: DraftLine[] = [];
  const itemText = text.replace(/(?:\+?91[\s-]?)?[6-9]\d{4}[\s-]?\d{5}/g, " "); // phone numbers are never quantities
  for (const seg of itemText.split(/\n|,|;|\+|\.\s|\.$|\baur\b|\band\b|\bbhi\b|\bthen\b/i)) {
    const m = seg.match(/(\d+(?:\.\d+)?)\s*(k\b|हज़ार|hazar|hazaar)?/i);
    if (!m) continue;
    const qty = Number(m[1]) * (m[2] ? 1000 : 1);
    if (!(qty > 0) || qty > 10_000_000) continue;
    if (/\b(\d{1,2})(st|nd|rd|th)\b/i.test(seg) && Number(m[1]) <= 31 && !/pcs|piece|roll|box|nos|kg/i.test(seg)) continue; // a date, not a quantity
    const segWords = new Set(tokens(seg.replace(m[0], " ")));
    if (!segWords.size) continue;
    const best = products.map((p) => {
      const pw = new Set([...tokens(p.name), ...tokens(p.name_hi || ""), ...tokens(p.sku || "")]);
      let s = 0; for (const w of segWords) if (pw.has(w)) s += w.length > 3 ? 2 : 1;
      return { p, s };
    }).sort((a, b) => b.s - a.s);
    const name = seg.replace(m[0], " ").replace(/\s+/g, " ").trim().slice(0, 80);
    if (best[0] && best[0].s >= 2 && (!best[1] || best[0].s > best[1].s)) items.push({ product_id: best[0].p.id, name: best[0].p.name, qty, unit: best[0].p.unit });
    else items.push({ product_id: null, name: name || "Unknown item", qty });
  }

  // Delivery: "28th", "28 tak", "kal"/"tomorrow".
  let delivery_date = "";
  const [y, mo, d] = today.split("-").map(Number);
  if (/\b(kal|tomorrow)\b/i.test(text)) delivery_date = new Date(Date.UTC(y, mo - 1, d + 1)).toISOString().slice(0, 10);
  const dm = text.match(/\b([0-3]?\d)(?:st|nd|rd|th)?\s*(?:tak|by|ko)\b|\b([0-3]?\d)(?:st|nd|rd|th)\b/i);
  if (dm) {
    const day = Number(dm[1] || dm[2]);
    if (day >= 1 && day <= 31) { const monthOffset = day < d ? 1 : 0; delivery_date = new Date(Date.UTC(y, mo - 1 + monthOffset, day)).toISOString().slice(0, 10); }
  }
  return { engine: "basic", customer, items, delivery_date, notes: "" };
}

async function azureModel() {
  const endpoint = (process.env.AZURE_OPENAI_ENDPOINT ?? "").replace(/\/$/, "");
  const apiKey = process.env.AZURE_OPENAI_API_KEY ?? "";
  const apiVersion = process.env.AZURE_OPENAI_API_VERSION ?? "2024-08-01-preview";
  const deployment = process.env.AZURE_OPENAI_DEPLOYMENT ?? "gpt-4o";
  const chatUrl = `${endpoint}/openai/deployments/${deployment}/chat/completions?api-version=${apiVersion}`;
  const azure = createOpenAI({ apiKey, baseURL: `${endpoint}/openai/deployments/${deployment}`, headers: { "api-key": apiKey }, fetch: async (_u: RequestInfo | URL, init?: RequestInit) => fetch(chatUrl, init) });
  return azure.chat(deployment);
}

export const aiConfigured = () => !!(process.env.AZURE_OPENAI_ENDPOINT && process.env.AZURE_OPENAI_API_KEY);

async function aiParse(message: string): Promise<DraftOrder> {
  const products = await getAllProducts();
  const customers = await getAllCustomers();
  const system = `You read Indian business order messages (any language or mix) into JSON. Match products ONLY from this catalog by id; if unsure, use null.
CATALOG:\n${products.map((p) => `"${p.id}" | ${p.name} | ${p.name_hi || ""} | unit ${p.unit}`).join("\n")}
BUYERS:\n${customers.map((c) => `"${c.id}" | ${c.name} | ${c.phone || ""}`).join("\n")}
Reply with ONLY JSON: {"customer":{"id":"<buyer id or null>","name":"...","phone":"..."},"items":[{"product_id":"<catalog id or null>","name":"<as written>","qty":<number>}],"delivery_date":"YYYY-MM-DD or empty","notes":"..."}`;
  const { text } = await generateText({ model: await azureModel() as never, system, prompt: `Today is ${istToday()}.\n"""\n${message}\n"""`, maxRetries: 1, abortSignal: AbortSignal.timeout(20_000) });
  const j = JSON.parse(text.replace(/^```(?:json)?\n?/m, "").replace(/\n?```$/m, "").trim());
  const ids = new Set(products.map((p) => p.id));
  const cids = new Set(customers.map((c) => c.id));
  return {
    engine: "ai",
    customer: j.customer ? { id: cids.has(j.customer.id) ? j.customer.id : undefined, name: j.customer.name || undefined, phone: j.customer.phone || undefined } : null,
    items: (Array.isArray(j.items) ? j.items : []).map((i: { product_id?: string; name?: string; qty?: number }) => {
      const p = i.product_id && ids.has(i.product_id) ? products.find((x) => x.id === i.product_id)! : null;
      return { product_id: p ? p.id : null, name: p ? p.name : String(i.name || "Unknown item").slice(0, 80), qty: Number(i.qty) > 0 ? Number(i.qty) : 1, unit: p?.unit };
    }),
    delivery_date: /^\d{4}-\d{2}-\d{2}$/.test(j.delivery_date || "") ? j.delivery_date : "",
    notes: String(j.notes || "").slice(0, 500),
  };
}

export async function parseOrderMessage(message: string): Promise<DraftOrder> {
  const msg = message.slice(0, 5000);
  if (aiConfigured()) {
    try { return await aiParse(msg); }
    catch (e) { const d = await basicParse(msg); d.warning = `The AI reader was unavailable (${String((e as Error).message || e).slice(0, 80)}), so a basic reader was used. Check every line.`; return d; }
  }
  const d = await basicParse(msg);
  d.warning = "Read by the basic reader (AI is not set up). Check every line.";
  return d;
}
