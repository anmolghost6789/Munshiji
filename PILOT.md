# Munshiji — Telix pilot runbook

Goal: 50 real orders over two weeks with no duplicate bills, correct stock balances and no developer intervention.
This file is for whoever deploys and supports the pilot.

## 1. What's in the pilot

| Area | What works | Not in the pilot |
|---|---|---|
| Orders | Paste or type orders; WhatsApp forwards become drafts for approval; every line checked against the catalog; edit until dispatch; cancel (stock goes back) | Cancelling an order after its bill is made (needs a credit note) |
| Stock | Trading SKUs: purchase receipts add stock, dispatch deducts it once, stock counts with a reason, full history per item | Production (raw materials → finished goods) for Telix |
| Bills | One bill per order, numbers `PREFIX/YY-YY/NNNN` consecutive per financial year (IST), can continue Telix's existing series | E-invoicing (IRN), e-way bills |
| Payments | Part payments, balances, reminders with UPI QR, owner can remove a mistaken payment | Automatic "paid" from a bank or payment provider |
| GST | GSTR-1 / GSTR-3B / CMP-08 figures prepared from bills, CSV downloads | Filing from Munshiji (file on the GST portal or via your CA) |

Munshiji does not offer financing and makes no promises about when buyers pay.

## 2. Deploy

Munshiji runs on **PostgreSQL 14+** and is stateless otherwise, so it can run on Vercel or as several pods on EKS.
It is multi-business: anyone can sign up and create a business; owners invite their team by link; one person can belong to several businesses.

**Data isolation** is enforced by PostgreSQL Row-Level Security on every business table. Two database roles:
- the **owner** role (owns the tables): runs migrations, backups and restores (`MIGRATE_DATABASE_URL`);
- the **app** role (`DATABASE_URL`): `LOGIN NOSUPERUSER NOBYPASSRLS`, with `SELECT, INSERT, UPDATE, DELETE` on all tables and `USAGE` on sequences. Superusers and BYPASSRLS roles skip isolation, so never run the app as one.

```sql
CREATE ROLE munshiji_app LOGIN PASSWORD '…' NOSUPERUSER NOBYPASSRLS;
GRANT USAGE ON SCHEMA public TO munshiji_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO munshiji_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO munshiji_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO munshiji_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO munshiji_app;
```
Schema changes are versioned files in `migrations/`, applied by `npm run db:migrate` (safe to run repeatedly; a database lock stops two deploys migrating at once). Migrations run at deploy time, never during requests.

### Vercel (demo)
1. Add a Postgres database from the Vercel Marketplace (Neon). Use the **pooled** connection string as `DATABASE_URL`.
2. Create the app role (above) in Neon's SQL editor. Set `DATABASE_URL` to the app role's **pooled** URL and `MIGRATE_DATABASE_URL` to the owner role's URL, plus `NEXTAUTH_URL` and `NEXTAUTH_SECRET`.
3. Deploy. Vercel runs `npm run vercel-build`, which migrates the database and then builds.
4. WhatsApp reading continues after the webhook replies via Vercel's `waitUntil`; login lockouts are stored in Postgres, so they hold across instances.

### EKS / EC2 (production)
1. Database: **Amazon RDS for PostgreSQL** in the same VPC, private subnets only, with automated backups (7–35 days) and point-in-time recovery switched on. Enforce SSL.
2. Run `npm run db:migrate` as a Kubernetes **Job** with `MIGRATE_DATABASE_URL` (owner role) before rolling out a new image. The app pods get only `DATABASE_URL` (app role).
3. App: `npm ci && npm run build`, then `npm start` (port 3000) in any number of replicas behind an HTTPS load balancer. Liveness/readiness probe: `GET /api/health`.
4. Put secrets (`DATABASE_URL`, `NEXTAUTH_SECRET`, `WHATSAPP_APP_SECRET`) in AWS Secrets Manager or Kubernetes secrets, not in the image.
5. Size `PG_POOL_MAX × replicas` below the database's connection limit (or add RDS Proxy).

The app refuses to start in production without a strong `NEXTAUTH_SECRET`. No demo data is ever loaded; a new database starts empty.
The database time zone should be UTC (the default on RDS and Neon).

## 3. First day

