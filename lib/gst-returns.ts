/* GST return preparation. Builds summaries from bills already in Munshiji.
   Nothing here is filed — it prepares figures for the owner or their CA to file. */
import { getBillsForPeriod, getPurchasesForPeriod, getUnbilledDeliveredCount, getBusinessProfile } from "./db";
import { many, one, exec, tx, scalar } from "./sql";
import {
  B2CL_THRESHOLD, GST_STATES, RATE_CHANGE_DATE, checkGstin, isInterState, isRetiredRate, parseRegistration,
  placeOfSupply, round2, sellerStateCode, splitTax, stateCodeFromGstin, type Registration,
} from "./gst";

export type CheckLevel = "error" | "warning" | "info";
export interface Check { level: CheckLevel; message: string; refs?: string[] }

const monthRange = (month: string) => {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, "0")}` };
};

const quarterOf = (month: string) => {
  const [y, m] = month.split("-").map(Number);
  // GST quarters follow the financial year: Apr–Jun, Jul–Sep, Oct–Dec, Jan–Mar
  const qStartMonth = [1, 4, 7, 10].reduce((acc, s) => (m >= s ? s : acc), 1);
  const startM = qStartMonth;
  const endM = startM + 2;
  const last = new Date(Date.UTC(y, endM, 0)).getUTCDate();
  const names: Record<number, string> = { 4: "Apr–Jun", 7: "Jul–Sep", 10: "Oct–Dec", 1: "Jan–Mar" };
  return { from: `${y}-${String(startM).padStart(2, "0")}-01`, to: `${y}-${String(endM).padStart(2, "0")}-${last}`, label: `${names[startM]} ${y}`, endMonth: endM, year: y };
};

const addMonth = (y: number, m: number) => (m === 12 ? { y: y + 1, m: 1 } : { y, m: m + 1 });
const fmtDue = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10);

export async function prepareReturns(month: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error("Month must look like 2026-10");
  const biz = await getBusinessProfile();
  const registration: Registration = parseRegistration(biz?.gst_registration);
  const seller = sellerStateCode(biz);
  const checks: Check[] = [];

  const sellerGstin = checkGstin(biz?.gstin);
  if (registration !== "none" && !sellerGstin.valid) {
    checks.push({ level: "error", message: biz?.gstin ? `Your GSTIN in Settings isn't valid: ${sellerGstin.valid ? "" : sellerGstin.error}` : "Add your GSTIN in Settings" });
  }

  const unbilled = await getUnbilledDeliveredCount();
  if (unbilled > 0) checks.push({ level: "info", message: `${unbilled} delivered ${unbilled === 1 ? "order has" : "orders have"} no bill yet. Bill them if the sale happened this month.` });

  /* ── Composition: CMP-08 for the quarter ── */
  if (registration === "composition") {
    const q = quarterOf(month);
    const bills = await getBillsForPeriod(q.from, q.to);
    const turnover = round2(bills.reduce((s, b) => s + b.subtotal, 0));
    const rate = [1, 5, 6].includes(Number(biz?.composition_rate)) ? Number(biz?.composition_rate) : 1;
    const tax = round2((turnover * rate) / 100);
    const next = addMonth(q.year, q.endMonth);
    const charged = bills.filter((b) => b.gst > 0).map((b) => b.order_id);
    if (charged.length) checks.push({ level: "error", message: "Some bills in this quarter charge GST, which a composition business can't collect. They were created before the switch to composition.", refs: charged });
    return {
      registration, month, checks,
      cmp08: { quarter: q.label, from: q.from, to: q.to, bills: bills.length, turnover, rate, tax, cgst: round2(tax / 2), sgst: round2(tax - round2(tax / 2)), due: fmtDue(next.y, next.m, 18) },
    };
  }

  /* ── Regular: GSTR-1 and GSTR-3B for the month ── */
  const { from, to } = monthRange(month);
  const bills = await getBillsForPeriod(from, to);

  const b2b: { gstin: string; name: string; bill: string; date: string; pos: string; value: number; taxable: number; igst: number; cgst: number; sgst: number; rates: string }[] = [];
  const b2cl: typeof b2b = [];
  const b2cs = new Map<string, { pos: string; rate: number; taxable: number; igst: number; cgst: number; sgst: number }>();
  const hsn = new Map<string, { hsn: string; rate: number; unit: string; qty: number; taxable: number; igst: number; cgst: number; sgst: number }>();
  let nilExempt = 0;
  const missingHsn: string[] = [];
  const oldRate: string[] = [];
  const badBuyerGstin: string[] = [];
  const noGstCharged: string[] = [];

  for (const b of bills) {
    const buyer = (b.customer_gstin || "").trim();
    const buyerCheck = buyer ? checkGstin(buyer) : null;
    if (buyer && buyerCheck && !buyerCheck.valid) badBuyerGstin.push(`${b.order_id} (${b.customer_name})`);
    const isB2B = !!buyerCheck?.valid;
    const pos = placeOfSupply(seller, isB2B ? buyer : null, (b as { delivery_state?: string }).delivery_state);
    const inter = isInterState(seller, pos);
    const billNo = b.invoice_number || b.order_id;
    const date = b.bill_date.slice(0, 10);

    let taxable = 0;
    const tax = { igst: 0, cgst: 0, sgst: 0 };
    const rates = new Set<number>();
    for (const it of b.items) {
      if (!it.hsn_code) missingHsn.push(`${b.order_id}: ${it.product_name}`);
      if (isRetiredRate(it.gst_rate) && date >= RATE_CHANGE_DATE) oldRate.push(`${b.order_id}: ${it.product_name} at ${it.gst_rate}%`);
      if (Number(it.gst_rate) === 0) { nilExempt += it.total; continue; }
      if (!it.gst_amount && it.total > 0) noGstCharged.push(`${b.order_id}: ${it.product_name}`);
      const t = splitTax(it.gst_amount, inter);
      taxable += it.total; tax.igst += t.igst; tax.cgst += t.cgst; tax.sgst += t.sgst; rates.add(Number(it.gst_rate));

      const hk = `${it.hsn_code || "—"}|${it.gst_rate}|${it.unit}`;
      const h = hsn.get(hk) || { hsn: it.hsn_code || "—", rate: Number(it.gst_rate), unit: it.unit, qty: 0, taxable: 0, igst: 0, cgst: 0, sgst: 0 };
      h.qty += it.qty; h.taxable += it.total; h.igst += t.igst; h.cgst += t.cgst; h.sgst += t.sgst; hsn.set(hk, h);

      if (!isB2B && !(inter && b.grand_total > B2CL_THRESHOLD)) {
        const ck = `${pos}|${it.gst_rate}`;
        const c = b2cs.get(ck) || { pos: pos || "", rate: Number(it.gst_rate), taxable: 0, igst: 0, cgst: 0, sgst: 0 };
        c.taxable += it.total; c.igst += t.igst; c.cgst += t.cgst; c.sgst += t.sgst; b2cs.set(ck, c);
      }
    }
    const row = { gstin: buyer, name: b.customer_name, bill: billNo, date, pos: pos || "", value: b.grand_total, taxable: round2(taxable), igst: round2(tax.igst), cgst: round2(tax.cgst), sgst: round2(tax.sgst), rates: [...rates].sort((a, c) => a - c).map((r) => `${r}%`).join(", ") };
    if (isB2B) b2b.push(row);
    else if (inter && b.grand_total > B2CL_THRESHOLD) b2cl.push(row);
  }

  if (missingHsn.length) checks.push({ level: "error", message: `${missingHsn.length} ${missingHsn.length === 1 ? "item has" : "items have"} no HSN code. Add HSN codes to these products in Catalog.`, refs: missingHsn });
  if (oldRate.length) checks.push({ level: "warning", message: `${oldRate.length} ${oldRate.length === 1 ? "item uses" : "items use"} a GST rate abolished on 22 Sep 2025 (12% or 28%). Check the current rate for these products.`, refs: oldRate });
  if (noGstCharged.length) checks.push({ level: "error", message: `${noGstCharged.length} ${noGstCharged.length === 1 ? "item was" : "items were"} billed without GST, probably while the business was set to composition or not registered. Check these bills with your CA.`, refs: noGstCharged });
  if (badBuyerGstin.length) checks.push({ level: "warning", message: `${badBuyerGstin.length} ${badBuyerGstin.length === 1 ? "bill has" : "bills have"} a buyer GSTIN that isn't valid. They're counted as sales to consumers until the GSTIN is fixed.`, refs: badBuyerGstin });

  /* Credit notes issued this month (GSTR-1 Table 9B). To registered buyers: CDNR. Against large inter-state
     consumer bills: CDNUR. Other consumer credit notes reduce B2CS. HSN and GSTR-3B are net of all of them. */
  const notes = await many<{ id: string; number: string; created_at: string; subtotal: number; cgst: number; sgst: number; igst: number; grand_total: number; place_of_supply: string; reason: string; invoice_number: string; invoice_date: string; invoice_total: number; customer_gstin: string; customer_name: string }>(
    `SELECT cn.id, cn.number, cn.created_at, cn.subtotal, cn.cgst, cn.sgst, cn.igst, cn.grand_total, cn.place_of_supply, cn.reason,
            inv.invoice_number, inv.created_at AS invoice_date, inv.grand_total AS invoice_total, c.gstin AS customer_gstin, c.name AS customer_name
     FROM credit_notes cn JOIN invoices inv ON inv.id = cn.invoice_id JOIN customers c ON c.id = inv.customer_id
     WHERE cn.created_at >= ? AND cn.created_at <= ? ORDER BY cn.created_at`, [from, to + " 23:59:59"]);
  const cdnr: { gstin: string; name: string; note: string; date: string; bill: string; billDate: string; pos: string; value: number; taxable: number; igst: number; cgst: number; sgst: number }[] = [];
  const cdnur: typeof cdnr = [];
  for (const n of notes) {
    const buyerOk = n.customer_gstin && checkGstin(n.customer_gstin).valid;
    const inter = Number(n.igst) > 0;
    const row = { gstin: buyerOk ? n.customer_gstin : "", name: n.customer_name, note: n.number, date: n.created_at.slice(0, 10), bill: n.invoice_number, billDate: n.invoice_date.slice(0, 10), pos: n.place_of_supply || seller || "", value: n.grand_total, taxable: n.subtotal, igst: n.igst, cgst: n.cgst, sgst: n.sgst };
    if (buyerOk) cdnr.push(row);
    else if (inter && n.invoice_total > B2CL_THRESHOLD) cdnur.push(row);
    const items = await many<{ qty: number; unit: string; total: number; hsn_code: string; gst_rate: number; gst_amount: number }>("SELECT qty, unit, total, hsn_code, gst_rate, gst_amount FROM credit_note_items WHERE credit_note_id = ?", [n.id]);
    for (const it of items) {
      if (Number(it.gst_rate) === 0) { nilExempt -= it.total; continue; }
      const t = splitTax(it.gst_amount, inter);
      const hk = `${it.hsn_code || "—"}|${it.gst_rate}|${it.unit}`;
      const h = hsn.get(hk) || { hsn: it.hsn_code || "—", rate: Number(it.gst_rate), unit: it.unit, qty: 0, taxable: 0, igst: 0, cgst: 0, sgst: 0 };
      h.qty -= it.qty; h.taxable -= it.total; h.igst -= t.igst; h.cgst -= t.cgst; h.sgst -= t.sgst; hsn.set(hk, h);
      if (!buyerOk && !(inter && n.invoice_total > B2CL_THRESHOLD)) {
        const ck = `${row.pos}|${it.gst_rate}`;
        const c = b2cs.get(ck) || { pos: row.pos, rate: Number(it.gst_rate), taxable: 0, igst: 0, cgst: 0, sgst: 0 };
        c.taxable -= it.total; c.igst -= t.igst; c.cgst -= t.cgst; c.sgst -= t.sgst; b2cs.set(ck, c);
      }
    }
  }
  const { pendingIrns } = await import("./core/gstdocs");
  const noIrn = await pendingIrns();
  if (noIrn.length) checks.push({ level: "error", message: `${noIrn.length} ${noIrn.length === 1 ? "bill needs" : "bills need"} an IRN (e-invoicing). Generate ${noIrn.length === 1 ? "it" : "them"} on the IRP and record the IRN on the bill.`, refs: noIrn.map((b) => b.invoice_number) });

  const sum = (rows: { taxable: number; igst: number; cgst: number; sgst: number }[]) => rows.reduce((a, r) => ({ taxable: a.taxable + r.taxable, igst: a.igst + r.igst, cgst: a.cgst + r.cgst, sgst: a.sgst + r.sgst }), { taxable: 0, igst: 0, cgst: 0, sgst: 0 });
  const r2 = (o: { taxable: number; igst: number; cgst: number; sgst: number }) => ({ taxable: round2(o.taxable), igst: round2(o.igst), cgst: round2(o.cgst), sgst: round2(o.sgst) });
  const b2csRows = [...b2cs.values()].map((r) => ({ ...r, ...r2(r), stateName: GST_STATES[r.pos] || "" }));
  const hsnRows = [...hsn.values()].map((r) => ({ ...r, qty: round2(r.qty), ...r2(r) }));
  const outward = r2(sum(hsnRows));

  /* Input tax credit from purchases received this month */
  const purchases = await getPurchasesForPeriod(from, to);
  const itc = { igst: 0, cgst: 0, sgst: 0 };
  const badSupplier: string[] = [];
  for (const p of purchases) {
    if (!p.gst) continue;
    const sc = checkGstin(p.supplier_gstin);
    if (!sc.valid) { badSupplier.push(`${p.id} (${p.supplier_name})`); continue; }
    const t = splitTax(p.gst, isInterState(seller, stateCodeFromGstin(p.supplier_gstin)));
    itc.igst += t.igst; itc.cgst += t.cgst; itc.sgst += t.sgst;
  }
  if (badSupplier.length) checks.push({ level: "warning", message: `${badSupplier.length} ${badSupplier.length === 1 ? "purchase has" : "purchases have"} no valid supplier GSTIN, so no input credit is counted for them.`, refs: badSupplier });
  if (purchases.length) checks.push({ level: "info", message: "Input credit here is from your purchase records. Only credit that appears in your GSTR-2B on the GST portal can be claimed — compare before filing." });

  const itcR = { igst: round2(itc.igst), cgst: round2(itc.cgst), sgst: round2(itc.sgst) };
  const outTax = outward.igst + outward.cgst + outward.sgst;
  const itcTax = itcR.igst + itcR.cgst + itcR.sgst;
  const next = (() => { const [y, m] = month.split("-").map(Number); return addMonth(y, m); })();

  return {
    registration, month, checks,
    gstr1: {
      bills: bills.length,
      b2b, b2cl, b2cs: b2csRows, hsn: hsnRows, cdnr, cdnur,
      totals: { b2b: r2(sum(b2b)), b2cl: r2(sum(b2cl)), b2cs: r2(sum(b2csRows)), cdnr: r2(sum(cdnr)), cdnur: r2(sum(cdnur)), nilExempt: round2(nilExempt) },
      due: fmtDue(next.y, next.m, 11),
    },
    gstr3b: {
      outward, nilExempt: round2(nilExempt), itc: itcR,
      estimatedPayable: round2(Math.max(0, outTax - itcTax)),
      due: fmtDue(next.y, next.m, 20),
    },
  };
}

