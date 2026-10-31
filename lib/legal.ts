/* Company details for the legal and support pages. Set these in the environment; placeholders show until you do. */
const ph = (v: string | undefined, label: string) => (v && v.trim() ? v.trim() : `[${label}]`);
export const legal = () => ({
  company: ph(process.env.MUNSHIJI_LEGAL_NAME, "registered company name"),
  address: ph(process.env.MUNSHIJI_LEGAL_ADDRESS, "registered office address"),
  supportEmail: ph(process.env.MUNSHIJI_SUPPORT_EMAIL, "support email"),
  supportWhatsApp: process.env.MUNSHIJI_SUPPORT_WHATSAPP || process.env.MUNSHIJI_WHATSAPP_NUMBER || "",
  supportHours: ph(process.env.MUNSHIJI_SUPPORT_HOURS, "support hours, e.g. Mon–Sat 10:00–19:00 IST"),
  grievanceName: ph(process.env.MUNSHIJI_GRIEVANCE_OFFICER, "grievance officer's name"),
  grievanceEmail: ph(process.env.MUNSHIJI_GRIEVANCE_EMAIL || process.env.MUNSHIJI_SUPPORT_EMAIL, "grievance email"),
  courts: ph(process.env.MUNSHIJI_JURISDICTION_CITY, "city"),
  dataLocation: ph(process.env.MUNSHIJI_DATA_LOCATION, "where your data is hosted, e.g. AWS Mumbai (ap-south-1)"),
  reviewed: process.env.MUNSHIJI_LEGAL_REVIEWED === "1",
  updated: "27 October 2026",
});