1. Open the site → **New to Munshiji → Set up my business**: your name, business name, email and password. That creates the business with you as owner.
2. Setup: GSTIN (checked automatically) and how you work.
3. **Settings → Bill numbers:** if the business already issued bills this financial year, set the prefix and the *next* number before the first bill. This locks once a bill exists.
4. **Your team joins** in one of two ways:
   - **Invite:** Settings → Team → Invite someone (role; email optional). Share the link or read out the short code (e.g. KE-7BTN-3H). They choose **New to Munshiji → Join my team** and type the code, or open the link. Each invite works once and expires in 7 days; if you entered an email, only that email can use it.
   - **Ask to join:** they choose **Join my team**, create their account, and enter your phone number or email. You see "1 person wants to join your team" on the Overview (and get an email); choose their role and tap **Let in**, or **Decline**. Nobody gets in without an owner's approval, and the person asking can't tell whether a phone or email belongs to a Munshiji business.
5. **Catalog:** add every product with rate, HSN and GST rate, and opening stock.
6. **Stock → Record purchase** for goods received from suppliers.

Running more than one business (or a CA serving clients)? Use the business card at the top of the sidebar to switch, or **Create another business**. Each business's orders, stock, bills, numbering and team are completely separate.

| Role | Can |
|---|---|
| Owner | Everything, including team, settings and removing a payment |
| Manager | Orders, bills, payments, stock, catalog, GST; change rates |
| Staff | Create and edit orders, move them through packing, dispatch and delivery; no money figures, bills, payments or rate changes |

## 4. Daily operations

- **Backups:** on RDS/Neon, the provider's automated backups and point-in-time restore are the first line. Also keep a provider-independent copy: `npm run backup` with `DATABASE_URL` set to the **owner** role (needs `pg_dump`) writes a verified `pg_dump` file; schedule it nightly from a CI job or ops machine and copy the files off-site.
- **Health check:** `npm run verify` (app role is fine; it checks each business in turn) exits non-zero and lists problems if any of these are wrong: duplicate bill numbers, gaps in bill numbers, an order with two bills, negative stock, stock not matching its history, overpayments, payments not matching orders, a paid order with a balance, a cancelled order with a bill. Schedule it daily and alert on failure.

## 5. Restore

- **RDS/Neon:** restore to a point in time from the console into a new instance, point `DATABASE_URL` at it, run `npm run verify`.
- **From a `pg_dump` file:** scale the app to zero, then with the owner role's `DATABASE_URL` and `MUNSHIJI_APP_ROLE=munshiji_app`: `npm run restore -- backups/munshiji-YYYYMMDD-HHMMSS.dump --yes` (a safety dump of the current database is taken first), `npm run verify`, scale back up.

Anything entered after the backup must be re-entered. Rehearsed in `tests/backup.test.ts`.

## 6. Email and WhatsApp

**Email (Resend).** Create a Resend account, verify your sending domain, and set `RESEND_API_KEY` and `MUNSHIJI_EMAIL_FROM` (`RESEND_FROM` or `EMAIL_FROM` also work). Then open **Settings → Email** and tap **Send a test email to me**: it shows Resend's exact answer, and lists what happened to recent emails. With only the API key set, Resend's test sender is used, which delivers only to the email that owns your Resend account.
Munshiji then emails: password-reset links (single-use, 1 hour; resetting signs the person out everywhere), sign-up confirmation, and team invites.
Without these settings nothing breaks: invites still show a link to share, and every attempt is logged in `outbound_messages`.

**WhatsApp (one shared Munshiji number).** Businesses don't need their own WhatsApp Business setup. Each person forwards buyers' messages from their own WhatsApp to the Munshiji number.
1. In Meta for Developers: an app with **WhatsApp**, the Munshiji number added; note its **phone number ID** and **app secret**, and create a **system user** token with `whatsapp_business_messaging`.
2. Webhook URL `https://<your-domain>/api/whatsapp/webhook`, verify token = `WHATSAPP_VERIFY_TOKEN`; subscribe to **messages**.
3. Set `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ACCESS_TOKEN`, `MUNSHIJI_WHATSAPP_NUMBER`; redeploy.
4. Each person links their number once: **Settings → Your profile → WhatsApp number → Link number**, then sends the `LINK 123456` code shown from that phone (on a phone, **Open WhatsApp** fills it in). This proves they hold the number; unlinked or unproven numbers are never accepted.
5. Forwarded orders get an instant reply ("Mila ✓ …") and appear under **Orders → From WhatsApp** as drafts. Nothing becomes an order until someone approves it.

