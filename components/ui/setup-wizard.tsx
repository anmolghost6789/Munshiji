"use client";
import { useState, useEffect } from "react";
import { IcBuilding, IcBanknote, IcCheck, IcArrowRight, IcSettings } from "../icons";
import { Mascot } from "../brand";
import { TemplatePicker, CapabilityQuestions, GstDetails, StateSelect, type SetupForm } from "./business-setup";
import { TEMPLATES, parseCapabilities, parseTemplate, isValidUpiId } from "@/lib/business";
import { checkGstin, parseRegistration } from "@/lib/gst";
import { DEFAULT_OVERDUE_DAYS, clampOverdueDays } from "@/lib/types";

const inputCls = "w-full px-4 py-3 text-sm rounded-xl border border-stone-200 text-stone-800 placeholder-stone-500 focus:outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-200";

function Field({ label, id, children, help }: { label: string; id: string; children: React.ReactNode; help?: string }) {
  return (
    <div>
      <label htmlFor={id} className="block text-xs font-medium text-stone-700 mb-1.5">{label}</label>
      {children}
      {help && <p className="text-xs text-stone-500 mt-1">{help}</p>}
    </div>
  );
}

export function SetupWizard({ onComplete }: { onComplete: () => void }) {
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [f, setF] = useState<SetupForm & Record<string, any>>({
    company_name: "", gstin: "", pan: "", address: "", city: "", state: "", pincode: "", phone: "", email: "",
    udyam_number: "", bank_name: "", bank_account: "", bank_ifsc: "", upi_id: "",
    template: "manufacturer", capabilities: JSON.stringify(TEMPLATES.manufacturer.caps), gst_registration: "regular", composition_rate: 1,
    overdue_days: DEFAULT_OVERDUE_DAYS,
  });
  const patch = (p: Partial<SetupForm> & Record<string, unknown>) => setF((prev) => ({ ...prev, ...p }));
  const caps = parseCapabilities(f.capabilities, parseTemplate(f.template));

  const steps = [
    { title: "Your business", sub: "Name, GST and address", icon: <IcBuilding className="w-5 h-5" /> },
    { title: "How you work", sub: "So Munshiji shows only what you need", icon: <IcSettings className="w-5 h-5" /> },
    { title: "Getting paid", sub: "Optional — add these now or later", icon: <IcBanknote className="w-5 h-5" /> },
  ];

  const gstinProblem = parseRegistration(f.gst_registration) !== "none" && f.gstin && !checkGstin(f.gstin).valid;
  const upiProblem = !!f.upi_id && !isValidUpiId(f.upi_id);
  // Start from what we already know (the business name entered at sign-up).
  useEffect(() => {
    fetch("/api/business").then((r) => (r.ok ? r.json() : null)).then((d) => {
      const p = d?.profile;
      if (p) setF((cur) => ({ ...cur, company_name: cur.company_name || p.company_name || "", gstin: cur.gstin || p.gstin || "", state: cur.state || p.state || "" }));
    }).catch(() => {});
  }, []);
  const canNext = step === 0 ? !!String(f.company_name).trim() && !gstinProblem : step === 2 ? !upiProblem : true;

  const handleFinish = async () => {
    setSaving(true); setError("");
    const res = await fetch("/api/business", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(f) }).catch(() => null);
    setSaving(false);
    if (!res || !res.ok) { setError("Couldn't save. Check your connection and try again."); return; }
    onComplete();
  };

  return (
    <div className="fixed inset-0 bg-stone-50 z-[60] overflow-y-auto">
      <div className="min-h-full flex items-center justify-center p-4">
        <div className="w-full max-w-lg py-6">
          <div className="text-center mb-6">
            <Mascot pose={step === 0 ? "waving" : step === 1 ? "pointing" : "thumbs-up"} height={108} className="mx-auto mb-3" decorative />
            <h1 className="text-2xl font-extrabold text-stone-800 font-display">Welcome to Munshiji</h1>
            <p className="text-sm text-stone-600 mt-1">Let&apos;s set up your business in 2 minutes</p>
          </div>

          <ol className="flex items-center justify-center gap-2 mb-6" aria-label="Setup progress">
            {steps.map((s, i) => (
              <li key={i} className="flex items-center gap-2" aria-current={step === i ? "step" : undefined}>
                <span className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold ${step > i ? "bg-emerald-600 text-white" : step === i ? "border-2 border-stone-800 text-stone-800" : "border-2 border-stone-200 text-stone-500"}`}>
                  {step > i ? <IcCheck className="w-3.5 h-3.5" /> : i + 1}
                </span>
                {i < steps.length - 1 && <span className={`w-8 h-px ${step > i ? "bg-stone-800" : "bg-stone-200"}`} />}
              </li>
            ))}
          </ol>

          <div className="bg-white rounded-2xl border border-stone-200 shadow-sm overflow-hidden">
            <div className="px-6 py-5 border-b border-stone-100 flex items-center gap-3">
              <span className="text-stone-600">{steps[step].icon}</span>
              <div>
                <h2 className="text-base font-bold text-stone-800 font-display">{steps[step].title}</h2>
                <p className="text-xs text-stone-500">{steps[step].sub}</p>
              </div>
            </div>

            <div className="p-6 space-y-4">
              {step === 0 && <>
                <Field label="Business name *" id="company_name">
                  <input id="company_name" value={f.company_name} onChange={(e) => patch({ company_name: e.target.value })} placeholder="e.g. Sharma Corrugated Industries" className={inputCls} autoFocus />
                </Field>
                <GstDetails value={f} onChange={patch} />
                <div className="grid grid-cols-2 gap-3">
                  <Field label="City" id="city"><input id="city" value={f.city} onChange={(e) => patch({ city: e.target.value })} placeholder="Pune" className={inputCls} /></Field>
                  <Field label="State" id="state"><StateSelect value={f.state} onChange={(v) => patch({ state: v })} /></Field>
                </div>
                <Field label="Address" id="address"><input id="address" value={f.address} onChange={(e) => patch({ address: e.target.value })} placeholder="Plot 45, MIDC Industrial Area" className={inputCls} /></Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Phone" id="phone"><input id="phone" value={f.phone} onChange={(e) => patch({ phone: e.target.value })} placeholder="9876500001" type="tel" inputMode="tel" className={`${inputCls} font-mono`} /></Field>
                  <Field label="Pincode" id="pincode"><input id="pincode" value={f.pincode} onChange={(e) => patch({ pincode: e.target.value })} placeholder="411057" inputMode="numeric" className={`${inputCls} font-mono`} /></Field>
                </div>
              </>}

              {step === 1 && <>
                <TemplatePicker value={f} onChange={patch} />
                <CapabilityQuestions value={f} onChange={patch} />
                {caps.credit && (
                  <label className="flex flex-wrap items-center gap-3 text-sm text-stone-700">
                    <span>Customers usually pay within</span>
                    <input type="number" inputMode="numeric" min={1} max={365} value={f.overdue_days} onChange={(e) => patch({ overdue_days: e.target.value === "" ? "" : Number(e.target.value) })} onBlur={(e) => patch({ overdue_days: clampOverdueDays(e.target.value) })}
                      className="w-20 px-3 py-2 text-sm rounded-xl border border-stone-200 font-mono text-center focus:outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-200" aria-label="Payment terms in days" />
                    <span>days</span>
                  </label>
                )}
              </>}

              {step === 2 && <>
                <Field label="UPI ID" id="upi_id" help={upiProblem ? "A UPI ID looks like name@bank" : "Adds a scan-to-pay QR code to your bills"}>
                  <input id="upi_id" value={f.upi_id} onChange={(e) => patch({ upi_id: e.target.value.trim() })} placeholder="sharmaindustries@okhdfcbank" autoComplete="off" aria-invalid={upiProblem || undefined} className={`${inputCls} font-mono`} />
                </Field>
                <Field label="Bank name" id="bank_name"><input id="bank_name" value={f.bank_name} onChange={(e) => patch({ bank_name: e.target.value })} placeholder="State Bank of India" className={inputCls} /></Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Account number" id="bank_account"><input id="bank_account" value={f.bank_account} onChange={(e) => patch({ bank_account: e.target.value })} placeholder="39201234567" inputMode="numeric" className={`${inputCls} font-mono`} /></Field>
                  <Field label="IFSC" id="bank_ifsc"><input id="bank_ifsc" value={f.bank_ifsc} onChange={(e) => patch({ bank_ifsc: e.target.value.toUpperCase() })} placeholder="SBIN0001234" maxLength={11} className={`${inputCls} font-mono uppercase`} /></Field>
                </div>
                <Field label="Udyam registration number" id="udyam_number"><input id="udyam_number" value={f.udyam_number} onChange={(e) => patch({ udyam_number: e.target.value.toUpperCase() })} placeholder="UDYAM-MH-01-0012345" className={`${inputCls} font-mono uppercase`} /></Field>
              </>}
              {error && <p className="text-sm text-red-700 font-medium" role="alert">{error}</p>}
            </div>

            <div className="px-6 py-4 border-t border-stone-100 flex justify-between items-center">
              {step > 0 ? <button onClick={() => setStep(step - 1)} className="text-sm text-stone-600 hover:text-stone-800 font-medium">← Back</button> : <span />}
              {step < steps.length - 1 ? (
                <button onClick={() => setStep(step + 1)} disabled={!canNext} className="inline-flex items-center gap-2 text-sm font-bold px-6 py-2.5 rounded-xl bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-40 transition-all">Next <IcArrowRight /></button>
              ) : (
                <button onClick={handleFinish} disabled={saving || !canNext} className="inline-flex items-center gap-2 text-sm font-bold px-6 py-2.5 rounded-xl bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-40 transition-all">
                  {saving ? "Saving…" : "Start Using Munshiji"} {!saving && <IcCheck />}
                </button>
              )}
            </div>
          </div>
          <p className="text-center text-xs text-stone-500 mt-4">You can change all of this later in Settings</p>
        </div>
      </div>
    </div>
  );
}
