# Maharashtra Captive Solar Optimisation Studio

Single-user, no-login planning app for the 7.5 MWp Deoli captive solar plant: current allocation, optimised allocation to existing consumers, a new 132 kV group-captive customer, optional BESS and SPV returns — all under both **ToD-block** and **15-minute** settlement, on identical demand and solar profiles.

## Run locally

```bash
git clone https://github.com/Ergplan/Maharastra-Analysis.git
cd Maharastra-Analysis
npm install
npm run dev          # http://localhost:5173
```

Other commands:

```bash
npm test             # engine tests (node:test, no extra deps) - 16 tests
npm run build        # production build to dist/
npm run typecheck    # tsc over src/
npm run extract      # rebuild src/data/seed/*.json (incl. chettinad_profile.json) from source-files/ (needs python3, openpyxl, poppler-utils)
```

Requirements: Node ≥ 22.6 (tests use Node's built-in TypeScript type-stripping) and npm. Python is only needed to re-run the extraction.

## What is in the box

| Path | Purpose |
|---|---|
| `source-files/` | The original evidence, unmodified: 4 daily-generation workbooks, the landed-cost sheet, the two bill archives |
| `scripts/extract/` | Python ingestion: `extract_generation.py`, `extract_bills.py` (+ `parse_bills.py`), `build_seed_case.py` |
| `src/data/seed/` | Reviewed structured seed data loaded on first launch (`seed_case.json`, plus full `bills.json` and `generation_daily.json`) |
| `src/engine/` | Pure TypeScript calculation engine: `calendar`, `solar`, `profiles`, `settlement`, `bess`, `costs`, `finance`, `scenario`, `optimise`, `summary` |
| `src/engine/__tests__/` | Numerical tests (energy balance, banking fixtures, BESS SOC, IRR fixtures, dedup, unit handling) |
| `src/worker/` | Web Worker that owns the full-year 15-minute arrays; the UI thread only receives summaries |
| `src/tabs/` | The six tabs; `src/components/charts.tsx` holds dependency-free SVG charts |
| `scripts/dev/` | Sandbox helpers used while building (esbuild bundle + Playwright smoke test); not needed with Vite |

## One page — start here

The first tab is a printable one-page summary: plant export, useful solar, lapsing, SPV revenue and savings for three allocations on one representative day — current (factory only), the search's recommendation, and a chosen split with a **Chettinad slider** (default 5 MWp; stores keep their recommended shares, the factory takes the remainder). The ToD-zone chart shows the chosen case. "Print / PDF" uses the browser's print dialog.

## Day view (simple)

The first tab shows one representative day (annual average, or any month's average) for the whole 7.5 MWp plant with **all factories and stores treated as eligible** and solar pooled across them. It draws the ToD-zone supply chart (solar used · in-band credit · grid below the demand line; surplus sold / lapsing above it), a 15-minute timeline, the day's energy balance with losses, and an **Add Chettinad** switch that drops the supplied 15-minute Maharashtra profile (`source-files/Chettinad_Consumption_profile.xlsx` → `src/data/seed/chettinad_profile.json`) onto the residual surplus and reports the gain (extra kWh sold, ₹/yr at ₹2.50, lapsing cut). Existing consumers keep first claim on solar; the new consumer only takes what is left.

## How the model works (short)

- **Calendar** Nov-2025 → Oct-2026, 96 intervals/day, Asia/Kolkata. October has no generation data: it is estimated from the observed daily average (editable).
- **Solar** = the 334 reported daily ABT **export** records (12.210 GWh), spread over a clear-sky-shaped intraday curve normalised to each day's total. The `(FMR − IMR) × 90` convention is preserved and flagged *unverified* (the OA bill lists the Ortusun meter with MF 90, which corroborates it, but no metering certificate was seen). The Jul-8 breakdown stays a zero day unless the separate "recovered availability" case is switched on. Days whose reconstructed peak exceeds the (unverified) MWac placeholder are flagged, never clipped.
- **Loads** come from the bills: factory total site drawal (grid + OA; the 1.5 MW rooftop is behind the meter and excluded), store imports (rooftop self-consumed first), 13-month billing histories. Missing months are projected flat (or seasonally). Intraday shapes are synthetic, calibrated to ToD totals; the factory's shape is tuned so band-wise offsets land within ~10% of the Apr–Jul 2026 bills.
- **Allocation** is a frozen contractual MWp share of every interval's export; Σ ≤ 7.5 MWp. The factory's 58.8% share is *confirmed* from bill injection ÷ plant export; the stores have *unknown* (zero) allocation and are not OA-eligible by default.
- **Settlement** keeps a physical layer (direct use at 15-min) and a settlement ledger: block netting per (month, band) or a chronological in-month bank; withdrawal matrix, deposit cap, banking charge, expiry/compensation are all rule-pack parameters. No annual netting, no credit from future deposits.
- **BESS** is optional; sequential SOC dispatch, charges only from physical surplus (unallocated residual first), compared against S2 without storage. A transparent MW/MWh grid (including zero) picks the best incremental NPV; "No BESS recommended" is a normal outcome.
- **Economics** use a grid-only counterfactual on the same load/PF/category (kVAh = kWh/PF), bridges A → D, landed solar = (PPA + applicable OA charges)/useful kWh. Three perspectives are kept apart: consumer savings, SPV returns, consolidated owner (internal ₹4 cancels).
- **Finance**: 25-year re-dispatch with degradation (exact mode) or year-1 scaled (preview/optimiser); unlevered pre-tax project IRR at ₹30 Cr original capex; incremental NPV where a decision has no outlay; IRR returned as "not defined" rather than fabricated.

## Status, unverified inputs and open rules

See `ASSUMPTIONS.md`. Everything regulatory is labelled **Bill-calibrated / regulatory verification pending**; the MERC 2026 OA and BESS regulations were drafts on 8 Oct 2026 and are not applied.
