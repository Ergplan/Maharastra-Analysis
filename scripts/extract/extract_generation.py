"""Extract the daily ABT export series from the four Daily Generation workbooks.

Usage: python3 -I scripts/extract/extract_generation.py source-files src/data/seed/generation_daily.json

Rules (from the build brief):
- Deduplicate by plant/meter/date; exclude opening-reading rows (zero-difference row dated before the
  sheet month) and TOTAL rows from daily energy.
- Preserve reported kWh = (FMR - IMR) * 90 as printed. Do NOT rescale. The headers say MWh but the
  arithmetic only makes sense if the readings are secondary kWh with a meter multiplying factor of 90
  (the Harrshiv OA bill lists the Ortusun ABT meter 100-Q0827721 with MF 90). Flag stays "unverified"
  until the metering certificate is seen.
- Keep cached values AND formulas; note hard-coded rows (no formula) and reading discontinuities.
"""
import sys, json, glob, os, datetime
from openpyxl import load_workbook

src, out = sys.argv[1], sys.argv[2]
records = {}
issues = []
sheets_seen = []
for f in sorted(glob.glob(os.path.join(src, 'Daily_Generation_*.xlsx'))):
    wbf = load_workbook(f)
    wbv = load_workbook(f, data_only=True)
    for ws in wbf.worksheets:
        wv = wbv[ws.title]
        plant = ws['A1'].value
        sheets_seen.append({'file': os.path.basename(f), 'sheet': ws.title, 'plant': plant,
                            'headers': [str(ws.cell(4, c).value).replace('\n', ' ').strip() for c in range(1, 5)]})
        # identify the month the sheet is about = month of the majority of dated rows
        dated = [(r, ws.cell(r, 1).value) for r in range(5, ws.max_row + 1)
                 if isinstance(ws.cell(r, 1).value, datetime.datetime)]
        if not dated:
            continue
        months = {}
        for _, dt in dated:
            months[(dt.year, dt.month)] = months.get((dt.year, dt.month), 0) + 1
        sheet_month = max(months, key=months.get)
        prev_fmr = None
        for r, dt in dated:
            imr_f, fmr_f, diff_f = ws.cell(r, 2).value, ws.cell(r, 3).value, ws.cell(r, 4).value
            imr, fmr, diff = wv.cell(r, 2).value, wv.cell(r, 3).value, wv.cell(r, 4).value
            note = ws.cell(r, 5).value
            key = (plant, dt.date().isoformat())
            is_opening = (dt.year, dt.month) != sheet_month
            if is_opening:
                issues.append({'type': 'opening_row_excluded', 'file': os.path.basename(f), 'sheet': ws.title,
                               'cell': f'A{r}', 'date': dt.date().isoformat(), 'kwh': diff})
                prev_fmr = fmr
                continue
            if diff is None or imr is None or fmr is None:
                issues.append({'type': 'missing_value', 'file': os.path.basename(f), 'sheet': ws.title, 'cell': f'D{r}'})
                continue
            recomputed = (fmr - imr) * 90
            rec = {
                'date': dt.date().isoformat(),
                'kwh_reported': float(diff),
                'imr': float(imr), 'fmr': float(fmr),
                'kwh_recomputed_x90': float(recomputed),
                'formula': diff_f if isinstance(diff_f, str) else None,
                'hardcoded': not isinstance(diff_f, str),
                'note': note,
                'source': {'file': os.path.basename(f), 'sheet': ws.title, 'row': r},
            }
            if abs(recomputed - float(diff)) > 1.0:
                issues.append({'type': 'diff_not_equal_x90', 'file': os.path.basename(f), 'sheet': ws.title,
                               'cell': f'D{r}', 'reported': diff, 'recomputed': recomputed})
            if prev_fmr is not None and abs(float(imr) - float(prev_fmr)) > 0.01:
                issues.append({'type': 'reading_discontinuity', 'file': os.path.basename(f), 'sheet': ws.title,
                               'cell': f'B{r}', 'imr': imr, 'previous_fmr': prev_fmr,
                               'gap_kwh_x90': (float(imr) - float(prev_fmr)) * 90})
            prev_fmr = fmr
            if key in records:
                if abs(records[key]['kwh_reported'] - rec['kwh_reported']) > 0.5:
                    issues.append({'type': 'duplicate_conflict', 'date': rec['date'], 'a': records[key]['source'], 'b': rec['source']})
                else:
                    issues.append({'type': 'duplicate_identical', 'date': rec['date'], 'a': records[key]['source'], 'b': rec['source']})
                continue
            records[key] = rec
        # TOTAL row check
        for r in range(5, ws.max_row + 1):
            if any(str(ws.cell(r, c).value).strip().upper() == 'TOTAL' for c in (1, 3) if ws.cell(r, c).value):
                tot = wv.cell(r, 4).value
                mine = sum(v['kwh_reported'] for k, v in records.items() if v['source']['sheet'] == ws.title and v['source']['file'] == os.path.basename(f))
                if tot is not None and abs(float(tot) - mine) > 1.0:
                    issues.append({'type': 'total_row_mismatch', 'file': os.path.basename(f), 'sheet': ws.title, 'cell': f'D{r}', 'sheet_total': tot, 'sum_daily': mine})

days = sorted(records.values(), key=lambda x: x['date'])
monthly = {}
for d in days:
    m = d['date'][:7]
    monthly[m] = monthly.get(m, 0.0) + d['kwh_reported']
total = sum(d['kwh_reported'] for d in days)
out_obj = {
    'plant': sheets_seen[0]['plant'] if sheets_seen else None,
    'series_type': 'daily ABT meter EXPORT (kWh), reported = (FMR - IMR) x 90',
    'meter_factor': {'value': 90, 'status': 'unverified',
                     'note': 'Column headers say MWh but the daily difference formula multiplies by 90. Consistent with a secondary-kWh ABT meter with MF 90; the Harrshiv OA bill (Jul-2026, Open Access Permissions table) lists Ortusun meter 100-Q0827721 with MF 90. Treat as provisional until the metering certificate is documented.'},
    'capacity_dc_mwp': 7.5,
    'days': days,
    'n_days': len(days),
    'date_range': [days[0]['date'], days[-1]['date']] if days else None,
    'total_kwh_reported': total,
    'monthly_kwh': monthly,
    'flat_annualisation_kwh': total / len(days) * 365 if days else None,
    'zero_days': [d['date'] for d in days if d['kwh_reported'] == 0],
    'issues': issues,
    'sheets': sheets_seen,
}
os.makedirs(os.path.dirname(out), exist_ok=True)
json.dump(out_obj, open(out, 'w'), indent=1, default=str)
print(len(days), 'days', round(total, 4), 'kWh; months:', {k: round(v, 3) for k, v in monthly.items()})
print('issues:', len(issues))
for i in issues: print(' ', i)
