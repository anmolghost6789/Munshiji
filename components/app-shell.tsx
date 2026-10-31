"use client";
import { useState, useEffect, useCallback } from "react";
import { IcWhatsApp, IcPackage, IcUsers, IcGrid, IcFile, IcPlus, IcSearch, IcPhone, IcMapPin, IcTrash, IcMenu, IcBanknote, IcTrendingUp, IcBuilding, IcZap, IcClock, IcSettings, IcShield, IcCheck, IcTruck, IcLayers, IcWarehouse, IcAlertTriangle, IcArrowDown, IcArrowUp, IcCalendar, IcDownload } from "./icons";
import { LogoTile, Mascot, Wordmark } from "./brand";
import { Avatar, Card, CountUp, Delta, Pill, Segmented, BarChart, Gauge, StatTile, OrdersTable } from "./ui/kit";
import { IcChevronsUpDown, IcMore, IcContrast, IcLogOut, IcBox } from "./icons";
import { formatINR, UNITS, GST_RATES, getPOStateInfo, resolveStatus, parseStatusStyles, clampOverdueDays, STATUS_COLORS, ORDER_STATES, DEFAULT_OVERDUE_DAYS, type StatusColor, type StatusStyles } from "@/lib/types";
import { StateBadge, StatusContext, POBadge, GstBreakdown, type Order, type Product, type Customer, type BizProfile, type CashFlowStats, type Invoice, type Page, type Supplier, type RawMaterial, type PurchaseOrder, type InventoryEntry } from "./ui/shared";
import { signOut, useSession } from "next-auth/react";
import { ParseModal } from "./ui/parse-modal";
import { OrderDrawer, InvoiceModal, reminderText } from "./ui/modals";
import { SetupWizard } from "./ui/setup-wizard";
import { GstPage } from "./ui/gst-page";
import { StockPage } from "./ui/stock-page";
import { TeamSettings } from "./ui/team";
import { InboxPanel } from "./ui/inbox";
import { BusinessSwitcher, type MeBusiness } from "./ui/business-switcher";
import { ProfileSettings } from "./ui/profile-settings";
import { DataSettings } from "./ui/data-settings";
import { ContactsPage } from "./ui/contacts";
import { NoBusiness } from "./ui/no-business";
import { EmailSettings } from "./ui/email-settings";
import { TemplatePicker, CapabilityQuestions, GstDetails, StateSelect } from "./ui/business-setup";
import { resolveBusiness, effectiveStatusStyles, isValidUpiId, nextStateIn, whatsappLink } from "@/lib/business";
import { sellerStateCode, isRetiredRate, checkGstin } from "@/lib/gst";
import { useRef } from "react";

