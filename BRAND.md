# Munshiji brand guide (in code)

Source: *Munshiji Brand Identity Design System Board*. This file explains how that board is implemented in the app.

## Logo

| Component | Use |
|---|---|
| `<Wordmark height={24} />` | Nav bars, footers, login. `height` is the height of the M. |
| `<Wordmark tone="reverse" />` | On ink-green or dark backgrounds. |
| `<Wordmark tagline height={80} />` | Posters and splash screens only. Below height 80 the tagline gets too small, so set it as text instead (`Business Ka Hisab, Aasaan`, letter-spacing ~0.18em). |
| `<LogoMark size={32} />` | The M on its own, 16px and up. |
| `<LogoTile size={36} />` | M on a soft mint tile (the app’s default). `variant="ink"` gives the dark app-icon tile. |

The logo is pure SVG paths: the M is traced from the board, and the letters are Outfit ExtraBold converted to outlines. It renders the same with or without fonts loaded. The dot over the first *i* is ink; the dots over the *j* and second *i* are green.

Don't recolour the M's two greens, stretch the logo, or put the colour version on busy or mid-tone backgrounds.

## Colour

Neutral base, green as the accent. Dark green and cream are reserved for the logo and mascot; they are not UI surfaces.

| Role | Light | Dark | Tailwind |
|---|---|---|---|
| Page background | `#F3F4F3` | `#0F1211` | `bg-stone-100` |
| Cards | `#FFFFFF` | `#161A18` | `bg-white` |
| Inner tiles, table headers | `#F7F8F7` | `#1C211F` | `bg-stone-50` |
| Lines | `#E6E8E6` | `#262C29` | `border-stone-200` |
| Text / secondary / hints | `#18201C` / `#4B5550` / `#6B746F` | light equivalents | `text-stone-800/600/500` |
| Primary buttons, current bar, active nav | `#1E7F47` | `#4CC17A` | `bg-emerald-600` |
| Soft green surfaces (Munshiji card, logo tile) | `#E9F6EE` | `#15261D` | `bg-emerald-50` |
| Overdue, errors | red scale | red scale | `text-red-700`, `bg-red-50` |

All of this lives in `app/globals.css`. The `stone` and `emerald` scales are re-tuned there, so existing classes follow the design. Dark mode swaps the same tokens (including `white`) and applies only inside the app (`data-theme` on `<html>`, set by the dashboard); the landing page stays light. Owners can switch theme from the sidebar or the phone top bar; the choice is saved on the device.

## Type

Outfit for everything (self-hosted), with Mukta covering Hindi text and the ₹ sign.

- **Scale (only these):** 12 · 13 · 14 · 16 · 18 · 24/28 · 32 px. Body text is 14px; page titles 24px on phones and 28px on desktop; headline figures 28–32px.
- **Numbers:** tabular (aligned) digits everywhere by default, so money lines up in tables. Headline figures use `figure-num` for natural digit spacing and slightly tighter tracking. `font-mono` now means Outfit with tabular digits (no separate monospace face).
- **Labels:** sentence case. No all-caps or tracked-out labels, except on printed documents (e.g. "TAX INVOICE").

## Spacing and shape

- **Spacing** on a 4px rhythm: 4, 8, 12, 16, 20, 24, 32.
- **Cards:** 20px corners, 24px padding (16–20px on phones), soft shadow (`shadow-card`) in light mode, none in dark.
- **Nested corners get smaller inward:** card 20 → tile 12 → control 10 → pill (full).
- **Touch targets** are at least 44–48px on phones.

## UI kit (`components/ui/kit.tsx`)

`Avatar` (initials on a tint chosen from the name, so a customer keeps their colour), `Card`, `StatTile`, `Delta` (change badge with a drawn arrow), `Pill`, `Segmented`, `BarChart` (rounded bars over a track, current period highlighted, empty-state text), `Gauge`, `CountUp`, and `OrdersTable` (table on desktop, cards on phones, search and filters).

## Layout

- **Desktop:** sidebar with business card, search (⌘K / Ctrl+K), sections with count badges, "New order from WhatsApp", and profile with theme and sign-out.
- **Phone:** top bar (business, search, theme) and bottom tabs: Home, Orders, a raised "+" for new orders, Money, More (opens the full menu).
- **Overview order:** the Munshiji card (newest order awaiting confirmation, built from what actually happened, or a prompt to paste one) → today's numbers → money to collect → sales → recent orders. On desktop the first three sit in one row.

## Mascot

From the designer's Mascot Kit, sized for the app (480px tall WebP, sharp up to ~180px on phone screens).

- `<Mascot pose="…" height={120} />` shows the transparent art in light mode and switches to the pale-mint outline version in dark mode automatically. Use `lightOnly` on pages that are always light (landing, login).
- `<MunshijiAvatar size={32} />`: the round head, for places where Munshiji "speaks". Mint in light mode, dark ring in dark mode.
- Files: `public/brand/mascot/{pose}.webp`, `public/brand/mascot/dark/{pose}.webp`, `public/brand/avatar/`, `public/brand/setup/`.

| Pose | Used for |
|---|---|
| `tablet` | Landing hero |
| `waving` | Login; setup step 1 |
| `pointing` | Setup step 2 ("How you work"); GST checklist with problems to fix |
| `thumbs-up` | Order ready to confirm (Overview); setup finished |
| `reading-phone` | While Munshiji reads a WhatsApp message |
| `chai` | Overview when nothing is waiting ("All caught up") |
| `magnifying-glass` | No search results; no orders yet |
| `concerned` | Overdue payment in order details (gentle, never angry) |
| `folded-hands` | Order paid; every bill paid on Money |
| `ledger` | GST figures ready to file |
| `arms-crossed` | Landing closing section |
| `thinking`, `head` | Available, not currently placed |

The setup cards ("Manufacturer", "Shop that delivers", "Something else") use the kit's 2:1 illustrations.

The kit art is enlarged from AI-generated artwork, not redrawn vectors. It is right for app sizes; ask for redrawn art before using it large in marketing or print. Keep the designer's full-resolution kit outside the repo as the master copy.

## Icons

`app/icon.svg` (favicon), `app/favicon.ico`, `app/apple-icon.png` and `public/brand/icons/*` (install icons, including maskable) all use the ink tile with a cream M. The browser theme colour is `#05362A`.
