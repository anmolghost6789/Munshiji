# Munshiji — Business Ka Hisab, Aasaan

**Lightweight order management for Indian SMBs who receive orders on WhatsApp.**

Munshiji (मुंशीजी) — your trusted digital business clerk. Paste a WhatsApp message in Hindi, Hinglish, or English, and the AI parses it into a structured order with customer matching, product catalog pricing, and GST-compliant invoicing.

## Tech Stack

- **Next.js 15** (App Router) + TypeScript
- **PostgreSQL** via `pg` for persistent local storage
- **Munshiji design system** — Outfit + Mukta (self-hosted), neutral palette with green accent, light and dark modes (see `BRAND.md`)
- **Mobile-first** responsive design with safe-area support
- **Azure OpenAI** (GPT-4o) via Vercel AI SDK for multilingual order parsing
- AI-ready architecture for Claude integration via Vercel AI SDK

## Features

### 1. WhatsApp Order Parsing
- Paste raw WhatsApp messages (Hindi / Hinglish / English)
- AI extracts: customer name, phone, address, line items, quantities, delivery date, notes
- Matches customers against existing records or flags as new
- Matches products against catalog with pre-set prices
- Common Hinglish aliases: "cheeni" → Sugar, "sarson" → Mustard Oil, etc.

### 2. Product Catalog (CRUD)
- Name (English + Hindi), SKU, unit (kg/bag/piece/box/dozen/quintal), price
- Used by parser to auto-fill pricing

### 3. Customer Directory
- Auto-built from orders
- Order count, total value, outstanding balance
- GSTIN fields for B2B

### 4. Order Tracking
- States: New → Confirmed → Preparing → Dispatched → Delivered → Invoiced → Paid → Overdue
- Filter by state, search by ID/customer/product
- Detail drawer with original WhatsApp message, progress tracker

### 5. GST-Compliant Invoicing
- Professional tax invoice preview
- CGST + SGST breakdown
- Bill To with GSTIN
- Amount in words

### 6. KREDS Export (UI ready)
- Select invoices for bundled export
- Track submission status

## Pilot readiness