// ─── Simple tab component ───────────────────────────────────────
function Tabs({ tabs, active, onChange }: { tabs: { key: string; label: string; count?: number }[]; active: string; onChange: (k: string) => void }) {
  return (
    <div className="flex gap-1 mb-4 border-b border-stone-200 -mx-1">
      {tabs.map(t => (
        <button key={t.key} onClick={() => onChange(t.key)} className={`px-4 py-2.5 text-sm font-medium transition-all border-b-2 -mb-px ${active === t.key ? "border-stone-800 text-stone-800" : "border-transparent text-stone-400 hover:text-stone-600"}`}>
          {t.label}{t.count !== undefined && <span className="ml-1.5 text-xs font-mono text-stone-400">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

// ─── Aging bucket helper ────────────────────────────────────────
function AgingBuckets({ items, overdueDays }: { items: { age_days: number; grand_total: number }[]; overdueDays?: number }) {
  const n = overdueDays ?? 30;
  const buckets = overdueDays === undefined ? [
    { label: "0–30 days", min: 0, max: 30, color: "text-emerald-700 bg-emerald-50 border-emerald-200" },
    { label: "31–60 days", min: 31, max: 60, color: "text-amber-800 bg-amber-50 border-amber-200" },
    { label: "60+ days", min: 61, max: Infinity, color: "text-red-700 bg-red-50 border-red-200" },
  ] : [
    { label: `Not yet due (0–${n} days)`, min: 0, max: n, color: "text-emerald-700 bg-emerald-50 border-emerald-200" },
    { label: `Overdue ${n + 1}–${2 * n} days`, min: n + 1, max: 2 * n, color: "text-amber-800 bg-amber-50 border-amber-200" },
    { label: `Overdue ${2 * n}+ days`, min: 2 * n + 1, max: Infinity, color: "text-red-700 bg-red-50 border-red-200" },
  ];
  return (
    <div className="grid grid-cols-3 gap-2">
      {buckets.map(b => {
        const total = items.filter(i => i.age_days >= b.min && i.age_days <= b.max).reduce((s, i) => s + i.grand_total, 0);
        return (
          <div key={b.label} className={`rounded-lg border p-3 text-center ${b.color}`}>
            <div className="text-lg font-bold font-mono">{formatINR(total)}</div>
            <div className="text-xs font-semibold">{b.label}</div>
          </div>
        );
      })}
    </div>
  );
}

type AppPage = "overview" | "orders" | "money" | "stock" | "gst" | "catalog" | "contacts" | "settings";

export function AppShell() {
  const [page, setPage] = useState<AppPage>("overview");
  const [subTab, setSubTab] = useState("sales");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [showSetup, setShowSetup] = useState(false);

  // Data
  const [orders, setOrders] = useState<Order[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [counts, setCounts] = useState<{ state: string; count: number }[]>([]);
  const [biz, setBiz] = useState<BizProfile | null>(null);
  const [cfStats, setCfStats] = useState<CashFlowStats | null>(null);
  const [cfEligible, setCfEligible] = useState<Invoice[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [materials, setMaterials] = useState<RawMaterial[]>([]);
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);
  const [poCounts, setPoCounts] = useState<{ state: string; count: number }[]>([]);
  const [invSummary, setInvSummary] = useState<any>(null);
  const [invLedger, setInvLedger] = useState<InventoryEntry[]>([]);
  const [overview, setOverview] = useState<any>(null);
  const [ovx, setOvx] = useState<{ sales?: any; pending?: any; gst?: { label: string; amount: number; due: string } | null }>({});
  const [salesPeriod, setSalesPeriod] = useState<"week" | "month" | "year">("month");
  const [ordersKey, setOrdersKey] = useState(0);
  const [theme, setTheme] = useState<"auto" | "light" | "dark">("auto");
  const searchRef = useRef<HTMLInputElement>(null);
  const [aging, setAging] = useState<{ receivablesAging: any[]; payablesAging: any[] }>({ receivablesAging: [], payablesAging: [] });

  const [filterState, setFilterState] = useState("all");
  const [searchQ, setSearchQ] = useState("");
  const [showParse, setShowParse] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [invoiceOrder, setInvoiceOrder] = useState<Order | null>(null);
  const [showAddProduct, setShowAddProduct] = useState(false);
  const [pf, setPf] = useState({ name: "", name_hi: "", sku: "", unit: "piece", price: "", hsn_code: "", gst_rate: "18", opening_stock: "" });
  const [bizForm, setBizForm] = useState<any>(null);
  const { data: session } = useSession();
  const firstName = (session?.user?.name || "").trim().split(/\s+/)[0];
  // Who I am in the current business (roles are per business).
  const [me, setMe] = useState<{ join_requests?: number; user: { id: string; name: string; email: string; phone: string; phone_pending: string; email_verified: boolean }; whatsapp_number: string; businesses: MeBusiness[]; current: MeBusiness | null; role: string | null } | null>(null);
  const loadMe = useCallback(() => { fetch("/api/me").then((r) => (r.ok ? r.json() : null)).then((d) => d && setMe(d)).catch(() => {}); }, []);
  useEffect(() => { loadMe(); }, [loadMe]);
  const [verifyMsg, setVerifyMsg] = useState<string | null>(null);
  const userRole = (me?.role || "staff") as "owner" | "manager" | "staff";
  const canMoney = userRole === "owner" || userRole === "manager";
  const settings = resolveBusiness(biz);
  const caps = settings.caps;
  const hasMaterials = caps.production || caps.purchases;
  const statusStyles: StatusStyles = effectiveStatusStyles(settings.words, parseStatusStyles(biz?.status_styles));
  const overdueDays = clampOverdueDays(biz?.overdue_days ?? DEFAULT_OVERDUE_DAYS);

  // Fetchers
  const fetchOrders = useCallback(async () => { const d = await (await fetch(`/api/orders?state=all`)).json(); setOrders(d.orders || []); setCounts(d.counts || []); }, []);
  const fetchProducts = useCallback(async () => { setProducts((await (await fetch("/api/products")).json()).products || []); }, []);
  const fetchCustomers = useCallback(async () => { setCustomers((await (await fetch("/api/customers")).json()).customers || []); }, []);
  const [billsExist, setBillsExist] = useState(false);
  const fetchBiz = useCallback(async () => { const r = await fetch("/api/business"); if (!r.ok) return; const d = await r.json(); setBiz(d.profile); setBizForm(d.profile); setBillsExist(!!d.invoicesExist); if (!d.profile?.capabilities) setShowSetup(true); /* new business: run setup once */ }, []);
  const fetchCashFlow = useCallback(async () => { const d = await (await fetch("/api/cashflow")).json(); setCfStats(d.stats); }, []);
  const fetchSuppliers = useCallback(async () => { setSuppliers((await (await fetch("/api/suppliers")).json()).suppliers || []); }, []);
  const fetchMaterials = useCallback(async () => { setMaterials((await (await fetch("/api/materials")).json()).materials || []); }, []);
  const fetchPurchases = useCallback(async () => { const d = await (await fetch("/api/purchases")).json(); setPurchaseOrders(d.orders || []); setPoCounts(d.counts || []); }, []);
  const fetchInventory = useCallback(async () => { setInvSummary(await (await fetch("/api/inventory")).json()); setInvLedger((await (await fetch("/api/inventory?type=ledger")).json()).entries || []); }, []);
  const fetchOverview = useCallback(async () => { const d = await (await fetch("/api/overview")).json(); setOverview(d.stats); setOvx({ sales: d.sales, pending: d.pending, gst: d.gst }); setAging({ receivablesAging: d.receivablesAging || [], payablesAging: d.payablesAging || [] }); }, []);

  useEffect(() => { fetchBiz(); }, [fetchBiz]);
  useEffect(() => { fetchOverview(); fetchOrders(); }, [fetchOverview, fetchOrders]);
  useEffect(() => {
    if (page === "orders") { fetchOrders(); fetchPurchases(); }
    if (page === "money") { fetchCashFlow(); fetchOrders(); }
    if (page === "catalog") { fetchProducts(); fetchMaterials(); }
    if (page === "contacts") { fetchCustomers(); fetchSuppliers(); }
    if (page === "overview") { fetchOverview(); fetchInventory(); }
  }, [page, fetchOrders, fetchPurchases, fetchCashFlow, fetchProducts, fetchMaterials, fetchCustomers, fetchSuppliers, fetchOverview, fetchInventory]);

  const refreshAll = () => { fetchOrders(); fetchProducts(); fetchCustomers(); fetchCashFlow(); fetchSuppliers(); fetchPurchases(); fetchMaterials(); fetchInventory(); fetchOverview(); };

  const [pfErr, setPfErr] = useState<string | null>(null);
  const addProduct = async () => {
    setPfErr(null);
    try {
      const r = await fetch("/api/products", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: pf.name, name_hi: pf.name_hi, sku: pf.sku, unit: pf.unit, price: Number(pf.price), hsn_code: pf.hsn_code, gst_rate: Number(pf.gst_rate), track_stock: true, opening_stock: pf.opening_stock ? Number(pf.opening_stock) : undefined }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setPfErr(d.error || "Couldn't add the product."); return; }
      setPf({ name: "", name_hi: "", sku: "", unit: "piece", price: "", hsn_code: "", gst_rate: "18", opening_stock: "" }); setShowAddProduct(false); fetchProducts();
    } catch { setPfErr("Couldn't reach Munshiji. Try again."); }
  };
  const delProduct = async (id: string, name: string) => {
    if (!window.confirm(`Remove ${name} from the catalog? If it was used in orders it will be hidden, not deleted.`)) return;
    const r = await fetch(`/api/products?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    if (!r.ok) setPfErr((await r.json().catch(() => ({}))).error || "Couldn't remove the product."); else fetchProducts();
  };
  const [saveMsg, setSaveMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const saveBiz = async () => {
    if (!bizForm) return;
    const reg = bizForm.gst_registration || "regular";
    if (reg !== "none" && bizForm.gstin && !checkGstin(bizForm.gstin).valid) { setSaveMsg({ ok: false, text: "Fix the GSTIN before saving — " + (checkGstin(bizForm.gstin) as { error: string }).error.toLowerCase() }); return; }
    if (bizForm.upi_id && !isValidUpiId(bizForm.upi_id)) { setSaveMsg({ ok: false, text: "Fix the UPI ID before saving — it should look like name@bank" }); return; }
    const res = await fetch("/api/business", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(bizForm) }).catch(() => null);
    if (!res || !res.ok) { setSaveMsg({ ok: false, text: "Couldn't save. Check your connection and try again." }); return; }
    setSaveMsg({ ok: true, text: "Saved" });
    await fetchBiz(); fetchOverview(); fetchOrders();
  };
  const formStyles: StatusStyles = parseStatusStyles(bizForm?.status_styles);
  const setFormStyle = (key: string, patch: { label?: string; color?: StatusColor }) => {
    const next = { ...formStyles, [key]: { ...(formStyles as Record<string, object>)[key], ...patch } };
    setBizForm({ ...bizForm, status_styles: JSON.stringify(next) });
  };

  const fo = orders.filter(o => { if (!searchQ) return true; const q = searchQ.toLowerCase(); return o.id.toLowerCase().includes(q) || o.customer_name.toLowerCase().includes(q) || o.items.some(i => i.product_name.toLowerCase().includes(q)); });
  const totalVal = orders.reduce((s, o) => s + o.grand_total, 0);

  // Nav — 6 items, clean
  const nav: { key: AppPage; label: string; icon: React.ReactNode; alert?: boolean }[] = [
    { key: "overview", label: "Overview", icon: <IcGrid /> },
    { key: "orders", label: "Orders", icon: <IcPackage /> },
    ...(canMoney ? [{ key: "money" as AppPage, label: "Money", icon: <IcBanknote /> }] : []),
    { key: "stock", label: "Stock", icon: <IcBox /> },
    { key: "catalog", label: "Catalog", icon: <IcLayers /> },
    ...(canMoney && settings.registration !== "none" ? [{ key: "gst" as AppPage, label: "GST", icon: <IcFile /> }] : []),
    { key: "contacts", label: "Contacts", icon: <IcUsers /> },
    { key: "settings" as AppPage, label: "Settings", icon: <IcSettings /> },
  ];

  // Set sub-tab defaults when switching pages
  useEffect(() => {
    if (page === "orders") setSubTab("sales");
    if (page === "money") setSubTab("receivables");
    if (page === "catalog") setSubTab("products");
    if (page === "contacts") setSubTab("buyers");
  }, [page]);

  // Theme: follows the device unless the owner picks one; stored on this device only.
  useEffect(() => {
    let t: "auto" | "light" | "dark" = "auto";
    try { const v = localStorage.getItem("munshiji-theme"); if (v === "light" || v === "dark") t = v; } catch { /* storage unavailable */ }
    setTheme(t); document.documentElement.dataset.theme = t;
    return () => { delete document.documentElement.dataset.theme; };
  }, []);
  const toggleTheme = () => {
    const isDark = theme === "dark" || (theme === "auto" && window.matchMedia("(prefers-color-scheme: dark)").matches);
    const next = isDark ? "light" : "dark";
    setTheme(next); document.documentElement.dataset.theme = next;
    try { localStorage.setItem("munshiji-theme", next); } catch { /* storage unavailable */ }
  };
  // ⌘K / Ctrl+K focuses search
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); focusSearch(); } };
    window.addEventListener("keydown", h); return () => window.removeEventListener("keydown", h);
  }, []);
  const focusSearch = () => { if (page !== "orders" || subTab !== "sales") { setSubTab("sales"); openOrders(); } setTimeout(() => searchRef.current?.focus(), 80); };
  const openOrders = (status = "all") => { setFilterState(status); setOrdersKey((k) => k + 1); setPage("orders"); setSidebarOpen(false); };
  const remind = (o: Order) => window.open(whatsappLink(o.customer_phone, reminderText(o, biz?.company_name || "", biz?.upi_id || "", Math.max(0, (o.bill_age_days ?? 0) - overdueDays))), "_blank");
  const confirmOrder = async (id: string) => {
    const ns = nextStateIn(settings.flow, "new"); if (!ns) return;
    await fetch("/api/orders", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, state: ns }) });
    refreshAll();
  };

  const pending = ovx.pending as null | { id: string; grand_total: number; subtotal: number; gst: number; raw_message: string; customer_name: string; customer_gstin: string; item_count: number; previous_orders: number; pending: number };
  const sales = ovx.sales?.[salesPeriod] as undefined | { points: { label: string; value: number }[]; current: number; change: number | null };
  const recv = overview?.receivables || 0;
  const agingSum = (min: number, max: number) => aging.receivablesAging.filter((a: any) => a.age_days >= min && a.age_days <= max).reduce((t: number, a: any) => t + a.grand_total, 0);
  const notDue = agingSum(0, overdueDays), mid = agingSum(overdueDays + 1, overdueDays * 2), old = agingSum(overdueDays * 2 + 1, Infinity);
  const oldestLate = Math.max(0, ...aging.receivablesAging.map((a: any) => a.age_days - overdueDays));
  const navBadge = (k: AppPage) => k === "orders" && pending?.pending ? { t: String(pending.pending), red: false }
    : k === "money" && caps.credit && overview?.overdueOrders ? { t: `${overview.overdueOrders} late`, red: true }
    : k === "gst" && ovx.gst ? { t: `Due ${new Date(ovx.gst.due).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}`, red: false } : null;
  const tiles = [
    overview && { k: "active", label: "Active orders", value: overview.activeOrders, foot: pending?.pending ? <><Pill tone="good">{pending.pending} new</Pill>to confirm</> : "In progress", onClick: () => openOrders() },
    overview && { k: "prep", label: settings.words.preparing, value: overview.preparing, foot: caps.delivery ? "Next step: dispatch" : "Next step: hand over", onClick: () => openOrders("preparing") },
    overview && caps.credit && canMoney && { k: "late", label: "Overdue bills", value: overview.overdueOrders, tone: overview.overdueOrders ? "bad" : undefined, foot: overview.overdueOrders ? <><Pill tone="bad">{oldestLate} days</Pill>oldest</> : `Terms: ${overdueDays} days`, onClick: () => openOrders("overdue") },
    ovx.gst && { k: "gst", label: ovx.gst.label, value: <CountUp value={ovx.gst.amount} />, foot: <><Pill>Estimate</Pill>Due {new Date(ovx.gst.due).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</>, onClick: () => setPage("gst") },
    overview && hasMaterials && { k: "stock", label: "Low stock", value: overview.lowStockCount, foot: "Raw materials", onClick: () => setPage("catalog") },
    overview && caps.purchases && { k: "po", label: "Pending purchases", value: overview.pendingPOs, foot: "From suppliers", onClick: () => { setPage("orders"); setSubTab("purchase"); } },
  ].filter(Boolean).slice(0, 4) as { k: string; label: string; value: React.ReactNode; foot: React.ReactNode; tone?: "bad"; onClick: () => void }[];
  const pageTitle = "text-2xl sm:text-[28px] font-bold tracking-tight text-stone-800";

  if (me && me.businesses.length === 0) return <NoBusiness name={me.user.name} />; // removed from every team, or never had one
  return (
    <StatusContext.Provider value={{ role: userRole, styles: statusStyles, overdueDays, biz: settings, sellerState: sellerStateCode(biz), upiId: biz?.upi_id || "", companyName: biz?.company_name || "" }}>
    <div className="h-screen h-dvh bg-stone-100 flex flex-col overflow-hidden">
      {/* Phone top bar */}
      <header className="md:hidden flex items-center gap-2.5 px-3.5 pt-[calc(10px+env(safe-area-inset-top,0px))] pb-2.5 bg-stone-100 border-b border-stone-200">
        <LogoTile size={32} />
        <span className="flex-1 min-w-0 font-bold text-base text-stone-800 truncate">{biz?.company_name || "Munshiji"}</span>
        <button type="button" onClick={focusSearch} aria-label="Search orders" className="w-10 h-10 grid place-items-center rounded-xl border border-stone-200 bg-white text-stone-600"><IcSearch className="w-5 h-5" /></button>
        <button type="button" onClick={toggleTheme} aria-label="Switch light or dark theme" className="w-10 h-10 grid place-items-center rounded-xl border border-stone-200 bg-white text-stone-600"><IcContrast className="w-5 h-5" /></button>
      </header>

      <div className="flex flex-1 min-h-0 overflow-hidden relative">
        {sidebarOpen && <div className="md:hidden fixed inset-0 bg-black/30 z-[45]" onClick={() => setSidebarOpen(false)} />}

        {/* Sidebar (a slide-in "More" menu on phones) */}
        <aside className={`w-64 border-r border-stone-200 bg-stone-100 overflow-y-auto shrink-0 stone-scrollbar flex flex-col fixed md:relative top-0 left-0 h-full z-50 md:z-auto transition-transform md:transition-none md:translate-x-0 ${sidebarOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"}`}>
          <div className="p-4 flex flex-col gap-3">
            <BusinessSwitcher businesses={me?.businesses || []} current={me?.current || null} label={biz?.company_name || me?.current?.name || "Munshiji"} />
            <button type="button" onClick={focusSearch} className="relative w-full h-10 pl-9 pr-12 rounded-xl border border-stone-200 bg-white text-sm text-left text-stone-400 hover:border-stone-300">
              <IcSearch className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400" />Search orders
              <kbd className="hidden md:inline absolute right-2.5 top-1/2 -translate-y-1/2 text-xs font-medium text-stone-500 border border-stone-200 bg-stone-50 rounded-md px-1.5">⌘K</kbd>
            </button>
          </div>
          <nav className="px-3 flex-1 space-y-0.5" aria-label="Sections">
            {nav.map(n => {
              const b = navBadge(n.key);
              return <button key={n.key} onClick={() => { if (n.key === "orders") openOrders(); else setPage(n.key); setSidebarOpen(false); }} aria-current={page === n.key ? "page" : undefined}
                className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm text-left transition-colors ${page === n.key ? "bg-white text-stone-800 font-semibold shadow-card" : "text-stone-600 font-medium hover:bg-white/70"}`}>
                <span className={`w-[18px] h-[18px] shrink-0 ${page === n.key ? "text-emerald-600" : ""}`}>{n.icon}</span><span className="flex-1">{n.label}</span>
                {b && <span className={`text-xs font-semibold px-2 rounded-full leading-[20px] ${b.red ? "bg-red-50 text-red-700" : "bg-white border border-stone-200 text-stone-600"}`}>{b.t}</span>}
              </button>;
            })}
          </nav>
          <div className="p-4 flex flex-col gap-3">
            <button onClick={() => { setShowParse(true); setSidebarOpen(false); }} className="w-full inline-flex items-center justify-center gap-2 font-semibold text-sm h-11 rounded-xl bg-emerald-600 text-white hover:bg-emerald-700 transition-colors"><IcWhatsApp /> New order from WhatsApp</button>
            {biz?.udyam_number && <div className="flex items-center gap-1.5 text-xs text-stone-500"><IcShield className="w-3.5 h-3.5 text-emerald-600" />MSME {biz.udyam_number}</div>}
            <div className="flex items-center gap-2.5 pt-3 border-t border-stone-200">
              <Avatar name={session?.user?.name || "You"} />
              <span className="min-w-0 flex-1" title={session?.user?.email || undefined}><span className="block text-sm font-semibold text-stone-800 leading-tight line-clamp-2">{session?.user?.name || "You"}</span></span>
              <button type="button" onClick={toggleTheme} aria-label="Switch light or dark theme" title="Light or dark" className="hidden md:grid w-9 h-9 place-items-center rounded-[10px] text-stone-500 hover:bg-white"><IcContrast className="w-[18px] h-[18px]" /></button>
              <button type="button" onClick={() => signOut({ callbackUrl: "/login" })} aria-label="Sign out" title="Sign out" className="w-9 h-9 grid place-items-center rounded-[10px] text-stone-500 hover:bg-white"><IcLogOut className="w-[18px] h-[18px]" /></button>
            </div>
            <div className="flex gap-3 text-xs text-stone-500"><a href="/support" className="hover:underline">Help</a><a href="/terms" className="hover:underline">Terms</a><a href="/privacy" className="hover:underline">Privacy</a></div>
          </div>
        </aside>

        {/* Main */}
        <main className="flex-1 overflow-y-auto stone-scrollbar">
          <div className="px-3.5 pt-4 pb-28 sm:px-6 sm:pt-6 md:pb-10 w-full max-w-6xl mx-auto">
            {me && (me.join_requests || 0) > 0 && userRole === "owner" && page !== "settings" && <div role="status" className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 flex flex-wrap items-center justify-between gap-2">
              <span><b>{me.join_requests === 1 ? "1 person wants" : `${me.join_requests} people want`} to join your team.</b> Let them in and choose their role.</span>
              <button onClick={() => setPage("settings")} className="h-9 px-3 rounded-[10px] bg-amber-600 text-white text-[13px] font-semibold">Review</button>
            </div>}
            {me && !me.user.email_verified && (page === "overview" || page === "settings") && <div role="status" className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 flex flex-wrap items-center gap-x-3 gap-y-1">
              <span>Confirm your email: we sent a link to <b>{me.user.email}</b>. It lets you reset your password if you ever forget it.</span>
              <button onClick={async () => { const r = await fetch("/api/auth/verify/resend", { method: "POST" }).catch(() => null); setVerifyMsg(r?.ok ? "Sent. Check your inbox." : "Couldn't send right now. Try again later."); }} className="font-semibold underline">Send again</button>
              {verifyMsg && <span className="text-amber-800">{verifyMsg}</span>}
            </div>}

            {/* ═══ OVERVIEW ═══ */}
            {page === "overview" && overview && <>
              <div className="flex flex-wrap items-end justify-between gap-3 mb-5">
                <div><h1 className={pageTitle}>{firstName ? `Namaste, ${firstName} ji` : "Namaste"}</h1><p className="text-sm text-stone-600 mt-1">Here&apos;s how your business is doing.</p></div>
                <button onClick={() => setShowParse(true)} className="hidden md:inline-flex items-center gap-2 h-10 px-4 rounded-[10px] bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700"><IcPlus className="w-4 h-4" /> New order</button>
              </div>

              <InboxPanel onApproved={refreshAll} />
              <div className="grid grid-cols-12 gap-3 sm:gap-4">
                {/* Munshiji card — real: the newest order waiting for confirmation, or how to start one */}
                <section aria-labelledby="mj-l" className={`order-1 col-span-12 ${canMoney ? "lg:col-span-4" : ""} relative overflow-hidden rounded-[20px] border border-emerald-200 shadow-card p-5 sm:p-6 bg-gradient-to-b from-emerald-50 via-white to-white flex flex-col`}>
                  <Mascot pose={pending ? "thumbs-up" : "chai"} height={80} className="absolute right-3 top-3" decorative />
                  <div id="mj-l" className="text-[13px] font-semibold text-emerald-700 pr-20">{pending ? (pending.pending > 1 ? `${pending.pending} new orders to confirm` : "Munshiji is on it") : "All caught up"}</div>
                  {pending ? <>
                    <h2 className="text-lg font-semibold text-stone-800 leading-snug mt-1 mb-4 pr-20">New order from {pending.customer_name}</h2>
                    {pending.raw_message && <div className="text-[13px] text-stone-600 bg-white border border-stone-200 rounded-xl px-3 py-2 mb-3"><p className="line-clamp-3"><span className="font-semibold text-stone-800">WhatsApp: </span>{pending.raw_message}</p></div>}
                    <ol className="space-y-2.5 mb-4">
                      {[
                        pending.raw_message ? ["Read the message", `${pending.item_count} ${pending.item_count === 1 ? "item" : "items"} found`] : ["Order entered", `${pending.item_count} ${pending.item_count === 1 ? "item" : "items"}`],
                        [pending.previous_orders ? "Matched the buyer" : "Added a new buyer", `${pending.previous_orders ? `${pending.previous_orders} earlier ${pending.previous_orders === 1 ? "order" : "orders"}` : "First order"}${pending.customer_gstin ? (checkGstin(pending.customer_gstin).valid ? " · GSTIN valid" : " · GSTIN needs checking") : ""}`],
                        ["Priced from your catalog", pending.gst ? `${formatINR(pending.subtotal)} + GST ${formatINR(pending.gst)}` : `${formatINR(pending.subtotal)} · no GST`],
                        ["Ready to confirm", `Total ${formatINR(pending.grand_total)}`],
                      ].map(([t, sub], k) => (
                        <li key={t} className="flex gap-2.5 stone-fade-in" style={{ animationDelay: `${k * 120}ms` }}>
                          <span className="mt-0.5 w-[18px] h-[18px] rounded-full bg-emerald-500 grid place-items-center shrink-0"><IcCheck className="w-3 h-3 text-white" /></span>
                          <span className="text-sm text-stone-800">{t}<span className="block text-[13px] text-stone-500">{sub}</span></span>
                        </li>
                      ))}
                    </ol>
                    <div className="mt-auto flex gap-2">
                      <button onClick={() => confirmOrder(pending.id)} className="flex-1 h-11 rounded-xl bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700">Confirm order</button>
                      <button onClick={() => { const o = orders.find(x => x.id === pending.id); if (o) setSelectedOrder(o); }} className="h-11 px-4 rounded-xl border border-stone-300 bg-white text-sm font-semibold text-stone-700 hover:bg-stone-50">Review</button>
                    </div>
                  </> : <>
                    <h2 className="text-lg font-semibold text-stone-800 leading-snug mt-1 mb-2 pr-20">No orders waiting. Got a new one on WhatsApp?</h2>
                    <p className="text-sm text-stone-600 mb-4 pr-4">Paste the message. Munshiji reads it in Hindi, Hinglish or English, matches the buyer and prices it from your catalog.</p>
                    <button onClick={() => setShowParse(true)} className="mt-auto h-11 rounded-xl bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 inline-flex items-center justify-center gap-2"><IcWhatsApp /> Paste a WhatsApp order</button>
                  </>}
                </section>

                {/* Sales */}
                {canMoney && <Card aria-labelledby="sales-l" className={`order-4 lg:order-2 col-span-12 ${caps.credit ? "md:col-span-6 lg:col-span-4" : "lg:col-span-8"} flex flex-col`}>
                  <div className="flex items-center justify-between gap-2">
                    <h2 id="sales-l" className="text-sm font-medium text-stone-600">Sales</h2>
                    <Segmented label="Sales period" value={salesPeriod} onChange={setSalesPeriod} options={[{ key: "week", label: "Week" }, { key: "month", label: "Month" }, { key: "year", label: "Year" }]} />
                  </div>
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-1">
                    <span className="figure-num text-[28px] sm:text-[32px] font-bold text-stone-800 leading-tight"><CountUp value={sales?.current || 0} /></span>
                    <Delta value={sales?.change ?? null} />
                  </div>
                  <p className="text-[13px] text-stone-500">{salesPeriod === "week" ? "Today" : salesPeriod === "month" ? "This month" : "This financial year"}{sales?.change == null ? "" : salesPeriod === "week" ? " vs yesterday" : salesPeriod === "month" ? " vs last month" : " vs last year"}</p>
                  {sales && <BarChart points={sales.points} height={150} />}
                </Card>}

                {/* Money to collect */}
                {caps.credit && canMoney && <Card aria-labelledby="col-l" className="order-3 lg:order-3 col-span-12 md:col-span-6 lg:col-span-4 flex flex-col">
                  <div className="flex items-start justify-between gap-2">
                    <div><h2 id="col-l" className="text-sm font-medium text-stone-600">Money to collect</h2><div className="figure-num text-[28px] sm:text-[32px] font-bold text-stone-800 leading-tight mt-1"><CountUp value={recv} /></div></div>
                    <button onClick={() => setPage("money")} className="h-9 px-3 rounded-[10px] border border-stone-300 bg-white text-[13px] font-semibold text-stone-700 hover:bg-stone-50">See all</button>
                  </div>
                  <div className="flex-1 flex items-center justify-center py-2"><Gauge overdueShare={recv ? ((mid + old) / recv) * 100 : 0} label="is overdue" /></div>
                  <div className="grid grid-cols-3 gap-2">
                    {[["Not due", notDue, "bg-emerald-500"], [`${overdueDays + 1}–${overdueDays * 2} days`, mid, "bg-amber-500"], [`${overdueDays * 2}+ days`, old, "bg-red-500"]].map(([l, v, dot]) => (
                      <div key={l as string} className="rounded-xl border border-stone-200 bg-stone-50 px-3 py-2 min-w-0">
                        <div className="flex items-center gap-1.5 text-xs text-stone-500 whitespace-nowrap"><span className={`w-2 h-2 rounded-full shrink-0 ${dot}`} />{l}</div>
                        <div className="text-sm font-bold text-stone-800 truncate">{formatINR(v as number)}</div>
                      </div>
                    ))}
                  </div>
                </Card>}

                {/* Today's numbers */}
                {tiles.map(t => <div key={t.k} className="order-2 lg:order-4 col-span-6 lg:col-span-3"><StatTile label={t.label} value={t.value} foot={t.foot} tone={t.tone} onClick={t.onClick} /></div>)}

                {hasMaterials && invSummary?.lowStock?.length > 0 && <div className="order-5 col-span-12 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 flex flex-wrap items-center gap-2"><IcAlertTriangle className="w-4 h-4 text-amber-700" /><span className="text-sm font-semibold text-amber-800 mr-1">Low stock</span>{invSummary.lowStock.map((m: any) => <span key={m.id} className="text-xs px-2.5 py-0.5 rounded-full bg-white border border-amber-200 text-amber-800 font-medium">{m.name}: {m.current_stock} {m.unit}</span>)}</div>}

                <div className="order-6 col-span-12">
                  <OrdersTable title="Recent orders" orders={orders.slice(0, 5)} onOpen={setSelectedOrder} onRemind={remind} showFilters={false}
                    action={<button onClick={() => openOrders()} className="h-9 px-3 rounded-[10px] border border-stone-300 bg-white text-[13px] font-semibold text-stone-700 hover:bg-stone-50">View all</button>} />
                </div>
              </div>
            </>}

            {/* ═══ ORDERS (Sales + Purchase tabs) ═══ */}
            {page === "orders" && <>
              <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
                <h1 className={pageTitle}>Orders</h1>
                <button onClick={() => setShowParse(true)} className="hidden md:inline-flex items-center gap-2 h-10 px-4 rounded-[10px] bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700"><IcPlus className="w-4 h-4" /> New order</button>
              </div>
              <InboxPanel onApproved={refreshAll} />
              {caps.purchases && <Tabs tabs={[{ key: "sales", label: "Sales", count: orders.length }, { key: "purchase", label: "Purchases", count: purchaseOrders.length }]} active={subTab} onChange={setSubTab} />}

              {subTab === "sales" && <OrdersTable title={caps.purchases ? "Sales orders" : "All orders"} key={ordersKey} initialStatus={filterState === "all" ? "" : filterState} searchRef={searchRef} orders={orders} onOpen={setSelectedOrder} onRemind={remind} />}

              {caps.purchases && subTab === "purchase" && <>
                <div className="space-y-2">{purchaseOrders.map(po => <div key={po.id} className="rounded-2xl border border-stone-200 bg-white shadow-card p-4 hover:shadow-sm transition-all">
                  <div className="flex items-center justify-between mb-2"><div className="flex items-center gap-2 flex-wrap"><span className="text-sm font-bold font-mono text-stone-800">{po.id}</span><POBadge state={po.state} size="xs" />{po.bill_number && <span className="text-xs px-2 py-0.5 rounded-full border bg-stone-100 text-stone-500 border-stone-200 font-mono">Bill: {po.bill_number}</span>}</div><span className="text-base font-bold font-mono text-stone-800">{formatINR(po.grand_total)}</span></div>
                  <div className="text-sm text-stone-600">{po.supplier_name}</div>
                  <div className="text-xs text-stone-400 mt-1">{po.items.map(i => `${i.qty} ${i.unit} ${i.material_name}`).join(", ")}</div>
                  <div className="flex items-center justify-between mt-3"><div className="text-xs text-stone-400 font-mono">{po.created_at?.split(" ")[0]}</div>
                    {po.state === "ordered" && <button onClick={async () => { await fetch("/api/purchases", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: po.id, state: "received" }) }); fetchPurchases(); fetchInventory(); fetchOverview(); }} className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-emerald-600 text-white font-semibold hover:bg-emerald-700"><IcCheck className="w-3 h-3" /> Received</button>}
                  </div>
                </div>)}</div>
              </>}
            </>}

            {/* ═══ MONEY (Receivables + Payables + GSTR-1) ═══ */}
            {page === "money" && <>
              <h1 className="text-2xl sm:text-[28px] font-bold tracking-tight text-stone-800 mb-3">Money</h1>
              {caps.purchases && <Tabs tabs={[{ key: "receivables", label: "Receivables" }, { key: "payables", label: "Payables" }]} active={subTab} onChange={setSubTab} />}

              {subTab === "receivables" && <>
                {cfStats && cfStats.receivables === 0 && <div className="rounded-[20px] border border-emerald-200 bg-emerald-50 p-5 mb-5 flex items-center gap-4"><Mascot pose="folded-hands" height={88} decorative /><div><p className="text-base font-semibold text-emerald-800">Every bill is paid. Dhanyavaad!</p><p className="text-sm text-stone-600 mt-0.5">Nothing to collect right now. New bills will show up here.</p></div></div>}
                
                {/* Aging */}
                {caps.credit && aging.receivablesAging.length > 0 && <div className="mb-5"><div className="text-xs font-mono text-stone-500 mb-2">Aging</div><AgingBuckets items={aging.receivablesAging} overdueDays={overdueDays} /></div>}

                {/* Invoices */}
                <div className="space-y-2">{orders.filter(o => ["delivered", "invoiced", "overdue", "paid"].includes(o.state)).map(o => { const bal = Math.max(0, Math.round((o.grand_total - (o.amount_paid || 0) - ((o as { amount_credited?: number }).amount_credited || 0)) * 100) / 100); /* credit notes reduce what is owed */ const part = (o.amount_paid || 0) > 0 && bal > 0; return <div key={o.id} className="rounded-2xl border border-stone-200 bg-white shadow-card p-4 flex items-center justify-between gap-3"><button onClick={() => setSelectedOrder(o)} className="flex-1 min-w-0 text-left"><div className="flex items-center gap-2 flex-wrap"><span className="text-sm font-bold font-mono text-stone-800">{o.invoice_number || o.id}</span><StateBadge state={o.display_state || o.state} size="xs" />{part && <span className="text-xs font-semibold text-amber-800 bg-amber-50 border border-amber-200 rounded-full px-2">Part paid</span>}</div><div className="text-sm text-stone-600 mt-0.5">{o.customer_name}{o.state === "delivered" ? " · bill not made yet" : ""}</div></button><div className="flex items-center gap-3 shrink-0 text-right"><div><div className="text-base font-bold font-mono text-stone-800">{formatINR(["invoiced", "overdue"].includes(o.state) ? bal : o.grand_total)}</div>{part && <div className="text-xs text-stone-500">of {formatINR(o.grand_total)}</div>}</div>{o.invoice_number && <button onClick={() => setInvoiceOrder(o)} className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-stone-200 text-stone-600 hover:bg-stone-50 font-medium"><IcFile className="w-3.5 h-3.5" /> Bill</button>}</div></div>; })}</div>
              </>}

              {caps.purchases && subTab === "payables" && <>
                {aging.payablesAging.length > 0 && <div className="mb-5"><div className="text-xs font-mono text-stone-400 mb-2">Payables aging</div><AgingBuckets items={aging.payablesAging} /></div>}
                <div className="space-y-2">{purchaseOrders.filter(po => ["ordered", "partial"].includes(po.state)).map(po => <div key={po.id} className="rounded-2xl border border-stone-200 bg-white shadow-card p-4 flex items-center justify-between gap-3"><div className="flex-1 min-w-0"><div className="flex items-center gap-2 flex-wrap"><span className="text-sm font-bold font-mono text-stone-800">{po.id}</span><POBadge state={po.state} size="xs" /></div><div className="text-sm text-stone-600 mt-0.5">{po.supplier_name}</div></div><span className="text-base font-bold font-mono text-stone-800 shrink-0">{formatINR(po.grand_total)}</span></div>)}{purchaseOrders.filter(po => ["ordered", "partial"].includes(po.state)).length === 0 && <div className="text-center py-8 text-stone-400 text-sm">No pending payables</div>}</div>
              </>}

                          </>}

            {/* ═══ STOCK ═══ */}
            {page === "stock" && <StockPage />}

            {/* ═══ GST (returns prepared, not filed) ═══ */}
            {page === "gst" && <GstPage />}

            {/* ═══ CATALOG (Products + Materials + Inventory) ═══ */}
            {page === "catalog" && <>
              <h1 className="text-2xl sm:text-[28px] font-bold tracking-tight text-stone-800 mb-3">Catalog</h1>
              {hasMaterials && <Tabs tabs={[{ key: "products", label: "Products", count: products.length }, { key: "materials", label: "Raw Materials", count: materials.length }, { key: "stock", label: "Stock Levels" }]} active={subTab} onChange={setSubTab} />}

              {subTab === "products" && <>
                {pfErr && <p role="alert" className="text-sm text-red-700 mb-3">{pfErr}</p>}
                {canMoney && <div className="flex justify-end mb-4"><button onClick={() => setShowAddProduct(!showAddProduct)} className="inline-flex items-center justify-center gap-2 font-semibold text-sm px-5 py-2.5 rounded-xl bg-emerald-600 text-white hover:bg-emerald-700"><IcPlus /> Add</button></div>}
                {showAddProduct && canMoney && <div className="rounded-2xl border border-stone-200 bg-white shadow-card p-5 mb-5 stone-fade-in"><div className="grid grid-cols-1 sm:grid-cols-2 gap-3">{[{ l: "Name *", k: "name", p: "5-Ply Corrugated Box" }, { l: "Hindi", k: "name_hi", p: "5-प्लाई बॉक्स" }, { l: "SKU", k: "sku", p: "CB-5P-M" }, { l: "Price ₹ *", k: "price", p: "52", t: "number" }, { l: "HSN Code", k: "hsn_code", p: "4819" }, { l: "Opening stock", k: "opening_stock", p: "0", t: "number" }].map(f => <div key={f.k}><label className="block text-xs font-medium text-stone-600 mb-1.5">{f.l}</label><input value={(pf as any)[f.k]} onChange={e => setPf({ ...pf, [f.k]: e.target.value })} placeholder={f.p} type={f.t || "text"} className="w-full px-4 py-2.5 text-sm rounded-xl border border-stone-200 text-stone-700 placeholder-stone-400 focus:outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-200 font-mono" /></div>)}<div><label className="block text-xs font-medium text-stone-600 mb-1.5">Unit</label><select value={pf.unit} onChange={e => setPf({ ...pf, unit: e.target.value })} className="w-full px-4 py-2.5 text-sm rounded-xl border border-stone-200 text-stone-700 bg-white focus:outline-none font-mono appearance-none">{UNITS.map(u => <option key={u} value={u}>{u}</option>)}</select></div><div><label className="block text-xs font-medium text-stone-600 mb-1.5">GST Rate</label><select value={pf.gst_rate} onChange={e => setPf({ ...pf, gst_rate: e.target.value })} className="w-full px-4 py-2.5 text-sm rounded-xl border border-stone-200 text-stone-700 bg-white focus:outline-none font-mono appearance-none">{GST_RATES.map(r => <option key={r} value={r}>{r}%</option>)}</select></div></div><div className="flex justify-end gap-3 mt-4"><button onClick={() => setShowAddProduct(false)} className="text-sm px-5 py-2 rounded-xl border border-stone-200 text-stone-600 font-semibold">Cancel</button><button onClick={addProduct} className="text-sm px-5 py-2 rounded-xl bg-emerald-600 text-white hover:bg-emerald-700 font-semibold">Save</button></div></div>}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">{products.map(p => <div key={p.id} className="rounded-2xl border border-stone-200 bg-white shadow-card p-4 hover:shadow-sm transition-all"><div className="flex justify-between items-start"><div><div className="text-sm font-semibold text-stone-800">{p.name}</div>{p.name_hi && <div className="text-xs text-stone-400">{p.name_hi}</div>}</div>{canMoney && <button onClick={() => delProduct(p.id, p.name)} aria-label={`Remove ${p.name}`} className="text-stone-400 hover:text-red-500 p-1"><IcTrash /></button>}</div><div className="flex justify-between mt-3 items-end"><div className="flex flex-wrap gap-1">{p.hsn_code && <span className="text-xs px-1.5 py-0 rounded-full border bg-blue-50 text-blue-600 border-blue-200 font-mono font-semibold">HSN {p.hsn_code}</span>}<span className="text-xs px-1.5 py-0 rounded-full border bg-amber-50 text-amber-700 border-amber-200 font-mono font-semibold">{p.gst_rate}%</span>{isRetiredRate(p.gst_rate) && <span className="text-xs px-1.5 py-0 rounded-full border bg-red-50 text-red-700 border-red-200 font-semibold" title="12% and 28% GST slabs were abolished on 22 Sep 2025">Check GST rate</span>}</div><div className="text-right"><div className="text-lg font-bold font-mono text-stone-800">{formatINR(p.price)}</div><div className="text-xs text-stone-400">per {p.unit}</div></div></div></div>)}</div>
              </>}

              {hasMaterials && subTab === "materials" && <div className="space-y-2">{materials.map(m => <div key={m.id} className="rounded-2xl border border-stone-200 bg-white shadow-card p-4 flex items-center justify-between"><div><div className="text-sm font-semibold text-stone-800">{m.name}</div><div className="flex gap-2 mt-1">{m.hsn_code && <span className="text-xs px-1.5 rounded-full border bg-blue-50 text-blue-600 border-blue-200 font-mono font-semibold">HSN {m.hsn_code}</span>}<span className="text-xs px-1.5 rounded-full border bg-stone-100 text-stone-500 border-stone-200 font-mono">{m.sku}</span></div></div><div className="text-right"><div className={`text-lg font-bold font-mono ${m.reorder_level > 0 && m.current_stock <= m.reorder_level ? "text-amber-600" : "text-stone-800"}`}>{m.current_stock.toLocaleString("en-IN")} {m.unit}</div>{m.last_purchase_price > 0 && <div className="text-xs text-stone-400 font-mono">@ {formatINR(m.last_purchase_price)}/{m.unit}</div>}</div></div>)}</div>}

              {hasMaterials && subTab === "stock" && invSummary && <>
                {invSummary.lowStock?.length > 0 && <div className="rounded-lg border border-amber-200 bg-amber-50/50 p-4 mb-4"><div className="flex items-center gap-2"><IcAlertTriangle className="w-4 h-4 text-amber-600" /><span className="text-sm font-semibold text-amber-800">{invSummary.lowStock.length} items below reorder level</span></div></div>}
                <div className="rounded-2xl border border-stone-200 bg-white shadow-card overflow-hidden mb-5">
                  <table className="w-full text-sm"><thead><tr className="bg-stone-50 border-b border-stone-200"><th className="px-4 py-2.5 text-left text-xs font-semibold text-stone-500 font-mono">Material</th><th className="px-4 py-2.5 text-right text-xs font-semibold text-stone-500 font-mono">Stock</th><th className="px-4 py-2.5 text-right text-xs font-semibold text-stone-500 font-mono hidden sm:table-cell">Value</th></tr></thead>
                    <tbody className="divide-y divide-stone-100">{invSummary.rawMaterials.map((m: any) => { const low = m.reorder_level > 0 && m.current_stock <= m.reorder_level; return <tr key={m.id} className={low ? "bg-amber-50/50" : ""}><td className="px-4 py-2.5 font-medium text-stone-800">{m.name}</td><td className={`px-4 py-2.5 text-right font-mono font-semibold ${low ? "text-amber-600" : "text-stone-800"}`}>{m.current_stock.toLocaleString("en-IN")} {m.unit}</td><td className="px-4 py-2.5 text-right font-mono text-stone-600 hidden sm:table-cell">{formatINR(m.current_stock * m.last_purchase_price)}</td></tr> })}</tbody></table>
                </div>
                <div className="text-xs font-mono text-stone-400 mb-2">Recent Movements</div>
                <div className="space-y-1.5">{invLedger.slice(0, 10).map(e => <div key={e.id} className="rounded-2xl border border-stone-200 bg-white shadow-card px-4 py-2.5 flex items-center justify-between"><div className="flex items-center gap-3"><span className={`w-6 h-6 rounded-full flex items-center justify-center ${e.direction === "in" ? "bg-emerald-50 text-emerald-600" : "bg-red-50 text-red-500"}`}>{e.direction === "in" ? <IcArrowDown className="w-3 h-3" /> : <IcArrowUp className="w-3 h-3" />}</span><div><div className="text-sm text-stone-700">{e.item_name}</div><div className="text-xs text-stone-400">{e.notes}</div></div></div><div className={`text-sm font-semibold font-mono ${e.direction === "in" ? "text-emerald-600" : "text-red-500"}`}>{e.direction === "in" ? "+" : "−"}{e.qty} {e.unit}</div></div>)}</div>
              </>}
            </>}

            {/* ═══ CONTACTS: customers and suppliers, added and edited here ═══ */}
            {page === "contacts" && <ContactsPage customers={customers} suppliers={suppliers} customersLabel={settings.words.customers} canEditSuppliers={userRole !== "staff"} onChanged={() => { fetchCustomers(); fetchSuppliers(); }} />}

            {/* ═══ SETTINGS ═══ */}
            {page === "settings" && <div>
              <h1 className="text-2xl sm:text-[28px] font-bold tracking-tight text-stone-800 mb-5">Settings</h1>
              <div className="space-y-5">
                {me && <ProfileSettings name={me.user.name} email={me.user.email} phone={me.user.phone} pending={me.user.phone_pending} munshijiNumber={me.whatsapp_number} onChanged={loadMe} />}
                {me && <DataSettings isOwner={userRole === "owner"} businessName={biz?.company_name || me?.current?.name || "this business"} />}
                {userRole !== "owner" && <p className="text-sm text-stone-500">Business details, bill numbering and the team are managed by the owner of {me?.current?.name || "this business"}.</p>}
                {userRole === "owner" && bizForm && <>
                <div className="rounded-2xl border border-stone-200 bg-white shadow-card p-5"><h3 className="text-sm font-bold text-stone-800 font-display mb-4 flex items-center gap-2"><IcBuilding /> Company</h3><div className="grid grid-cols-1 sm:grid-cols-2 gap-3">{[{ l: "Company Name", k: "company_name" }, { l: "Address", k: "address" }, { l: "City", k: "city" }, { l: "Pincode", k: "pincode" }, { l: "Phone", k: "phone" }, { l: "Email", k: "email" }].map(f => <div key={f.k}><label htmlFor={`biz-${f.k}`} className="block text-xs font-medium text-stone-700 mb-1.5">{f.l}</label><input id={`biz-${f.k}`} value={bizForm[f.k] || ""} onChange={e => setBizForm({ ...bizForm, [f.k]: e.target.value })} className="w-full px-4 py-2.5 text-sm rounded-xl border border-stone-200 text-stone-800 focus:outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-200 font-mono" /></div>)}<div><label htmlFor="biz-state" className="block text-xs font-medium text-stone-700 mb-1.5">State</label><StateSelect id="biz-state" value={bizForm.state} onChange={v => setBizForm({ ...bizForm, state: v })} /></div></div></div>

                <div className="rounded-2xl border border-stone-200 bg-white shadow-card p-5">
                  <h3 className="text-sm font-bold text-stone-800 font-display mb-1 flex items-center gap-2"><IcSettings /> How you work</h3>
                  <p className="text-xs text-stone-500 mb-4">Munshiji shows only what your business uses. Changing these never deletes data.</p>
                  <TemplatePicker value={bizForm} onChange={p => setBizForm({ ...bizForm, ...p })} />
                  <CapabilityQuestions value={bizForm} onChange={p => setBizForm({ ...bizForm, ...p })} />
                </div>

                <div className="rounded-2xl border border-stone-200 bg-white shadow-card p-5">
                  <h3 className="text-sm font-bold text-stone-800 font-display mb-4 flex items-center gap-2"><IcFile /> GST</h3>
                  <GstDetails value={bizForm} onChange={p => setBizForm({ ...bizForm, ...p })} />
                </div>

                <div className="rounded-2xl border border-stone-200 bg-white shadow-card p-5">
                  <h3 className="text-sm font-bold text-stone-800 mb-1 flex items-center gap-2"><IcFile /> Bill numbers</h3>
                  <p className="text-xs text-stone-500 mb-4">{billsExist ? "Locked: bills have already been made with this series." : "Continuing an existing series? Set it before the first bill. Numbers restart at 1 each April."}</p>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
                    <label className="text-xs font-medium text-stone-700">Prefix (1–4 letters/digits)<input value={bizForm.invoice_prefix ?? "INV"} disabled={billsExist} maxLength={4} onChange={e => setBizForm({ ...bizForm, invoice_prefix: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "") })} className="mt-1.5 w-full px-4 py-2.5 text-sm rounded-xl border border-stone-200 font-mono uppercase disabled:bg-stone-50" /></label>
                    <label className="text-xs font-medium text-stone-700">Next bill number<input type="number" min={1} value={bizForm.invoice_start ?? 1} disabled={billsExist} onChange={e => setBizForm({ ...bizForm, invoice_start: Number(e.target.value) })} className="mt-1.5 w-full px-4 py-2.5 text-sm rounded-xl border border-stone-200 font-mono disabled:bg-stone-50" /></label>
                    <p className="text-sm text-stone-600">First bill: <b className="font-mono">{(bizForm.invoice_prefix || "INV")}/{(() => { const d = new Date(Date.now() + 330 * 60000); const y = d.getUTCMonth() >= 3 ? d.getUTCFullYear() : d.getUTCFullYear() - 1; return `${String(y).slice(2)}-${String(y + 1).slice(2)}`; })()}/{String(bizForm.invoice_start || 1).padStart(4, "0")}</b></p>
                  </div>
                </div>

                <div className="rounded-2xl border border-stone-200 bg-white shadow-card p-5">
                  <h3 className="text-sm font-bold text-stone-800 mb-1 flex items-center gap-2"><IcFile /> GST documents</h3>
                  <p className="text-xs text-stone-500 mb-4">Ask your CA if you&apos;re unsure about any of these.</p>
                  <label className="flex items-start gap-3 text-sm text-stone-800">
                    <input type="checkbox" className="mt-1" checked={!!Number(bizForm.einvoice_applicable)} onChange={e => setBizForm({ ...bizForm, einvoice_applicable: e.target.checked ? 1 : 0 })} />
                    <span><b>E-invoicing applies to us</b><span className="block text-xs text-stone-500">Turn on if your turnover (all GSTINs under your PAN) crossed ₹5 crore in any year since 2017-18. It stays on even if turnover falls later. Bills to registered buyers then need an IRN from the IRP before they&apos;re valid.</span></span>
                  </label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-4">
                    <label className="text-xs font-medium text-stone-700">E-way bill needed within your state above (₹, incl. GST)<input type="number" min={0} value={bizForm.ewb_threshold ?? 50000} onChange={e => setBizForm({ ...bizForm, ewb_threshold: Number(e.target.value) })} className="mt-1.5 w-full px-4 py-2.5 text-sm rounded-xl border border-stone-200 font-mono" /><span className="block text-[11px] text-stone-500 mt-1">Maharashtra, Delhi, Tamil Nadu and some others: ₹1,00,000. Most states: ₹50,000. Deliveries to another state always use ₹50,000.</span></label>
                    <label className="text-xs font-medium text-stone-700">Credit note prefix<input value={bizForm.credit_note_prefix ?? "CN"} maxLength={4} onChange={e => setBizForm({ ...bizForm, credit_note_prefix: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "") })} className="mt-1.5 w-full px-4 py-2.5 text-sm rounded-xl border border-stone-200 font-mono uppercase" /><span className="block text-[11px] text-stone-500 mt-1">Credit notes are numbered separately, e.g. {(bizForm.credit_note_prefix || "CN")}/26-27/0001.</span></label>
                  </div>
                </div>

                <EmailSettings />
                <TeamSettings myId={me?.user.id} businessName={biz?.company_name || me?.current?.name || "your business"} />
                <div className="rounded-2xl border border-stone-200 bg-white shadow-card p-5"><h3 className="text-sm font-bold text-stone-800 font-display mb-4 flex items-center gap-2"><IcShield /> MSME</h3><div className="grid grid-cols-1 sm:grid-cols-2 gap-3">{[{ l: "Udyam Number", k: "udyam_number", p: "UDYAM-MH-01-0012345" }].map(f => <div key={f.k}><label className="block text-xs font-medium text-stone-600 mb-1.5">{f.l}</label><input value={bizForm[f.k] || ""} onChange={e => setBizForm({ ...bizForm, [f.k]: e.target.value })} placeholder={f.p} className="w-full px-4 py-2.5 text-sm rounded-xl border border-stone-200 text-stone-700 placeholder-stone-400 focus:outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-200 font-mono" /></div>)}</div></div>
                <div className="rounded-2xl border border-stone-200 bg-white shadow-card p-5"><h3 className="text-sm font-bold text-stone-800 font-display mb-4 flex items-center gap-2"><IcBanknote /> Getting paid</h3><div className="grid grid-cols-1 sm:grid-cols-2 gap-3">{[{ l: "UPI ID (adds a pay QR to bills)", k: "upi_id" }, { l: "Bank Name", k: "bank_name" }, { l: "Account Number", k: "bank_account" }, { l: "IFSC Code", k: "bank_ifsc" }].map(f => <div key={f.k}><label className="block text-xs font-medium text-stone-600 mb-1.5">{f.l}</label><input value={bizForm[f.k] || ""} onChange={e => setBizForm({ ...bizForm, [f.k]: e.target.value })} className="w-full px-4 py-2.5 text-sm rounded-xl border border-stone-200 text-stone-700 focus:outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-200 font-mono" /></div>)}</div></div>
                {caps.credit && <div className="rounded-2xl border border-stone-200 bg-white shadow-card p-5">
                  <h3 className="text-sm font-bold text-stone-800 font-display mb-1 flex items-center gap-2"><IcClock /> Payment terms</h3>
                  <p className="text-xs text-stone-500 mb-4">Unpaid invoices older than this are marked overdue. Invoices also show it as the due date, e.g. “Net 30”.</p>
                  <label className="flex items-center gap-3 text-sm text-stone-700">
                    <span>Mark overdue after</span>
                    <input type="number" inputMode="numeric" min={1} max={365} value={bizForm.overdue_days ?? DEFAULT_OVERDUE_DAYS}
                      onChange={e => setBizForm({ ...bizForm, overdue_days: e.target.value === "" ? "" : Number(e.target.value) })}
                      onBlur={e => setBizForm({ ...bizForm, overdue_days: clampOverdueDays(e.target.value) })}
                      className="w-20 px-3 py-2 text-sm rounded-xl border border-stone-200 text-stone-800 font-mono text-center focus:outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-200" />
                    <span>days from the invoice date</span>
                  </label>
                </div>}

                <div className="rounded-2xl border border-stone-200 bg-white shadow-card p-5">
                  <div className="flex items-start justify-between gap-3 mb-1">
                    <h3 className="text-sm font-bold text-stone-800 font-display flex items-center gap-2"><IcLayers /> Order statuses</h3>
                    <button type="button" onClick={() => setBizForm({ ...bizForm, status_styles: "{}" })} className="text-xs text-stone-500 hover:text-stone-800 underline underline-offset-2">Reset to defaults</button>
                  </div>
                  <p className="text-xs text-stone-500 mb-4">Rename statuses and pick their colours. The order of steps stays the same.</p>
                  <div className="divide-y divide-stone-100">
                    {ORDER_STATES.filter(st => settings.flow.includes(st.key) || (st.key === "overdue" && caps.credit)).map(st => {
                      const cur = resolveStatus(st.key, effectiveStatusStyles(settings.words, formStyles));
                      return (
                        <div key={st.key} className="py-3 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
                          <div className="sm:w-40 shrink-0">
                            <input value={(formStyles as Record<string, { label?: string }>)[st.key]?.label ?? ""} placeholder={resolveStatus(st.key, effectiveStatusStyles(settings.words, {})).label} maxLength={24}
                              onChange={e => setFormStyle(st.key, { label: e.target.value })} aria-label={`Label for ${st.label}`}
                              className="w-full px-3 py-2 text-sm rounded-xl border border-stone-200 text-stone-800 placeholder-stone-500 focus:outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-200" />
                            {st.key === "overdue" && <p className="text-xs text-stone-500 mt-1">Set automatically after {clampOverdueDays(bizForm.overdue_days)} days</p>}
                          </div>
                          <div className="flex flex-wrap gap-0.5 sm:flex-1" role="radiogroup" aria-label={`Colour for ${cur.label}`}>
                            {(Object.keys(STATUS_COLORS) as StatusColor[]).map(c => (
                              <button key={c} type="button" role="radio" aria-checked={cur.color === c} aria-label={STATUS_COLORS[c].name} title={STATUS_COLORS[c].name}
                                onClick={() => setFormStyle(st.key, { color: c })}
                                className="w-8 h-8 inline-flex items-center justify-center rounded-full group"><span className={`w-6 h-6 rounded-full ${STATUS_COLORS[c].dot} ${cur.color === c ? "ring-2 ring-offset-2 ring-stone-800" : "opacity-70 group-hover:opacity-100"}`} /></button>
                            ))}
                          </div>
                          <div className="sm:w-32 sm:text-right shrink-0"><span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full font-semibold border font-mono text-xs px-2 py-0.5 ${cur.classes.badge}`}><span className={`w-1.5 h-1.5 rounded-full ${cur.classes.dot}`} />{cur.label}</span></div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <button onClick={saveBiz} className="inline-flex items-center justify-center gap-2 font-semibold text-sm px-6 py-2.5 rounded-xl bg-emerald-600 text-white hover:bg-emerald-700"><IcCheck /> Save</button>
                {saveMsg && <p role="status" className={`text-sm font-medium ${saveMsg.ok ? "text-emerald-700" : "text-red-700"}`}>{saveMsg.text}</p>}
                </>}
              </div>
            </div>}
          </div>
        </main>
      </div>

      {/* Phone: bottom tabs within thumb reach */}
      <nav aria-label="Main" className="md:hidden fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 bg-white border-t border-stone-200 px-1.5 pt-1.5 pb-[calc(6px+env(safe-area-inset-bottom,0px))]">
        {[
          { key: "overview" as AppPage, label: "Home", icon: <IcGrid className="w-[22px] h-[22px]" /> },
          { key: "orders" as AppPage, label: "Orders", icon: <IcPackage className="w-[22px] h-[22px]" />, badge: ovx.pending?.pending || 0 },
          null,
          { key: "money" as AppPage, label: "Money", icon: <IcBanknote className="w-[22px] h-[22px]" />, badge: caps.credit ? overview?.overdueOrders || 0 : 0, red: true },
        ].map((t, k) => t === null
          ? <button key="new" type="button" onClick={() => setShowParse(true)} aria-label="New order from WhatsApp" className="flex justify-center"><span className="-mt-5 w-[52px] h-[52px] rounded-[18px] bg-emerald-600 text-white grid place-items-center shadow-[0_6px_16px_-6px_rgba(30,127,71,.55)]"><IcPlus className="w-6 h-6" /></span></button>
          : <button key={t.key} type="button" onClick={() => t.key === "orders" ? openOrders() : setPage(t.key)} aria-current={page === t.key ? "page" : undefined} className={`relative flex flex-col items-center justify-center gap-0.5 min-h-[48px] text-xs font-semibold ${page === t.key ? "text-emerald-600" : "text-stone-500"}`}>
              {t.icon}{t.label}
              {!!t.badge && <span className={`absolute top-0.5 left-[calc(50%+6px)] min-w-[18px] px-1 rounded-full text-[11px] leading-[17px] font-bold ${t.red ? "bg-red-600 text-white" : "bg-stone-200 text-stone-700"}`}>{t.badge}</span>}
            </button>)}
        <button type="button" onClick={() => setSidebarOpen(true)} className="flex flex-col items-center justify-center gap-0.5 min-h-[48px] text-xs font-semibold text-stone-500"><IcMore className="w-[22px] h-[22px]" />More</button>
      </nav>

      <ParseModal open={showParse} onClose={() => setShowParse(false)} onSaved={refreshAll} />
      <OrderDrawer order={selectedOrder} onClose={() => setSelectedOrder(null)} onRefresh={refreshAll} onViewBill={(o) => setInvoiceOrder(o)} />
      <InvoiceModal order={invoiceOrder} biz={biz} onClose={() => setInvoiceOrder(null)} />
      {showSetup && userRole === "owner" && <SetupWizard onComplete={() => { setShowSetup(false); fetchBiz(); }} />}
    </div>
    </StatusContext.Provider>
  );
}
