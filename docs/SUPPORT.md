# Support process

## Channels and targets
| Channel | Where | First reply target |
|---|---|---|
| Email | `MUNSHIJI_SUPPORT_EMAIL` | 1 working day |
| WhatsApp | `MUNSHIJI_SUPPORT_WHATSAPP` (support only, not the order number) | Same working day |
| Grievances (personal data) | `MUNSHIJI_GRIEVANCE_EMAIL` | Acknowledge in 2 working days; resolve within the period the DPDP Rules set |

Set the targets you can actually meet; the help page shows `MUNSHIJI_SUPPORT_HOURS`.

## Severity
- **S1, stop the line:** can't sign in at all, data from one business visible to another, wrong tax on bills being issued, lost data. Respond within 1 hour in support hours; tell affected owners.
- **S2, a key flow is broken:** bills, payments, dispatch or WhatsApp drafts failing. Respond the same day; workaround first.
- **S3, everything else.**

## First checks (no developer needed)
1. `GET /api/health`: database reachable and migrated?
2. `npm run verify`: bill numbers, stock, payments and credit notes consistent for every business?
3. The business's **audit log** and the order's **History**: who did what, when.
4. `outbound_messages` table: were the email or WhatsApp reply sent, skipped or failed (and why)?

## Common fixes
See the in-app Help page (`/support`). Never edit tax records directly in the database: use a credit note.

## Personal data requests
- Copy of data: the person uses **Settings → Your data → Download my data**; business data comes from its owner.
- Correction: the person updates their profile; otherwise correct it on their written request.
- Erasure: **Delete my account**. Business tax records stay for the GST retention period.
- Log each request, the date received and the date completed.

## Personal data breach
1. Contain it (revoke tokens, rotate secrets, block access).
2. Record what happened, which businesses and people are affected, and when you found out.
3. Inform the Data Protection Board of India and the affected people as the DPDP Act and Rules require, within the required time. Get legal advice at once.
4. Fix the cause and add a test that would have caught it.
