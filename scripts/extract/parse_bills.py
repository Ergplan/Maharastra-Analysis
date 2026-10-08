import re, sys, json, glob, os

def num(s):
    if s is None: return None
    s = s.replace(',', '').replace('Rs.', '').strip()
    try: return float(s)
    except: return None

def grab(txt, pat, g=1, flags=0, conv=num):
    m = re.search(pat, txt, flags)
    if not m: return None
    return conv(m.group(g)) if conv else m.group(g)

NUM = r'(-?\s?[\d,]+\.?\d*)'

# ---------------- HT / OA bills ----------------
def parse_oa(txt):
    d = {}
    d['bill_month'] = grab(txt, r'Bill Month\s+(\S+)', conv=None)
    d['bill_date'] = grab(txt, r'Bill Date\s+(\S+)', conv=None)
    d['due_date'] = grab(txt, r'Due Date\s+(\S+)', conv=None)
    d['consumer_no'] = grab(txt, r'Consumer Number\s+(\d+)', conv=None)
    d['tariff'] = grab(txt, r'Tariff\s+(\d+\s+HT-\S+(?: \S)?)', conv=None)
    d['contract_demand'] = grab(txt, r'Total Contract Demand \(KVA\)\s+(\d+)')
    d['oa_cd_solar'] = grab(txt, r'OA CD Non Conventional Solar \(KVA\)\s+(\d+)')
    d['highest_msedcl_demand_recorded'] = grab(txt, r'MSEDCL Demand\s+(\d+)')
    # energy summary row
    m = re.search(r'\d\d-[A-Z]{3}-\d{4} TO \d\d-[A-Z]{3}-\d{4}\s+([\d,]+)\s+([\d,]+)\s+([\d,]+)\s+([\d,]+)\s+([\d,]+)\s+([\d,]+)\s+([\d,]+)', txt)
    if m:
        keys = ['total_drawal','total_injection','units_msedcl_tariff','units_temp_tariff','offset_current_gen','offset_last_banked','over_injected']
        for k,v in zip(keys, m.groups()): d[k] = num(v)
    m = re.search(r'Billed Demand\s+(\d+)\s+RKVAH.*?\n\s*Highest Recorded Demand\s+([\d.]+)\s+([\d,]+)\s+([\d.]+)\s+([\d.]+)\s+Units\s+([\d,]+)\s+([\d,]+)\s+([\d,]+)\s+([\d,]+)', txt, re.S)
    if m:
        d['billed_demand'], d['hrd'], d['rkvah'], d['pf'], d['lf'] = [num(x) for x in m.groups()[:5]]
        d['zoneA'], d['zoneB'], d['zoneC'], d['zoneD'] = [num(x) for x in m.groups()[5:]]
    # Section A and B
    secA = txt.split('Bill for MSEDCL consumption')[1].split('Bill for Open Access')[0] + '\n' + re.search(r'Total Bill for MSEDCL consumption \(A\).*', txt).group(0)
    secB = txt.split('Bill for Open Access')[1].split('TOTAL CURRENT BILL')[0] + '\n' + re.search(r'Total Bill for Open Access \(B\).*', txt).group(0)
    def lines(sec, prefix):
        out = {}
        for name, pat in [
            ('demand_charges', r'Demand Charges\s+([\d.]+)?\s+' + NUM),
            ('energy_charges', r'Energy Charges KVAH Units: ([\d,]+)\s+([\d.]+)\s+' + NUM),
            ('tod_ec', r'TOD Tariff EC.*?' + NUM + r'\s*$'),
            ('fac', r'FAC Charges @ ([\d.]+)\s+' + NUM),
            ('green', r'Green Tariff Amount\s+([\d.]+)\s+' + NUM),
            ('bulk_rebate', r'Bulk Consumption Rebate\s+(-?\s?[\d,]+\.\d+)'),
            ('ed', r'Electricity Duty\s+' + NUM),
            ('tose', r'Tax on Sale\s+([\d.]+)\s+' + NUM),
            ('incr_rebate', r'Incremental Consumption Rebate\s+' + NUM),
            ('demand_penalty', r'Demand Penalty\s+' + NUM),
            ('addl_surcharge', r'Additional Surcharge\s+' + NUM),
            ('css', r'Cross Subsidy Surcharge\s+' + NUM),
            ('wheeling', r'Wheeling Charges\s*(\([^)]*\))?\s+' + NUM),
            ('transmission', r'Transmission Charges\s+' + NUM),
            ('operating', r'Operating Charges\s+' + NUM),
            ('debit_adj', r'Debit Bill Adjustment\s+' + NUM),
            ('solar_rooftop_credit', r'Solar Rooftop Credit\s+' + NUM),
            ('dispute', r'Dispute Amount\s+' + NUM),
            ('total', r'Total Bill for (?:MSEDCL consumption|Open Access) \([AB]\)\s+' + NUM),
        ]:
            mm = re.search(pat, sec, re.M)
            if mm:
                gs = mm.groups()
                out[name] = num(gs[-1].replace(' ', ''))
                if name == 'energy_charges':
                    out['energy_kvah_units'] = num(gs[0]); out['energy_rate'] = num(gs[1])
                if name == 'demand_charges' and gs[0]: out['demand_rate'] = num(gs[0])
                if name == 'fac': out['fac_rate'] = num(gs[0])
                if name == 'tose': out['tose_rate'] = num(gs[0])
                if name == 'wheeling' and gs[0]: out['wheeling_note'] = gs[0]
            else:
                out[name] = None
        return {prefix + k: v for k, v in out.items()}
    d.update(lines(secA, 'A_'))
    d.update(lines(secB, 'B_'))
    d['tod_units_str'] = grab(txt, r'TOD Tariff EC\s+KVAH Units: ([\d+]+)', conv=None)
    d['total_current_bill'] = grab(txt, r'TOTAL CURRENT BILL \(A \+ B\)\s+' + NUM)
    d['current_interest'] = grab(txt, r'Current Interest\s+' + NUM)
    d['principal_arrears'] = num(grab(txt, r'Principal Arrears\s+(-?\s?[\d,]+\.\d+)', conv=None).replace(' ', '')) if re.search(r'Principal Arrears\s+(-?\s?[\d,]+\.\d+)', txt) else None
    d['interest_arrears'] = grab(txt, r'Interest Arrears\s+' + NUM)
    d['total_bill_rounded'] = grab(txt, r'Total Bill Amount \(Rounded\) Rs\.\s+' + NUM)
    d['security_deposit'] = grab(txt, r'Security Deposit Held Rs\.\s+' + NUM)
    d['dpc'] = grab(txt, r'Delay Payment Charges Rs\.\s+' + NUM)
    d['payable_after_due'] = grab(txt, r'Amount \(Rounded\) Payable After\s+\S+\s+' + NUM)
    d['last_month_payment'] = grab(txt, r'Last Month Payment\s+' + NUM)
    d['prompt_discount'] = grab(txt, r'PROMPT DISCOUNT RS\. ([\d.]+)')
    d['rkvah_lag'] = grab(txt, r'RKVAH Lag consumption ([\d.]+)')
    d['rkvah_lead'] = grab(txt, r'RKVAH Lead consumption ([\d.]+)')
    d['incr_ref_consumption'] = grab(txt, r'Ref consumption : ([\d,]+)')
    d['wheeling_loss_supp'] = grab(txt, r'loss units for the period of (\S+ to \S+) is Rs\.([\d.]+)', g=2)
    d['wheeling_loss_period'] = grab(txt, r'loss units for the period of (\S+ to \S+)', conv=None)
    # OA permissions
    d['oa_generators'] = re.findall(r'(C\d+ - [A-Z .]+?(?:LTD|LIMITED)\.?)\s+(\S+)\s+(\S+ \(\S+\))\s+([\d,]+)\s+(\S+)\s+(\S+ to \S+)', txt)
    # adjustments
    adj = {}
    sec = txt.split('Adjustment Details')[-1].split('Solar Rooftop Generation Details')[0] if 'Adjustment Details' in txt else ''
    for mm in re.finditer(r'^\s*([A-Za-z][A-Za-z ().]+?)\s{2,}' + NUM + r'\s+' + NUM + r'\s*$', sec, re.M):
        adj[mm.group(1).strip()] = (num(mm.group(2)), num(mm.group(3)))
    d['adjustments'] = adj
    # rooftop solar
    d['rooftop_meters'] = [(m[0], num(m[1])) for m in re.findall(r'(076-\d+)\s+\S+\s+([\d,]+)', txt)]
    d['rooftop_total'] = sum(x[1] for x in d['rooftop_meters'])
    return d

