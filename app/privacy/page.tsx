import type { Metadata } from "next";
import { LegalLayout } from "@/components/legal-layout";
import { legal } from "@/lib/legal";
export const metadata: Metadata = { title: "Privacy Policy · Munshiji" };
export const dynamic = "force-dynamic";

export default function Privacy() {
  const l = legal();
  return (
    <LegalLayout title="Privacy Policy">
      <p>This policy explains what personal data Munshiji collects, why, and the rights you have under India&apos;s Digital Personal Data Protection Act, 2023. Munshiji is run by {l.company}, {l.address} (&quot;we&quot;).</p>
      <h2>Two kinds of data</h2>
      <ul>
        <li><b>Your account.</b> Your name, email, password (stored only as a one-way hash), and your WhatsApp number if you link it. For this data we decide why and how it&apos;s used.</li>
        <li><b>Your business&apos;s records.</b> Customers, suppliers, products, orders, bills, payments and messages that your business enters or forwards. Your business decides what to keep and why; we process it on your business&apos;s behalf to provide Munshiji.</li>
      </ul>
      <h2>What we collect and why</h2>
      <ul>
        <li>Account details: to sign you in, keep your account secure and contact you about it (for example password resets).</li>
        <li>Business details such as GSTIN, PAN, address, bank and UPI details: to make your bills and prepare your GST figures.</li>
        <li>Messages you forward to the Munshiji WhatsApp number or paste into the app: to turn them into draft orders for you to review. We only read messages sent from numbers linked to a Munshiji team.</li>
        <li>Technical data such as your IP address, sign-in attempts and an activity log of changes in your business: for security, to stop password guessing, and so your business can see who did what.</li>
        <li>Cookies: one keeps you signed in, one remembers which business you&apos;re working in. We use no advertising or tracking cookies.</li>
      </ul>
      <p>We don&apos;t sell personal data, and we don&apos;t use it for advertising.</p>
      <h2>Who helps us run Munshiji</h2>
      <p>We use these service providers, only to provide Munshiji: hosting and database providers; Resend (email); Meta (WhatsApp messages); and, if your business has it switched on, Microsoft Azure OpenAI to read order messages. Each processes data only on our instructions and under its own data-protection terms. We may disclose data if the law requires it.</p>
      <h2>Where it&apos;s kept, and for how long</h2>
      <p>Data is stored in {l.dataLocation}. Your account data is kept until you delete your account. Business tax records (bills, credit notes, payments) are kept for as long as GST law requires a business to keep them, even if an account is deleted; Indian law allows this. After that period we delete them.</p>
      <h2>Your rights</h2>
      <ul>
        <li><b>See your data:</b> Settings → Your data → Download my data.</li>
        <li><b>Correct it:</b> change your name and WhatsApp number in Settings → Your profile, or ask us.</li>
        <li><b>Erase it:</b> Settings → Your data → Delete my account. Your name, email and number are erased immediately.</li>
        <li><b>Withdraw consent:</b> unlink your WhatsApp number or delete your account at any time. This doesn&apos;t affect anything done before.</li>
        <li><b>Nominate someone</b> to exercise these rights if you die or can&apos;t: write to us.</li>
        <li><b>Raise a grievance:</b> contact our grievance officer below. If you&apos;re not satisfied with our response, you can complain to the Data Protection Board of India.</li>
      </ul>
      <h2>Security</h2>
      <p>Connections are encrypted (HTTPS). Passwords are hashed. Each business&apos;s data is walled off from every other business inside the database itself, and people only see what their role allows. If a personal data breach happens, we&apos;ll inform you and the Data Protection Board as the law requires.</p>
      <h2>Children</h2>
      <p>Munshiji is for businesses and is not meant for anyone under 18.</p>
      <h2>Contact and grievances</h2>
      <p>Grievance officer: {l.grievanceName}, <a href={`mailto:${l.grievanceEmail}`}>{l.grievanceEmail}</a>. General questions: <a href={`mailto:${l.supportEmail}`}>{l.supportEmail}</a>. We&apos;ll tell you here before making important changes to this policy.</p>
    </LegalLayout>
  );
}
