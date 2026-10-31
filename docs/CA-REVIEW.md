# GST rules in Munshiji: review pack for a Chartered Accountant

**Purpose.** Munshiji makes bills, credit notes and GST return figures from a business's records. This pack lists every GST rule the software applies, with worked examples taken from its automated tests, so a CA can confirm or correct each one. Nothing here has been reviewed by a CA yet. Please mark each row **OK**, **Change** (with the correct rule) or **Out of scope**.

Code: `lib/gst.ts` (rates, tax split, GSTIN), `lib/core/money.ts` (bills), `lib/core/gstdocs.ts` (credit notes, e-invoice, e-way bill), `lib/gst-returns.ts` (GSTR-1, GSTR-3B, CMP-08). Tests: `tests/gst-compliance.test.ts`, `tests/place-of-supply.test.ts`, `tests/money.test.ts`.

## Open questions (known gaps; please advise)

1. **Place of supply for unregistered buyers** (implemented; please confirm). For buyers without a GSTIN, Munshiji asks for the **delivery state** and uses it as the place of supply (IGST Act s.10(1)(a)); it defaults to the buyer's last delivery state, else the seller's state. Registered buyers always use their GSTIN state (s.10(1)(b) covers bill-to-ship-to).
2. **Ship-to for registered buyers**: the place of supply follows the buyer's GSTIN state even when goods go elsewhere (bill-to-ship-to). Confirm this suits your clients.
3. **Exports, SEZ, reverse charge, nil/exempt categories beyond 0%**: not supported.
4. **Rounding**: tax is computed per line and rounded to paise; the bill total is the exact sum (no rounding off to the rupee). Is rounding off required for your clients?
5. **Post-sale discounts**: credit notes for discounts are allowed by value, but Munshiji doesn't check the conditions of s.15(3)(b) (agreement in advance, linked invoices), as amended by the Finance Act 2026. Should it ask for the agreement reference?
6. **E-invoicing 30-day reporting limit** for larger taxpayers: Munshiji warns about bills without an IRN but doesn't enforce the 30-day limit.
7. **Annual-return date for credit notes**: the 30 November limit is enforced; the earlier limit (date of filing GSTR-9) can't be known by Munshiji and is the owner's responsibility.

## Rules applied

| # | Rule | How Munshiji applies it | Example (from tests) | CA |
|---|---|---|---|---|
| 1 | GSTIN validity | 15 characters, checksum verified, state from first 2 digits, PAN from characters 3–12 | `27AAPFU0939F1ZV` valid (Maharashtra); last character changed → rejected | |
| 2 | Rates | Slabs 0, 3, 5, 18, 40%. Products at 12% or 28% (abolished 22 Sep 2025) are flagged on the GST page | — | |
| 3 | Intra-state supply | CGST and SGST, each half of the rate | 100 × ₹42 + 200 × ₹28 = ₹9,800; CGST ₹882 + SGST ₹882 | |
| 4 | Inter-state supply | IGST at the full rate when the place of supply (buyer GSTIN state, or delivery state for consumers) ≠ seller state | Karnataka registered buyer, ₹2,800 → IGST ₹504; Karnataka consumer delivery, ₹2,800 → IGST ₹504; Pune consumer → CGST ₹252 + SGST ₹252 | |
| 5 | Document type | Regular: "Tax Invoice". Composition: "Bill of Supply", no tax. Unregistered seller: "Invoice", no tax | — | |
| 6 | Bill numbers | Consecutive per financial year (IST): `PREFIX/YY-YY/NNNN`, ≤ 16 characters, never repeated or skipped; can continue an existing series | `TLX/26-27/0245`, `0246`, `0247`; 1 Apr 2027 → `TLX/27-28/0001` | |
| 7 | Bill date | The date the bill is made, in IST. Can't be back-dated | — | |
| 8 | Credit notes: when | Only against an issued bill; until 30 November after the end of the bill's financial year | Bill 26 Oct 2026 → by 30 Nov 2027; bill 31 Mar 2027 → by 30 Nov 2027; bill 1 Apr 2027 → by 30 Nov 2028 | |
| 9 | Credit notes: how much | Returns/short supply by quantity at the billed rate; price reduction/discount/excess tax by taxable value. Never more than billed, per line and in total | 25 of 100 rolls at ₹42 → ₹1,050 + CGST ₹94.50 + SGST ₹94.50 = ₹1,239; a 26th of the remaining 75 is refused | |
| 10 | Credit notes: tax | Same rates and same split (CGST/SGST or IGST) as the original bill; no tax on credit notes against bills of supply | Karnataka bill, 50 boxes returned → IGST ₹252 | |
| 11 | Credit notes: numbering | Separate consecutive series per financial year: `CN/YY-YY/NNNN` | `CN/26-27/0001`, `0002` | |
| 12 | GSTR-1 B2B | Bills to buyers with a valid GSTIN | — | |
| 13 | GSTR-1 B2CL | Inter-state bills to unregistered buyers above ₹1,00,000 (by delivery state) | Tamil Nadu consumer, ₹1,12,000 + IGST ₹20,160 → B2CL | |
| 14 | GSTR-1 B2CS | Other consumer bills, summarised by place of supply and rate; consumer credit notes reduce it | — | |
| 15 | GSTR-1 CDNR / CDNUR (Table 9B) | Credit notes to registered buyers → CDNR; against B2CL bills → CDNUR; reported in the month the note is issued | 4 credit notes to registered buyers, taxable ₹420, ₹1,050, ₹1,400, ₹2,000 | |
| 16 | HSN summary | By HSN, rate and unit; net of credit notes | — | |
| 17 | GSTR-3B outward | Taxable value and tax from bills, minus credit notes, for the month | Outward taxable = bills − credit notes, checked to the paisa | |
| 18 | GSTR-3B input credit | From purchase receipts with a valid supplier GSTIN; flagged that only GSTR-2B credit can be claimed | — | |
| 19 | CMP-08 | Quarterly turnover × composition rate (1%, 5% or 6%), split half CGST, half SGST | — | |
| 20 | E-invoicing applies | Owner switches it on when AATO (all GSTINs under the PAN) exceeded ₹5 crore in any FY since 2017-18; it stays on | — | |
| 21 | E-invoice scope | Bills and credit notes to buyers with a valid GSTIN need an IRN; consumer bills don't | B2B bill → IRN required; walk-in buyer → not | |
| 22 | IRN recording | IRN (64 hex), acknowledgement number and date, signed QR, copied from the IRP; printed on the bill with the QR; credit notes on a bill need the bill's IRN first | Malformed IRN refused; second IRN for the same bill refused | |
| 23 | E-way bill threshold | Consignment value including GST above ₹50,000 (owner can set a different intra-state limit) | ₹66,080 consignment blocked at dispatch until e-way bill and vehicle are entered | |
| 24 | E-way bill Part B | Vehicle number or transporter ID required before dispatch; exemptions recorded with a reason (including under 50 km to the transporter) | — | |
| 25 | E-way bill number | 12 digits, recorded on the order and printed on the bill; generated on the portal (Munshiji doesn't generate it) | `3410 1234 5678` accepted; `12345` refused | |

## How to check a sample

Ask the business for one month's bills from Munshiji, the GSTR-1 CSVs from its GST page, and its GSTR-2B. Compare totals by section (B2B, B2CL, B2CS, CDNR, HSN). Run `npm run verify` on the database to confirm bill numbers have no gaps or repeats.

Reviewed by: ______________________ (CA, membership no. ________)   Date: __________