# ---------------- LT bills ----------------
def split_lt_bills(txt):
    import datetime
    pages = [p for p in txt.split('\f') if p.strip()]
    heads = {}; order = []
    for p in pages:
        m = re.search(r'BILL OF SUPPLY FOR THE MONTH\s+(\S+)', p)
        if m:
            heads[m.group(1)] = p; order.append(m.group(1))
    for p in pages:
        if 'BILL OF SUPPLY FOR THE MONTH' in p: continue
        m = re.search(r'Current\s+(\d\d)/(\d\d)/(\d{4})', p)
        if m:
            mon = datetime.date(int(m.group(3)), int(m.group(2)), 1).strftime('%b-%Y')
            if mon in heads: heads[mon] += '\n' + p; continue
        # page without a reading date (e.g. solar net-meter detail page): attach to the most recent header
        if order: heads[order[-1]] += '\n' + p
    return [heads[k] for k in order]

def parse_lt(txt):
    d = {}
    d['bill_month'] = grab(txt, r'BILL OF SUPPLY FOR THE MONTH\s+(\S+)', conv=None)
    d['bill_date'] = grab(txt, r'BILL DATE\s+(\S+)', conv=None)
    d['due_date'] = grab(txt, r'DUE DATE\s+(\S+)', conv=None)
    d['consumer_no'] = grab(txt, r'Consumer No\. :\s+(\d+)', conv=None)
    d['consumer_name'] = grab(txt, r'Consumer Name :\s+(.+?)\s{2,}', conv=None) or grab(txt, r'Consumer Name :\s+(.+)', conv=None)
    d['tariff'] = grab(txt, r'Tariff :\s+(\d+ LT-\S+ \S)', conv=None)
    d['sanctioned_load_kw'] = grab(txt, r'Sanctioned Load :\s+([\d.]+)')
    d['contract_demand_kva'] = grab(txt, r'Contract Demand \(KVA\) :\s+([\d.]+)')
    d['solar_kw'] = grab(txt, r'Solar Generation Capacity \(KW\) :\s+([\d.]+)')
    d['urban_rural'] = grab(txt, r'Urban/Rural Flag :\s+(\S)', conv=None)
    d['security_deposit'] = grab(txt, r'Security Deposite Held Rs\. :\s+([\d.]+)')
    d['last_month_payment'] = grab(txt, r'Last Month\s+:\s+([\d.]+)')
    d['ed_code'] = grab(txt, r'Elec\. Duty :\s+(\S+)', conv=None)
    d['mf'] = grab(txt, r'Multiplying Factor\s+([\d.]+)')
    m = re.search(r'Current\s+(\S+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)', txt)
    if m:
        d['read_date_cur'] = m.group(1)
    m = re.search(r'Previous\s+(\S+)\s+([\d.]+)', txt)
    if m: d['read_date_prev'] = m.group(1); d['prev_kwh_reading'] = num(m.group(2))
    m = re.search(r'Current\s+\S+\s+([\d.]+)', txt)
    if m: d['cur_kwh_reading'] = num(m.group(1))
    m = re.search(r'Total Consumption\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)', txt)
    if m:
        d['kwh'], d['kvah'], d['rkvah_lag'], d['rkvah_lead'], d['md_kw'], d['md_kva'] = [num(x) for x in m.groups()]
    m = re.search(r'Adjustment\s+Solar\s+(-?[\d.]+)', txt)
    if m: d['solar_adj_kwh'] = num(m.group(1))
    m = re.search(r'Assessed Consumption\s+([\d.]+)', txt)
    if m: d['assessed_kwh'] = num(m.group(1))
    d['billed_demand'] = grab(txt, r'Billed Demand\s+(\d+)\s+@ Rs\.\s+([\d.]+)')
    d['demand_rate'] = grab(txt, r'Billed Demand\s+(\d+)\s+@ Rs\.\s+([\d.]+)', g=2)
    d['billed_pf'] = grab(txt, r'Billed P\.F\.\s+([\d.]+)')
    d['avg_pf'] = grab(txt, r'Avg\. P\.\s+([\d.]+)')
    m = re.search(r'Commercial\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)', txt)
    if m: d['ec_units'], d['ec_rate'], d['ec_amount_calc'] = [num(x) for x in m.groups()]
    m = re.search(r'^\s*([\d.]+)\s+(2\d\.\d+|1\d\.\d+|9\.\d+)\s+([\d.]+)\s*$', txt, re.M)
    # ED base: find line with three numbers right before 'TOD Tariffs'
    m = re.search(r'([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\n\s*TOD Tariffs', txt)
    if m: d['ed_base'], d['ed_rate_pct'], d['ed_amount_calc'] = [num(x) for x in m.groups()]
    tod = re.findall(r'(\d\d:\d\d Hrs - \d\d:\d\d Hrs)[^\n]*\n(?:[^\n]*\n){0,3}?\s*(-?\d+\.\d{4})\s+(\d+)\s+(\d+)\s+(-?\d+\.\d+)', txt)
    d['tod'] = [(t[0], num(t[1]), num(t[2]), num(t[3]), num(t[4])) for t in tod]
    for name, pat in [
        ('demand_charges', r'Demand Charges\s+' + NUM),
        ('wheeling', r'Wheeling Charge @\s+([\d.]+)\s+' + NUM),
        ('energy_charges', r'Energy Charges\s+' + NUM),
        ('tod_ec', r'TOD Tariff EC\s+' + NUM),
        ('fac', r'FAC @ ([\d.]+)\s+Ps\./U\s+' + NUM),
        ('ed', r'Electricity Duty\s+' + NUM),
        ('other_charges', r'Other Charges\s+' + NUM),
        ('tose', r'Tax on Sale @ ([\d.]+)\s+Ps\./U\s+' + NUM),
        ('pf_penalty_incentive', r'P\.F\.Penal Charges/P\.F\.Incentive\s+' + NUM),
        ('excess_demand', r'Charges For Excess Demand\s+' + NUM),
        ('incr_rebate', r'Incr Consump Rebate\s+' + NUM),
        ('debit_adj', r'Debit Bill Adjustment\s+' + NUM),
        ('total_current_bill', r'TOTAL CURRENT BILL\s+(?:\(\*SUBSIDIZED\)\s+)?' + NUM),
        ('current_interest', r'Current Interest\s+\S+\s+' + NUM),
        ('principal_arrears', r'Principal Arrears\s+' + NUM),
        ('interest_arrears', r'Interest Arrears\s+' + NUM),
        ('total_bill_rounded', r'Total Bill Amount \(Rounded\) Rs\.\s+' + NUM),
        ('dpc', r'Delayed Payment Charges Rs\.\s+' + NUM),
    ]:
        mm = re.search(pat, txt)
        if mm:
            gs = mm.groups(); d[name] = num(gs[-1].replace(' ', ''))
            if name == 'wheeling': d['wheeling_rate'] = num(gs[0])
            if name == 'fac': d['fac_rate_ps'] = num(gs[0])
            if name == 'tose': d['tose_rate_ps'] = num(gs[0])
        else: d[name] = None
    d['payable_after_due'] = grab(txt, r'Payable After\s*\n\s*\S+\s+' + NUM)
    d['grid_support_charge'] = grab(txt, r'Solar Grid Support Charges Rs :\s*([\d.]+)')
    d['credit_adj_msg'] = grab(txt, r'Credit Bill Adjustment Amount = ([\d.]+)')
    d['debit_adj_msg'] = grab(txt, r'Debit Bill Adjustment Amount = ([\d.]+)')
    m = re.search(r'Export:(\d+) Import:(\d+) Adjusted:(\d+) Bank:(\d+)', txt)
    if m: d['solar_export'], d['solar_import'], d['solar_adjusted'], d['solar_bank'] = [num(x) for x in m.groups()]
    d['incr_rebate_msg'] = grab(txt, r'Incremental Consumption Rebate if paid on or before \S+ Rs\.([\d.]+)')
    d['incr_rebate_units'] = grab(txt, r'on units (\d+) Ref Consumption')
    d['prompt_discount_msg'] = grab(txt, r'Prompt Discount of Rs\. ([\d.]+)')
    d['prev_prompt_credit'] = grab(txt, r'Prev Prompt Payment Credit:([\d.]+)')
    # solar generation total: TOTAL row in net meter table (last number)
    m = re.search(r'TOTAL\s+[\d.]+\s+[\d.]+\s+[\d.]+\s+[\d.]+\s+[\d.]+\s+[\d.]+\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)', txt)
    if m: d['solar_gen_units'] = num(m.group(4)); d['solar_export_units_tbl'] = num(m.group(1))
    # billing history
    hist = re.findall(r'^\s*([A-Z][a-z]{2}-\d{4})\s+(\d+)\s+(\d+)\s+([\d.]+)\s*$', txt, re.M)
    d['history'] = [(h[0], num(h[1]), num(h[2]), num(h[3])) for h in hist]
    d['messages'] = [l.strip() for l in txt.split('Message:')[-1].splitlines() if l.strip().startswith('#')][:12] if 'Message:' in txt else []
    return d

if __name__ == '__main__':
    out = {'oa': [], 'lt': []}
    for f in sorted(glob.glob(sys.argv[1] + '/oa_*.txt')):
        t = open(f, encoding='utf-8', errors='ignore').read()
        d = parse_oa(t); d['file'] = os.path.basename(f); out['oa'].append(d)
    seen = set()
    for f in sorted(glob.glob(sys.argv[1] + '/stores_*.txt')):
        t = open(f, encoding='utf-8', errors='ignore').read()
        for part in split_lt_bills(t):
            d = parse_lt(part); d['file'] = os.path.basename(f)
            key = (d['consumer_no'], d['bill_month'])
            if key in seen: continue
            seen.add(key); out['lt'].append(d)
    json.dump(out, open(sys.argv[2], 'w'), indent=1, default=str)
    print(len(out['oa']), 'OA bills;', len(out['lt']), 'LT bills')
