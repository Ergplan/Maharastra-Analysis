# Assumptions and unresolved data — concise note

## Supplied inputs (used as given)
- 7.5 MWp DC plant; solar capex ₹4 Cr/MW → ₹30 Cr; existing consumers' PPA ₹4.00/kWh; new 132 kV customer ₹2.50/kWh; BESS ₹1 Cr/MWh nameplate (PCS assumed included, installation/connection adders explicit and default 0).
- Observed consumption trend continued through the year (flat daily-average projection by default; seasonal option available).

## Evidence-derived (tagged `extracted_actual` / `derived_from_actual`)
- Daily ABT export Nov-25 → Sep-26: 334 days, 12,210,422.17 kWh; monthly totals match the workbook TOTAL rows; opening-reading row (31-Oct-25) excluded; Jul-8 = 0 kWh "Breakdown".
- Factory (411639023090) monthly drawal, grid units, OA injection/offset/over-injection, rooftop generation, FY27 rates (₹8.44/kVAh, ₹650/kVA, zone-D +₹2.11, FAC 0.20–0.50, ToSE 27.9 p, OA wheeling ₹0.81/kWh injected, transmission ₹1.022/kWh offset, operating ₹16,500/month).
- Stores (7 × LT-II(C)): kWh/kVAh, PF, ToD split, FY27 rates (₹14.89/kVAh, ₹550/kVA, 09-17 −₹2.2335, 17-24 +₹3.7225, wheeling ₹1.52, ED 21%, ToSE 28.94/27.90 p), 13-month unit history, rooftop kW where present.
- Factory allocation share = 58.8% of plant export (Dec-25…Jul-26 monthly ratios 0.57–0.60; Nov-25 0.86 excluded as commissioning month).

## Assumptions (tagged `user_assumption` / `synthetic_estimate` / `modelling_assumption`)
- Inverter/export ceiling 6.5 MWac placeholder — **unverified**; used only for flagging.
- ×90 meter factor — **unverified** (corroborated by OA bill meter MF 90, not by a certificate); override + sensitivity provided.
- Factory intraday shape: 24×7 with 1.3× daytime weight (calibrated to Apr–Jul 2026 billed offsets). Dec–Feb bills cannot be reproduced by band-wise netting (they book all residual units in zone D) — flagged in the bill review.
- HT zone-C (09-17) rebate −₹1.50/kVAh assumed (no zone-C grid units on any bill).
- In-kind network losses default 0% (bills show 3–6% injection–offset–over-injection gap, but MSEDCL is separately billing losses in ₹ under the APTEL ruling; set 0 to avoid double counting; editable).
- Rule pack: adjustment period = month, same-band withdrawal only, no banking charge, no compensation for lapsed energy, 100% deposit cap — all inferred from bill behaviour, none confirmed against a notified regulation.
- New customer: 4 MW 24×7 synthetic load, HT-I(A) rates as illustrative avoided tariff, 33 kV wheeling applied on the injection leg, CSS/AS 0 (group-captive compliance not verified; CSS sensitivity input exists).
- Finance: 25-y life, 0.5%/y degradation, O&M 1.5% of capex +5%/y, zero PPA escalation, 10% discount rate, 30-day receivables, no tax/depreciation/debt, no terminal value, BESS life 12 y with like-for-like replacement, BESS O&M 2%.
- Stores are **not** OA-eligible by default (LT, < 1 MW, no permission on bills). The toggle exists for what-if only.

## Open items to resolve before contracting
1. Settlement granularity MSEDCL will apply going forward (block vs 15-minute) and whether MERC Distribution OA Regulations 2026 (draft on 8-Oct-2026) change banking/compensation.
2. Compensation, if any, for over-injected energy (32.8 lakh units lapsed Nov-25 → Jul-26 with no credit line).
3. Statutory basis for ToSE on captive OA units (charged from Feb-26).
4. Group-captive ownership and consumption-proportionality evidence for the new consumer.
5. Metering certificate (MF 90) and inverter/approved export capacity.
6. Bill disputes excluded from recurring savings: recurring ₹9.04 L debit adjustments, ₹80.5 L wheeling/transmission-loss supplementary, Dec–Feb zone-D booking, missing rooftop credit after Nov-25, store SD interest.

## Known limitations of this build
- Charts are hand-rolled SVG (no Recharts) and styling is plain CSS (no Tailwind) so the app has only `react`/`react-dom` runtime dependencies; tests use `node:test` instead of Vitest.
- The optimiser is a bounded coordinate-descent grid ("best evaluated scenario"); no LP solver is bundled.
- Within-day load shapes are synthetic; import of real 15-minute interval data is a planned extension (engine contracts already take per-interval arrays).
- Preview results scale year-2+ finance by degradation; the exact 25-year re-dispatch runs in the background for the selected settlement mode (~1 s per scenario).