See **`PILOT.md`** for deployment, backups, restore, WhatsApp setup and roles. Key points:
- Multi-business: sign-up creates a business; owners invite their team by single-use link; one person can belong to several businesses with a role in each. Isolation is enforced by PostgreSQL Row-Level Security (the app connects as a role that can't bypass it). Roles checked on every API call; audit log per business.
- All orders, stock, bills and payments go through `lib/core/*` in database transactions; saves are safe to retry.
- PostgreSQL (`DATABASE_URL`); schema in `migrations/`, applied with `npm run db:migrate`. Runs on Vercel or EKS.
- `npm test` (104 tests on real Postgres, including concurrency, business isolation, email, WhatsApp linking, credit notes, e-invoicing, e-way bills and data rights), `npm run backup`, `npm run restore`, `npm run verify`.

## Business setup and GST (pilot MVP)

Munshiji adapts to the business instead of assuming manufacturing. Nothing in this section needs an external service.

**Capabilities, not business types** (`lib/business.ts`). Setup asks plain questions — do you make products, buy raw materials, confirm orders, deliver, give credit — and stores the answers as capabilities. Screens check capabilities (`caps.purchases`), never the business type. Templates are starting bundles of answers plus wording:

| Template | Shows | Order steps | Wording |
|---|---|---|---|
| Manufacturer (default, original behaviour) | Everything incl. materials, purchases, TReDS | New → Confirmed → In Production → Dispatched → Delivered → Invoiced → Paid | Buyers |
| Shop that delivers | Orders, money, catalog, customers | New → Packing → Out for delivery → Delivered → Invoiced → Paid | Customers |
| Something else | Whatever the answers switch on | Based on answers | Based on answers |

Existing databases migrate to the Manufacturer template with every capability on, so they behave exactly as before. "New", "Delivered", "Invoiced" and "Paid" are anchor steps and always present.

**GST rules in one place** (`lib/gst.ts`): registration type (regular → tax invoice; composition → bill of supply, no GST; not registered → plain invoice), IGST vs CGST/SGST from place of supply, current rates (0/3/5/18/40, with 12%/28% flagged), offline GSTIN checksum validation (state and PAN are read from the GSTIN), composition rates and the B2CL threshold. Tax is always recalculated on the server when an order is saved. **Have a CA review this file** before launch and after GST changes.

**GST page** (`lib/gst-returns.ts`, `/api/gst-returns`): prepares GSTR-1 (B2B, B2CL, B2CS, HSN summary with CSV downloads), a GSTR-3B summary with input credit from purchases, or CMP-08 for composition businesses, plus a checklist of problems to fix before filing. It does not file — that needs a GSP connection (planned after the pilot).

**Getting paid**: add a UPI ID in Settings and bills (preview and PDF) carry a scan-to-pay QR with the amount filled in. Unpaid orders get a "Send payment reminder on WhatsApp" button. Both work without any payment provider.

**Not in the pilot**: GSP connection (GSTIN lookup, filing, GSTR-2B/IMS), payment-provider links and automatic "paid" marking, counter/POS billing, credit notes, e-invoicing, multiple GSTINs or businesses per account. Munshiji does not offer financing.

## Getting Started

```bash
npm install
cp .env.example .env.local        # set DATABASE_URL (app role), MIGRATE_DATABASE_URL (owner role), NEXTAUTH_SECRET
npm run db:migrate                # creates the schema in your Postgres database
npm run dev                       # or: npm run build && npm start
npm test                          # needs a local Postgres (TEST_PG_ADMIN_URL, default postgres@localhost via /tmp socket)
```

A new database starts empty. Anyone can create an account, which creates their business; they invite their team from Settings → Team. See `PILOT.md` for the two database roles, Vercel and EKS.

### Environment Variables (REQUIRED)

```env
AZURE_OPENAI_ENDPOINT=https://your-resource.openai.azure.com
AZURE_OPENAI_API_KEY=your-api-key
AZURE_OPENAI_DEPLOYMENT=gpt-4o
AZURE_OPENAI_API_VERSION=2024-08-01-preview  # optional
```

Order parsing uses Azure OpenAI (GPT-4o) via the Vercel AI SDK's `createOpenAI` with a custom `fetch` override — the same pattern from the docforge PDF generator reference project. The product catalog and customer directory are injected into the system prompt so the AI matches against your real data.

## Project Structure

```
munshiji-app/
├── app/
│   ├── api/
│   │   ├── orders/route.ts      # CRUD for orders
│   │   ├── products/route.ts    # CRUD for products
│   │   ├── customers/route.ts   # Customer listing + stats
│   │   ├── parse/route.ts       # WhatsApp message parser
│   │   ├── gst-returns/route.ts # GSTR-1 / 3B / CMP-08 preparation + CSV
│   │   └── invoice-pdf/route.ts # Invoice generation
│   ├── layout.tsx               # Root layout
│   ├── page.tsx                 # Main page
│   ├── globals.css              # Brand tokens, fonts, base styles
│   ├── icon.svg / apple-icon.png / favicon.ico
│   └── manifest.ts              # Installable-app manifest
├── components/
│   ├── app-shell.tsx            # Main client app (all views)
│   ├── icons.tsx                # SVG icon components
│   └── brand/                   # Logo (mark, tile, wordmark) + Mascot
├── lib/
│   ├── db.ts                    # PostgreSQL schema, migrations + queries
│   ├── business.ts              # Capabilities, templates, order steps, wording
│   ├── gst.ts                   # GST rules: rates, GSTIN, place of supply, bill types
│   ├── gst-returns.ts           # Return preparation + checklist
│   └── types.ts                 # Shared types + constants
├── data/                        # PostgreSQL DB (auto-created)
└── package.json
```

## Design System

See **`BRAND.md`** for the full brand guide. In short:
- Typography: Outfit for everything with tabular digits for money, Mukta for Hindi and ₹, self-hosted in `public/fonts`; a fixed 7-step type scale
- Colour: neutral greys with brand green as the accent, light and dark modes; the Tailwind `stone` and `emerald` scales are re-tuned in `app/globals.css`
- Components: `components/ui/kit.tsx` (avatars, stat tiles, charts, orders table)
- Logo and mascot: `import { Wordmark, LogoMark, LogoTile, Mascot } from "@/components/brand"`
- Mobile: Bottom-sheet modals, safe-area padding, 44px touch targets
- Accessibility: Brand-green focus rings, AA contrast on buttons, reduced motion respected

## Indian Business Context

- ₹ INR currency formatting with Indian comma grouping
- GST: CGST + SGST split on invoices
- GSTIN fields on customers
- Units: kg, gram, litre, piece, box, bag, dozen, quintal
- Hinglish parsing: "50 kg aata bhejo kal tak"
