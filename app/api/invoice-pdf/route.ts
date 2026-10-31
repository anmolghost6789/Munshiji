import { one } from "@/lib/sql";
import { NextRequest, NextResponse } from "next/server";
import { renderToBuffer } from "@json-render/react-pdf";
import { getOrderById, getOrderItems, getBusinessProfile } from "@/lib/db";
import { clampOverdueDays } from "@/lib/types";
import { docTitle, parseRegistration, placeOfSupply, sellerStateCode, isInterState, splitTax, GST_STATES, round2 } from "@/lib/gst";
import { resolveBusiness, upiLink, isValidUpiId } from "@/lib/business";
import QRCode from "qrcode";
import { route } from "@/lib/api";
import { advanceOrder } from "@/lib/core/orders";
import { badRequest } from "@/lib/errors";

// ── Build @json-render spec for a GST invoice ─────────────────
interface Compliance { ewb: string; vehicle: string; irn: string; ack: string; irnQr: string | null; irnPending: boolean }
function buildInvoiceSpec(biz: any, order: any, items: any[], invoiceNumber: string, upiQr: string | null = null, comp: Compliance = { ewb: "", vehicle: "", irn: "", ack: "", irnQr: null, irnPending: false }) {
  const billDate = order.invoice_date ? new Date(String(order.invoice_date).replace(" ", "T") + "Z") : new Date();
  const settings = resolveBusiness(biz);
  const reg = settings.registration;
  const seller = sellerStateCode(biz);
  const pos = placeOfSupply(seller, order.customer_gstin, order.delivery_state);
  const inter = isInterState(seller, pos);
  const today = billDate.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  const b = biz || { company_name: "Your Company", gstin: "", address: "", city: "", state: "", pincode: "", udyam_number: "", phone: "", email: "" };
  const addr = [b.address, b.city, b.state, b.pincode].filter(Boolean).join(", ");
  const custAddr = order.customer_address || "";

  // GST breakdown
  const rateMap: Record<number, number> = {};
  for (const it of items) { const r = it.gst_rate || 0; rateMap[r] = (rateMap[r] || 0) + (it.gst_amount || 0); }

  const gstRows: string[][] = [];
  const money = (n: number) => `₹${round2(n).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;
  if (reg !== "regular") gstRows.push([reg === "composition" ? "Composition taxable person, not eligible to collect tax on supplies" : "Seller not registered under GST", ""]);
  for (const [rate, amt] of reg !== "regular" ? [] : Object.entries(rateMap).sort(([a],[b]) => Number(a) - Number(b))) {
    if (Number(rate) === 0) { gstRows.push(["GST @ 0% (Exempt)", "₹0"]); }
    else if (inter) { gstRows.push([`IGST @ ${Number(rate)}%`, money(Number(amt))]); }
    else {
      gstRows.push([`CGST @ ${Number(rate)/2}%`, `₹${(Number(amt)/2).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`]);
      gstRows.push([`SGST @ ${Number(rate)/2}%`, `₹${(Number(amt)/2).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`]);
    }
  }

  const itemRows = items.map((it: any, i: number) => [
    String(i + 1), it.product_name, it.hsn_code || "—",
    `${it.qty} ${it.unit}`, `₹${it.price.toLocaleString("en-IN")}`,
    reg === "regular" ? `${it.gst_rate}%` : "—", `₹${it.total.toLocaleString("en-IN")}`,
  ]);

  const elements: Record<string, any> = {
    doc: { type: "Document", props: { title: `Invoice ${invoiceNumber}`, author: b.company_name }, children: ["page"] },
    page: { type: "Page", props: { size: "A4", marginTop: 40, marginBottom: 40, marginLeft: 50, marginRight: 50 }, children: [
      "header", "sp1", "divider1", "sp2", "title", "sp3", "meta", "sp4", "billTo", "sp5",
      "itemsTable", "sp6", "totalsRow", "sp7", "amtWords", ...(upiQr ? ["sp10", "payBox"] : []), ...(comp.ewb || comp.vehicle || comp.irn || comp.irnPending ? ["sp11", "compliance"] : []), "sp8", "divider2", "sp9", "footer"
    ] },
    header: { type: "Column", props: { alignItems: "center", gap: 2 }, children: ["companyName", "companyAddr", "companyGst"] },
    companyName: { type: "Heading", props: { text: b.company_name, level: "h2", color: "#05362a", align: "center" } },
    companyAddr: { type: "Text", props: { text: addr, fontSize: 9, color: "#6c7268", align: "center" } },
    companyGst: { type: "Text", props: { text: [b.gstin ? `GSTIN: ${b.gstin}` : "", b.udyam_number ? `Udyam: ${b.udyam_number}` : "", b.phone ? `Ph: ${b.phone}` : ""].filter(Boolean).join(" · "), fontSize: 8, color: "#9aa095", align: "center" } },
    sp1: { type: "Spacer", props: { height: 8 } },
    divider1: { type: "Divider", props: { color: "#05362a", thickness: 2 } },
    sp2: { type: "Spacer", props: { height: 12 } },
    title: { type: "Heading", props: { text: (order.invoice_number ? "" : "DRAFT ") + docTitle(reg).toUpperCase(), level: "h3", color: "#4f5a52", align: "center" } },
    sp3: { type: "Spacer", props: { height: 12 } },
    meta: { type: "Row", props: { justifyContent: "space-between" }, children: ["metaLeft", "metaRight"] },
    metaLeft: { type: "Column", props: { gap: 2 }, children: ["invNo", "invDate"] },
    metaRight: { type: "Column", props: { gap: 2, alignItems: "flex-end" }, children: ["ordNo", "dueDate"] },
    invNo: { type: "Text", props: { text: `Invoice: ${invoiceNumber}`, fontSize: 10, fontWeight: "bold", color: "#05362a" } },
    invDate: { type: "Text", props: { text: `Date: ${today}`, fontSize: 9, color: "#6c7268" } },
    ordNo: { type: "Text", props: { text: `Order: ${order.id}`, fontSize: 10, fontWeight: "bold", color: "#05362a" } },
    dueDate: { type: "Text", props: { text: settings.caps.credit ? `Due: Net ${clampOverdueDays(b.overdue_days)}` : "Due on receipt", fontSize: 9, color: "#6c7268" } },
    sp4: { type: "Spacer", props: { height: 14 } },
    billTo: { type: "View", props: { backgroundColor: "#fbf8f1", borderWidth: 1, borderColor: "#e6e0d0", borderRadius: 8, padding: 12 }, children: ["btLabel", "btName", "btAddr", "btGstin", "btPos"] },
    btLabel: { type: "Text", props: { text: "BILL TO", fontSize: 8, fontWeight: "bold", color: "#9aa095" } },
    btName: { type: "Text", props: { text: order.customer_name, fontSize: 12, fontWeight: "bold", color: "#05362a" } },
    btAddr: { type: "Text", props: { text: custAddr, fontSize: 9, color: "#6c7268" } },
    btGstin: { type: "Text", props: { text: order.customer_gstin ? `GSTIN: ${order.customer_gstin}` : "", fontSize: 8, color: "#9aa095" } },
    btPos: { type: "Text", props: { text: reg === "regular" && pos ? `Place of supply: ${GST_STATES[pos]} (${pos})` : "", fontSize: 8, color: "#9aa095" } },
    sp5: { type: "Spacer", props: { height: 14 } },
    itemsTable: { type: "Table", props: {
      columns: [
        { header: "#", width: "5%", align: "left" },
        { header: "Item", width: "28%", align: "left" },
        { header: "HSN", width: "10%", align: "left" },
        { header: "Qty", width: "14%", align: "right" },
        { header: "Rate", width: "14%", align: "right" },
        { header: "GST", width: "9%", align: "right" },
        { header: "Amount", width: "20%", align: "right" },
      ],
      rows: itemRows,
      headerBackgroundColor: "#05362a", headerTextColor: "#fbf8f1",
      borderColor: "#e6e0d0", fontSize: 9, striped: true,
    } },
    sp6: { type: "Spacer", props: { height: 10 } },
    totalsRow: { type: "View", props: { alignItems: "flex-end" }, children: ["totalsInner"] },
    totalsInner: { type: "Table", props: {
      columns: [{ header: "", width: "60%", align: "left" }, { header: "", width: "40%", align: "right" }],
      rows: [
        ["Subtotal", `₹${order.subtotal.toLocaleString("en-IN", { minimumFractionDigits: 2 })}`],
        ...gstRows,
        ["TOTAL", `₹${order.grand_total.toLocaleString("en-IN", { minimumFractionDigits: 2 })}`],
      ],
      headerBackgroundColor: "#fbf8f1", headerTextColor: "#fbf8f1",
      borderColor: "#e6e0d0", fontSize: 9,
    } },
    sp7: { type: "Spacer", props: { height: 8 } },
    amtWords: { type: "Text", props: { text: `Amount in words: Rupees ${Math.floor(order.grand_total).toLocaleString("en-IN")} only`, fontSize: 9, fontStyle: "italic", color: "#6c7268" } },
    sp10: { type: "Spacer", props: { height: 12 } },
    payBox: { type: "Row", props: { gap: 12, alignItems: "center" }, children: ["payQr", "payText"] },
    payQr: { type: "Image", props: { src: upiQr || "", width: 84, height: 84, objectFit: "contain" } },
    payText: { type: "Column", props: { gap: 2 }, children: ["payTitle", "payId"] },
    payTitle: { type: "Text", props: { text: "Scan to pay with any UPI app", fontSize: 10, fontWeight: "bold", color: "#05362a" } },
    payId: { type: "Text", props: { text: `UPI ID: ${b.upi_id || ""}`, fontSize: 9, color: "#6c7268" } },
    sp11: { type: "Spacer", props: { height: 10 } },
    compliance: { type: "Column", props: { gap: 3 }, children: [...(comp.ewb || comp.vehicle ? ["ewbText"] : []), ...(comp.irnPending ? ["irnPending"] : []), ...(comp.irn ? ["irnRow"] : [])] },
    ewbText: { type: "Text", props: { text: [comp.ewb ? `E-way bill: ${comp.ewb.replace(/(\d{4})(?=\d)/g, "$1 ")}` : "", comp.vehicle ? `Vehicle: ${comp.vehicle}` : ""].filter(Boolean).join("   ·   "), fontSize: 9, color: "#18201c" } },
    irnPending: { type: "Text", props: { text: "IRN pending: this bill is not yet a valid e-invoice. Register it on the IRP and record the IRN in Munshiji.", fontSize: 9, fontWeight: "bold", color: "#b45309" } },
    irnRow: { type: "Row", props: { gap: 12, alignItems: "center" }, children: [...(comp.irnQr ? ["irnQr"] : []), "irnText"] },
    irnQr: { type: "Image", props: { src: comp.irnQr || "", width: 84, height: 84, objectFit: "contain" } },
    irnText: { type: "Column", props: { gap: 2 }, children: ["irnLabel", "irnValue", "irnAck"] },
    irnLabel: { type: "Text", props: { text: "E-invoice (IRN)", fontSize: 9, fontWeight: "bold", color: "#05362a" } },
    irnValue: { type: "Text", props: { text: comp.irn, fontSize: 7, color: "#4b5550" } },
    irnAck: { type: "Text", props: { text: comp.ack, fontSize: 8, color: "#4b5550" } },
    sp8: { type: "Spacer", props: { height: 16 } },
    divider2: { type: "Divider", props: { color: "#e6e0d0", thickness: 1 } },
    sp9: { type: "Spacer", props: { height: 8 } },
    footer: { type: "Row", props: { justifyContent: "space-between" }, children: ["footLeft", "footRight"] },
    footLeft: { type: "Text", props: { text: "Generated by Munshiji", fontSize: 8, color: "#9aa095" } },
    footRight: { type: "Text", props: { text: "E. & O.E.", fontSize: 8, color: "#9aa095" } },
  };

  return { root: "doc", elements };
}

// POST — create invoice record + return JSON
/** Make the bill for a delivered order (same as moving it to "Invoiced"). Calling twice returns the same bill. */
export const POST = route("invoices.create", async (req, actor) => {
  const { order_id } = (await req.json().catch(() => ({}))) as { order_id?: string };
  if (!order_id) throw badRequest("Missing order_id.");
  const existing = await getOrderById(order_id);
  if (existing?.invoice_number) return { success: true, invoice_number: existing.invoice_number, created: false };
  const o = await advanceOrder(order_id, "invoiced", actor);
  return { success: true, invoice_number: o.invoice_number, created: true };
});

// GET — render and return actual PDF binary
export const GET = route("orders.view", async (req) => {
  const orderId = req.nextUrl.searchParams.get("order_id");
  if (!orderId) return NextResponse.json({ error: "Missing order_id" }, { status: 400 });

  const order = await getOrderById(orderId);
  if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });

  const items = await getOrderItems(orderId);
  const biz = await getBusinessProfile();
  // The PDF carries the saved bill number and date (matching GST returns). Unbilled orders get a clearly marked draft.
  const invoiceNumber = order.invoice_number || `DRAFT-${order.id}`;

  try {
    const upi = (biz as any)?.upi_id as string | undefined;
    const due = Math.round((order.grand_total - (order.amount_paid || 0) - ((order as any).amount_credited || 0)) * 100) / 100; // the balance, not the full total
    const qr = upi && isValidUpiId(upi) && !["paid", "credited"].includes(order.state) && due > 0
      ? await QRCode.toDataURL(upiLink(upi, biz?.company_name || "", due, `Order ${order.id}`), { margin: 1, width: 240 })
      : null;
    const inv = order.invoice_id ? await one<{ einvoice_required: number; irn: string; ack_no: string; ack_date: string | null; signed_qr: string }>("SELECT einvoice_required, irn, ack_no, ack_date, signed_qr FROM invoices WHERE id = ?", [order.invoice_id]) : undefined;
    const comp: Compliance = {
      ewb: (order as any).ewb_number || "", vehicle: (order as any).vehicle_number || "",
      irn: inv?.irn || "", ack: inv?.irn ? `Ack ${inv.ack_no}${inv.ack_date ? ` · ${inv.ack_date.slice(0, 16)}` : ""}` : "",
      irnQr: inv?.signed_qr ? await QRCode.toDataURL(inv.signed_qr, { margin: 1, width: 240, errorCorrectionLevel: "L" }) : null,
      irnPending: !!inv?.einvoice_required && !inv.irn,
    };
    const spec = buildInvoiceSpec(biz, order, items, invoiceNumber, qr, comp);
    const buffer = await renderToBuffer(spec);
    const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;

    const filename = `${invoiceNumber}-${order.customer_name.replace(/[^a-zA-Z0-9]/g, "_")}.pdf`;
    return new Response(arrayBuffer, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
});