Munshiji only replies to people who just messaged it (inside WhatsApp's 24-hour window), so no message templates are needed. Unknown numbers get at most one "not linked" reply a day.

## 7. Compliance and legal, before going live

- **CA review:** `docs/CA-REVIEW.md` lists every GST rule Munshiji applies, with worked examples and the open questions. A CA should sign it off. Consumer orders ask for the delivery state, so out-of-state consumer sales are billed IGST.
- **E-invoicing:** if a business crossed ₹5 crore (AATO) in any year since 2017-18, turn on **Settings → GST documents → E-invoicing applies**. Bills to registered buyers then show "IRN needed" until the IRN from the IRP is recorded on them.
- **E-way bills:** dispatch above the threshold (₹50,000 incl. GST by default) needs the e-way bill number and vehicle, or a stated exemption, in the order's **Transport** section. Generate the e-way bill on the portal.
- **Credit notes:** from a billed order → **Issue credit note** (returns, short supply, price change, excess tax). They feed GSTR-1 (CDNR/CDNUR/B2CS), HSN and GSTR-3B.
- **Legal:** set the company details in `.env` (see `.env.example`); have a lawyer review `/terms` and `/privacy`; then set `MUNSHIJI_LEGAL_REVIEWED=1` to remove the draft notice. Sign-up records which terms version each person accepted.
- **Data rights:** people download or delete their data in **Settings → Your data**; owners can download their business's data. Closed businesses keep tax records for the GST retention period; plan a yearly purge of records past that period.
- **Support:** follow `docs/SUPPORT.md`; the public help page is `/support`.
- **WhatsApp:** `docs/WHATSAPP-META-SETUP.md` (Meta business verification and the Cloud API).

## 7b. If everyone landed in one business after the multi-business update

Databases created by early versions contained a demo business (e.g. "Sharma Corrugated Industries"). The multi-business update converted that single business and made every existing user a member of it. To give people their own businesses back, run (as the database owner role):

```
DATABASE_URL=<owner role URL> npm run repair:split-business -- --business "Sharma Corrugated Industries" --keep owner@example.in
```

It prints the plan and changes nothing; add `--yes` to apply. The people you keep stay; everyone else leaves that business (keeping any other business they belong to), and anyone left without one gets a new, empty business they own. Nothing is deleted. Alternatively, the owner can remove people in Settings → Team; they'll be offered "Create your business" when they next sign in.

## 8. When something looks wrong

| Situation | Fix (no developer needed) |
|---|---|
| Stock is wrong after a physical count | Stock → item → **Count**, with a reason |
| A payment was entered by mistake or a cheque bounced | Owner: open the order → Payments → **Remove**, with a reason |
| An order has wrong items | **Edit** it (until dispatch); after dispatch, cancel (if no bill) and re-enter |
| Wrong buyer or item before the bill | Edit or cancel the order |
| Bill made for the wrong order | Not reversible in Munshiji; issue a credit note with your CA and note it |
| Someone left | Settings → Team → **Remove** (takes effect immediately; their other businesses are unaffected) |
| Who changed what? | Order → **History**, or the audit log (owner/manager) |

## 9. Evidence

- `npm test`: 104 automated tests, including 12 that prove businesses can't see or change each other's data, each on a fresh Postgres database with the real migrations, including concurrency tests (simultaneous dispatches, bill clicks, saves and payments) and a two-week simulation of 50 orders with retries, double taps, edits, cancellations, stock shortages, part payments and a bounced cheque. It checks exactly 50 orders, consecutive bill numbers, stock equal to an independent model and to its history, and no payment inconsistencies.
- `tests/backup.test.ts`: backup while running, drop the whole schema, restore, verify, continue numbering.
- A browser run-through on a production build against Postgres (owner setup → team → purchase → staff order → dispatch → manager bill → part and full payment → WhatsApp draft → approval) with screenshots.
