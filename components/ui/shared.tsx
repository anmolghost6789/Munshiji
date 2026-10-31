"use client";
import { createContext, useContext } from "react";
import { formatINR, PO_STATES, getPOStateInfo, resolveStatus, DEFAULT_OVERDUE_DAYS, type StatusStyles } from "@/lib/types";
import { resolveBusiness, type BusinessSettings } from "@/lib/business";
import { isInterState, placeOfSupply } from "@/lib/gst";

// ═══ Types ═══
export interface OrderItem { product_id: string; product_name: string; qty: number; unit: string; price: number; total: number; hsn_code: string; gst_rate: number; gst_amount: number; }
export interface Order { id: string; customer_id: string; state: string; subtotal: number; gst: number; grand_total: number; delivery_date: string; notes: string; raw_message: string; created_at: string; customer_name: string; customer_phone: string; customer_address: string; customer_gstin: string; items: OrderItem[]; bill_age_days?: number; display_state?: string; invoice_number?: string | null; invoice_date?: string | null; version?: number; amount_paid?: number; stock_deducted?: number; source?: string; cancel_reason?: string; }
export interface Product { id: string; name: string; name_hi: string; sku: string; unit: string; price: number; hsn_code: string; gst_rate: number; }
export interface Customer { id: string; name: string; phone: string; address: string; gstin: string; treds_registered: number; stats: { order_count: number; total_value: number; outstanding: number }; }
export interface BizProfile { company_name: string; gstin: string; udyam_number: string; pan: string; address: string; city: string; state: string; pincode: string; phone: string; email: string; bank_name: string; bank_account: string; bank_ifsc: string; treds_platform: string; treds_seller_id: string; overdue_days?: number; status_styles?: string; template?: string; capabilities?: string; gst_registration?: string; composition_rate?: number; upi_id?: string; }
export interface CashFlowStats { receivables: number; overdueCount: number; thisMonth: number; }
export interface Invoice { id: string; order_id: string; customer_id: string; invoice_number: string; subtotal: number; cgst: number; sgst: number; grand_total: number; status: string; irn: string; e_invoice_status: string; created_at: string; customer_name: string; customer_gstin: string; }
export type Page = "orders" | "products" | "customers" | "cashflow" | "invoices" | "suppliers" | "purchases" | "inventory" | "settings";

// ═══ Purchase-side types ═══
export interface Supplier { id: string; name: string; phone: string; address: string; gstin: string; contact_person: string; payment_terms: string; stats: { po_count: number; total_value: number; pending: number }; }
export interface RawMaterial { id: string; name: string; name_hi: string; sku: string; unit: string; hsn_code: string; gst_rate: number; current_stock: number; reorder_level: number; last_purchase_price: number; }
export interface PurchaseOrder { id: string; supplier_id: string; state: string; subtotal: number; gst: number; grand_total: number; expected_date: string; notes: string; bill_number: string; created_at: string; supplier_name: string; supplier_phone: string; supplier_gstin: string; items: PurchaseItem[]; }
export interface PurchaseItem { id: number; po_id: string; material_id: string; material_name: string; qty: number; unit: string; price: number; total: number; hsn_code: string; gst_rate: number; gst_amount: number; }
export interface InventoryEntry { id: number; item_type: string; item_id: string; item_name: string; direction: string; qty: number; unit: string; ref_type: string; ref_id: string; notes: string; created_at: string; }
export interface BomEntry { product_name: string; material_name: string; qty_per_unit: number; unit: string; }

// ═══ Status settings (labels, colours, overdue threshold) ═══
export interface AppSettings {
  role: "owner" | "manager" | "staff" | string;
  styles: StatusStyles;
  overdueDays: number;
  biz: BusinessSettings;
  sellerState: string | null;
  upiId: string;
  companyName: string;
}
export const StatusContext = createContext<AppSettings>({ role: "staff", styles: {}, overdueDays: DEFAULT_OVERDUE_DAYS, biz: resolveBusiness(null), sellerState: null, upiId: "", companyName: "" });
export function useStatus() {
  const ctx = useContext(StatusContext);
  return { ...ctx, resolve: (key: string) => resolveStatus(key, ctx.styles) };
}

export function StateBadge({ state, size = "sm" }: { state: string; size?: "xs" | "sm" }) {
  const { resolve } = useStatus();
  const st = resolve(state);
  const sz = size === "xs" ? "text-xs px-1.5 py-0" : "text-xs px-2 py-0.5";
  return <span className={`inline-flex items-center gap-1.5 rounded-full font-semibold border font-mono ${st.classes.badge} ${sz}`}><span className={`w-1.5 h-1.5 rounded-full ${st.classes.dot}`}/>{st.label}</span>;
}


export function POBadge({ state, size = "sm" }: { state: string; size?: "xs" | "sm" }) {
  const info = getPOStateInfo(state);
  const v = info.variant;
  const c: Record<string, string> = { default: "bg-stone-100 text-stone-600 border-stone-200", info: "bg-blue-50 text-blue-600 border-blue-200", success: "bg-emerald-50 text-emerald-700 border-emerald-200", warning: "bg-amber-50 text-amber-700 border-amber-200", danger: "bg-red-50 text-red-600 border-red-200" };
  const d: Record<string, string> = { default: "bg-stone-400", info: "bg-blue-500", success: "bg-emerald-500", warning: "bg-amber-500", danger: "bg-red-500" };
  const sz = size === "xs" ? "text-xs px-1.5 py-0" : "text-xs px-2 py-0.5";
  return <span className={`inline-flex items-center gap-1.5 rounded-full font-semibold border font-mono ${c[v]||c.default} ${sz}`}><span className={`w-1.5 h-1.5 rounded-full ${d[v]||d.default}`}/>{info.label}</span>;
}

export function GstBreakdown({ items, customerGstin, deliveryState }: { items: OrderItem[]; customerGstin?: string; deliveryState?: string }) {
  const { biz, sellerState } = useStatus();
  if (biz.registration !== "regular") {
    return <div className="flex justify-between text-xs text-stone-500"><span>{biz.registration === "composition" ? "No GST (composition scheme)" : "No GST (not registered)"}</span><span className="font-mono">₹0</span></div>;
  }
  const inter = isInterState(sellerState, placeOfSupply(sellerState, customerGstin, deliveryState));
  const rateMap: Record<number, number> = {};
  for (const it of items) { const r = it.gst_rate || 0; rateMap[r] = (rateMap[r] || 0) + (it.gst_amount || 0); }
  return <>{Object.entries(rateMap).sort(([a],[b])=>Number(a)-Number(b)).map(([rate, amt]) => {
    if (Number(rate) === 0) return <div key={rate} className="flex justify-between text-xs text-stone-500"><span>GST @ 0% (exempt)</span><span className="font-mono">₹0</span></div>;
    if (inter) return <div key={rate} className="flex justify-between text-xs text-stone-500"><span>IGST @ {Number(rate)}%</span><span className="font-mono">{formatINR(Number(amt))}</span></div>;
    return <div key={rate}><div className="flex justify-between text-xs text-stone-500"><span>CGST @ {Number(rate)/2}%</span><span className="font-mono">{formatINR(Number(amt)/2)}</span></div><div className="flex justify-between text-xs text-stone-500"><span>SGST @ {Number(rate)/2}%</span><span className="font-mono">{formatINR(Number(amt)/2)}</span></div></div>;
  })}</>;
}
