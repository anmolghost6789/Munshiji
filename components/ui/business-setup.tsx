"use client";
import { TEMPLATES, CAPABILITY_QUESTIONS, parseCapabilities, parseTemplate, type Capabilities, type TemplateKey } from "@/lib/business";
import { REGISTRATIONS, COMPOSITION_RATES, STATE_NAMES, checkGstin, parseRegistration } from "@/lib/gst";

/* The form shape both the wizard and Settings use (mirrors business_profile columns). */
export interface SetupForm {
  template?: string; capabilities?: string; gst_registration?: string; composition_rate?: number;
  gstin?: string; pan?: string; state?: string;
  [k: string]: unknown;
}

const inputCls = "w-full px-4 py-3 text-sm rounded-xl border border-stone-200 text-stone-800 placeholder-stone-500 focus:outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-200";

const CARDS: { key: TemplateKey; name: string; description: string; art: string }[] = [
  { key: "manufacturer", name: TEMPLATES.manufacturer.name, description: TEMPLATES.manufacturer.description, art: "manufacturer" },
  { key: "retail_delivery", name: TEMPLATES.retail_delivery.name, description: TEMPLATES.retail_delivery.description, art: "shop-delivers" },
  { key: "custom", name: "Something else", description: "Answer a few questions and we'll set it up", art: "something-else" },
];

export function TemplatePicker({ value, onChange }: { value: SetupForm; onChange: (patch: Partial<SetupForm>) => void }) {
  const current = parseTemplate(value.template);
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2" role="radiogroup" aria-label="Type of business">
      {CARDS.map((c) => {
        const on = current === c.key;
        return (
          <button key={c.key} type="button" role="radio" aria-checked={on}
            onClick={() => onChange({ template: c.key, ...(c.key === "custom" ? {} : { capabilities: JSON.stringify(TEMPLATES[c.key].caps) }) })}
            className={`text-left rounded-2xl border p-2 transition-colors ${on ? "border-emerald-600 bg-emerald-50 ring-1 ring-emerald-600" : "border-stone-200 bg-white hover:border-stone-400"}`}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/brand/setup/${c.art}.webp`} alt="" width={320} height={160} className="w-full h-auto rounded-xl mb-2 aspect-[2/1] object-cover" />
            <div className="px-1 text-sm font-semibold text-stone-800">{c.name}</div>
            <div className="px-1 pb-1 text-xs text-stone-600 mt-0.5 leading-snug">{c.description}</div>
          </button>
        );
      })}
    </div>
  );
}

export function CapabilityQuestions({ value, onChange }: { value: SetupForm; onChange: (patch: Partial<SetupForm>) => void }) {
  const caps = parseCapabilities(value.capabilities, parseTemplate(value.template));
  const set = (k: keyof Capabilities, v: boolean) => onChange({ capabilities: JSON.stringify({ ...caps, [k]: v }) });
  return (
    <div className="divide-y divide-stone-100">
      {CAPABILITY_QUESTIONS.map((q) => (
        <div key={q.key} className="py-3 flex items-center justify-between gap-4">
          <div>
            <div className="text-sm font-medium text-stone-800">{q.question}</div>
            <div className="text-xs text-stone-500 mt-0.5">{q.help}</div>
          </div>
          <div className="inline-flex rounded-xl border border-stone-200 p-0.5 shrink-0" role="radiogroup" aria-label={q.question}>
            {[true, false].map((v) => (
              <button key={String(v)} type="button" role="radio" aria-checked={caps[q.key] === v} onClick={() => set(q.key, v)}
                className={`px-4 py-1.5 text-sm rounded-lg font-semibold transition-colors ${caps[q.key] === v ? "bg-emerald-600 text-white" : "text-stone-600 hover:bg-stone-100"}`}>
                {v ? "Yes" : "No"}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export function GstDetails({ value, onChange }: { value: SetupForm; onChange: (patch: Partial<SetupForm>) => void }) {
  const reg = parseRegistration(value.gst_registration);
  const gstin = String(value.gstin || "");
  const check = gstin ? checkGstin(gstin) : null;
  const showError = check && !check.valid && gstin.length >= 15;

  const onGstin = (raw: string) => {
    const g = raw.toUpperCase().replace(/\s/g, "").slice(0, 15);
    const c = checkGstin(g);
    // A valid GSTIN tells us the state and PAN — fill them in so the owner doesn't have to.
    onChange(c.valid ? { gstin: g, state: c.stateName, pan: c.pan } : { gstin: g });
  };

  return (
    <div className="space-y-3">
      <div role="radiogroup" aria-label="GST registration" className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        {REGISTRATIONS.map((r) => (
          <button key={r.key} type="button" role="radio" aria-checked={reg === r.key} onClick={() => onChange({ gst_registration: r.key })}
            className={`text-left rounded-xl border p-3 transition-colors ${reg === r.key ? "border-emerald-600 bg-emerald-50 ring-1 ring-emerald-600" : "border-stone-200 bg-white hover:border-stone-400"}`}>
            <div className="text-sm font-semibold text-stone-800">{r.label}</div>
            <div className="text-xs text-stone-600 mt-0.5 leading-snug">{r.help}</div>
          </button>
        ))}
      </div>

      {reg !== "none" && (
        <div>
          <label htmlFor="gstin" className="block text-xs font-medium text-stone-700 mb-1.5">GSTIN</label>
          <input id="gstin" value={gstin} onChange={(e) => onGstin(e.target.value)} placeholder="27AAPFU0939F1ZV" maxLength={15} autoComplete="off"
            aria-invalid={showError || undefined} aria-describedby="gstin-help" className={`${inputCls} font-mono uppercase`} />
          <p id="gstin-help" className={`text-xs mt-1 ${showError ? "text-red-700" : check?.valid ? "text-emerald-700" : "text-stone-500"}`}>
            {check?.valid ? `✓ Valid · ${check.stateName} · PAN ${check.pan}` : showError ? (check as { error: string }).error : "15 characters, from your GST registration certificate"}
          </p>
        </div>
      )}

      {reg === "composition" && (
        <div>
          <label htmlFor="comp-rate" className="block text-xs font-medium text-stone-700 mb-1.5">Composition tax rate</label>
          <select id="comp-rate" value={Number(value.composition_rate) || 1} onChange={(e) => onChange({ composition_rate: Number(e.target.value) })} className={`${inputCls} bg-white`}>
            {COMPOSITION_RATES.map((c) => <option key={c.rate} value={c.rate}>{c.label}</option>)}
          </select>
        </div>
      )}
    </div>
  );
}

export function StateSelect({ value, onChange, id = "state" }: { value?: string; onChange: (v: string) => void; id?: string }) {
  return (
    <select id={id} value={value || ""} onChange={(e) => onChange(e.target.value)} className={`${inputCls} bg-white`}>
      <option value="" disabled>Choose state</option>
      {STATE_NAMES.map((s) => <option key={s} value={s}>{s}</option>)}
    </select>
  );
}
