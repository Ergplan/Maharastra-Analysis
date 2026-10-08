"""Unzip the MSEDCL bill archives, convert each PDF to text (pdftotext -layout) and parse.

Usage: python3 -I scripts/extract/extract_bills.py source-files/Harrshiv_OA_Bills.zip source-files/Elec._Bills-_Stores.zip src/data/seed/bills.json

Requires poppler-utils (pdftotext). Deduplicates by (consumer, billing month as printed in the bill);
file names are NOT trusted for the bill period. Combined PDFs are split logically by page
(reading-date month binds consumption pages to the right header page).
"""
import sys, os, json, zipfile, subprocess, tempfile, glob
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from parse_bills import parse_oa, parse_lt, split_lt_bills  # noqa: E402

oa_zip, lt_zip, out = sys.argv[1], sys.argv[2], sys.argv[3]
work = tempfile.mkdtemp(prefix='bills_')
res = {'oa': [], 'lt': [], 'files': [], 'duplicates': []}
seen = {}
for kind, z in (('oa', oa_zip), ('lt', lt_zip)):
    d = os.path.join(work, kind); os.makedirs(d, exist_ok=True)
    with zipfile.ZipFile(z) as zf: zf.extractall(d)
    for pdf in sorted(glob.glob(os.path.join(d, '**', '*.pdf'), recursive=True)):
        rel = os.path.relpath(pdf, d)
        txt = subprocess.run(['pdftotext', '-layout', pdf, '-'], capture_output=True, text=True).stdout
        npages = txt.count('\f') + (0 if txt.endswith('\f') else 1)
        res['files'].append({'archive': os.path.basename(z), 'file': rel, 'pages': npages})
        if kind == 'oa':
            b = parse_oa(txt); b['source_file'] = rel
            key = (b['consumer_no'], b['bill_month'])
            if key in seen:
                res['duplicates'].append({'key': list(key), 'file': rel, 'first': seen[key]}); continue
            seen[key] = rel; res['oa'].append(b)
        else:
            for part in split_lt_bills(txt):
                b = parse_lt(part); b['source_file'] = rel
                key = (b['consumer_no'], b['bill_month'])
                if key in seen:
                    res['duplicates'].append({'key': list(key), 'file': rel, 'first': seen[key]}); continue
                seen[key] = rel; res['lt'].append(b)
res['unique_bills'] = {'oa': len(res['oa']), 'lt': len(res['lt'])}
json.dump(res, open(out, 'w'), indent=1, default=str)
print('files', len(res['files']), 'unique OA', len(res['oa']), 'unique LT', len(res['lt']), 'duplicates', len(res['duplicates']))