/* ── CSV export ── */
const csvCell = (v: unknown) => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const toCsv = (headers: string[], rows: unknown[][]) => [headers, ...rows].map((r) => r.map(csvCell).join(",")).join("\n");
const posLabel = (code: string) => (code ? `${code}-${GST_STATES[code] || ""}` : "");

export async function returnsCsv(month: string, section: string): Promise<{ filename: string; csv: string } | null> {
  const r = await prepareReturns(month);
  if (!("gstr1" in r) || !r.gstr1) return null;
  const g = r.gstr1;
  if (section === "b2b") return { filename: `GSTR1_B2B_${month}.csv`, csv: toCsv(["GSTIN of recipient", "Receiver name", "Invoice number", "Invoice date", "Invoice value", "Place of supply", "Rates", "Taxable value", "IGST", "CGST", "SGST"], g.b2b.map((x) => [x.gstin, x.name, x.bill, x.date, x.value, posLabel(x.pos), x.rates, x.taxable, x.igst, x.cgst, x.sgst])) };
  if (section === "b2cl") return { filename: `GSTR1_B2CL_${month}.csv`, csv: toCsv(["Invoice number", "Invoice date", "Invoice value", "Place of supply", "Rates", "Taxable value", "IGST"], g.b2cl.map((x) => [x.bill, x.date, x.value, posLabel(x.pos), x.rates, x.taxable, x.igst])) };
  if (section === "cdnr") return { filename: `GSTR1_CDNR_${month}.csv`, csv: toCsv(["Buyer GSTIN", "Buyer name", "Credit note number", "Credit note date", "Original bill", "Original bill date", "Place of supply", "Note value", "Taxable value", "IGST", "CGST", "SGST"], g.cdnr.map((x) => [x.gstin, x.name, x.note, x.date, x.bill, x.billDate, x.pos, x.value, x.taxable, x.igst, x.cgst, x.sgst])) };
  if (section === "cdnur") return { filename: `GSTR1_CDNUR_${month}.csv`, csv: toCsv(["Credit note number", "Credit note date", "Original bill", "Original bill date", "Place of supply", "Note value", "Taxable value", "IGST"], g.cdnur.map((x) => [x.note, x.date, x.bill, x.billDate, x.pos, x.value, x.taxable, x.igst])) };
  if (section === "b2cs") return { filename: `GSTR1_B2CS_${month}.csv`, csv: toCsv(["Place of supply", "Rate", "Taxable value", "IGST", "CGST", "SGST"], g.b2cs.map((x) => [posLabel(x.pos), x.rate, x.taxable, x.igst, x.cgst, x.sgst])) };
  if (section === "hsn") return { filename: `GSTR1_HSN_${month}.csv`, csv: toCsv(["HSN", "UQC", "Total quantity", "Rate", "Taxable value", "IGST", "CGST", "SGST"], g.hsn.map((x) => [x.hsn, x.unit, x.qty, x.rate, x.taxable, x.igst, x.cgst, x.sgst])) };
  return null;
}
