import type { Metadata } from "next";
import { LegalLayout } from "@/components/legal-layout";
import { legal } from "@/lib/legal";
export const metadata: Metadata = { title: "Terms of Service · Munshiji" };
export const dynamic = "force-dynamic";

export default function Terms() {
  const l = legal();
  return (
    <LegalLayout title="Terms of Service">
      <p>These terms are an agreement between you (and the business you use Munshiji for) and {l.company}, {l.address}. By creating an account or joining a team you accept them.</p>
      <h2>What Munshiji does</h2>
      <p>Munshiji helps you record orders, make bills, track stock and payments, and prepare GST return figures from your own records. It reads order messages you forward or paste into drafts for you to check.</p>
      <h2>What stays your responsibility</h2>
      <ul>
        <li>Munshiji is software, not tax, legal or accounting advice. Check figures with your CA.</li>
        <li>You&apos;re responsible for the correctness of what you enter (products, rates, HSN codes, GST rates, buyer GSTINs) and for filing your GST returns. Munshiji prepares figures; it doesn&apos;t file them for you.</li>
        <li>Where the law requires an e-invoice (IRN) or an e-way bill, you generate it on the government portal (or through a provider) and record it in Munshiji. Munshiji warns you, but you remain responsible.</li>
        <li>Drafts read from messages, by AI or otherwise, can be wrong. Nothing becomes an order until someone in your team approves it; check every line.</li>
      </ul>
      <h2>Accounts and teams</h2>
      <p>The owner of a business decides who joins and with which role, and is responsible for their team&apos;s use of Munshiji. Keep your password private. Tell us at once if you think your account has been misused.</p>
      <h2>Your data</h2>
      <p>Your business&apos;s data belongs to your business. You let us store and process it only to provide Munshiji. Owners can download all of it at any time (Settings → Your data). Our <a href="/privacy">Privacy Policy</a> explains how we handle personal data.</p>
      <h2>Fair use</h2>
      <p>Don&apos;t use Munshiji for anything unlawful, to issue false bills, to send spam, or to try to reach other businesses&apos; data or disrupt the service.</p>
      <h2>Fees</h2>
      <p>Fees, if any, are as agreed with you or shown in the app. We&apos;ll give at least 30 days&apos; notice before introducing or changing fees.</p>
      <h2>Availability</h2>
      <p>We work to keep Munshiji available and your data backed up, but we can&apos;t promise it will never be interrupted. We may need short maintenance windows, which we&apos;ll announce when we can.</p>
      <h2>Ending</h2>
      <p>You can stop using Munshiji and delete your account at any time. We may suspend an account that breaks these terms, after warning you where possible. Tax records are kept as the Privacy Policy describes.</p>
      <h2>Liability</h2>
      <p>To the extent the law allows, we aren&apos;t liable for indirect losses, and our total liability is limited to the fees you paid us in the 12 months before the claim. Nothing here limits liability that can&apos;t be limited by law.</p>
      <h2>Law and disputes</h2>
      <p>These terms are governed by the laws of India. Courts in {l.courts} have jurisdiction. Before going to court, please contact us so we can try to resolve the problem.</p>
      <h2>Contact</h2>
      <p><a href={`mailto:${l.supportEmail}`}>{l.supportEmail}</a> · Grievance officer: {l.grievanceName}, <a href={`mailto:${l.grievanceEmail}`}>{l.grievanceEmail}</a>.</p>
    </LegalLayout>
  );
}
