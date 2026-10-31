import type { Metadata } from "next";
import { LegalLayout } from "@/components/legal-layout";
import { legal } from "@/lib/legal";
export const metadata: Metadata = { title: "Help and support · Munshiji" };
export const dynamic = "force-dynamic";

const FAQ: [string, string][] = [
  ["I forgot my password", "On the sign-in page, tap “Forgot password?”. We'll email a link that works once, for an hour."],
  ["A bill has a mistake", "Bills can't be edited once made. Issue a credit note from the order (returns, price changes or excess tax), then a new bill if needed. Ask your CA if unsure."],
  ["Stock in Munshiji doesn't match the godown", "Open Stock → the item → Count, enter what you counted and why. Every change is kept in the item's history."],
  ["A payment was recorded by mistake", "The owner can open the order → Payments → Remove, with a reason."],
  ["My forwarded WhatsApp order didn't arrive", "Check that your number is linked in Settings → Your profile, and that you forwarded text (not a photo or voice note)."],
  ["The dispatch button says an e-way bill is needed", "Above the limit, generate the e-way bill on the government portal, then enter its number and the vehicle in the order's Transport section."],
];

export default function Support() {
  const l = legal();
  return (
    <LegalLayout title="Help and support">
      <h2>Talk to us</h2>
      <ul>
        <li>Email: <a href={`mailto:${l.supportEmail}`}>{l.supportEmail}</a></li>
        {l.supportWhatsApp && <li>WhatsApp: {l.supportWhatsApp}</li>}
        <li>Hours: {l.supportHours}</li>
      </ul>
      <p>Tell us your business name, what you were doing, what you expected and what happened, and an order or bill number if there is one. Please don&apos;t send passwords.</p>
      <h2>Common questions</h2>
      <div className="space-y-4">{FAQ.map(([q, a]) => <div key={q}><p className="font-semibold text-stone-800">{q}</p><p>{a}</p></div>)}</div>
      <h2>Your data</h2>
      <p>Download or delete your data in Settings → Your data. For anything else about personal data, write to our grievance officer, {l.grievanceName}, at <a href={`mailto:${l.grievanceEmail}`}>{l.grievanceEmail}</a>.</p>
    </LegalLayout>
  );
}
