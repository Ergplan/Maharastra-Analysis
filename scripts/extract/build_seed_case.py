"""Build the reviewed, compact seed case the app loads on first launch.

Usage: python3 -I scripts/extract/build_seed_case.py src/data/seed/bills.json src/data/seed/generation_daily.json src/data/seed/seed_case.json

Everything here is traceable to a bill field, a workbook cell, or is explicitly tagged
'user_assumption' / 'synthetic_estimate'. Tariff rates are those PRINTED on the FY27 bills
(w.e.f. 01-04-2026, MERC Case 217/2024 + addendum 75/2025) and are tagged bill-derived, not
independently verified against the MERC tariff schedule.
"""
import sys, json, datetime, calendar as cal

bills = json.load(open(sys.argv[1]))
gen = json.load(open(sys.argv[2]))
out = sys.argv[3]

MONTHS = ['2025-11', '2025-12', '2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10']
MON3 = {'Jan': 1, 'Feb': 2, 'Mar': 3, 'Apr': 4, 'May': 5, 'Jun': 6, 'Jul': 7, 'Aug': 8, 'Sep': 9, 'Oct': 10, 'Nov': 11, 'Dec': 12}

def ym(s):  # 'MAY-2026' / 'May-2026' -> '2026-05'
    m, y = s.split('-'); return f"{int(y):04d}-{MON3[m.title()[:3]]:02d}"

def days_in(ymstr):
    y, m = map(int, ymstr.split('-')); return cal.monthrange(y, m)[1]

# ---------- Factory (HT OA) ----------
oa = sorted(bills['oa'], key=lambda b: ym(b['bill_month']))
fac_months = []
for b in oa:
    m = ym(b['bill_month'])
    fac_months.append({
        'month': m, 'days': days_in(m),
        'drawal_kwh': b['total_drawal'],              # total site drawal at 33 kV meter (grid + OA)
        'grid_kwh': b['units_msedcl_tariff'],
        'oa_offset_kwh': b['offset_current_gen'],
        'oa_injection_kwh': b['total_injection'],
        'over_injected_kwh': b['over_injected'],
        'rooftop_kwh': b['rooftop_total'],
        'billed_demand_kva': b['billed_demand'], 'hrd_kva': b['hrd'], 'msedcl_hrd_kva': b['highest_msedcl_demand_recorded'],
        'pf': b['pf'], 'grid_zone_kwh': [b['zoneA'], b['zoneB'], b['zoneC'], b['zoneD']],
        'energy_rate': b['A_energy_rate'], 'demand_rate': b['A_demand_rate'], 'fac_rate': b.get('A_fac_rate'), 'tose_rate': b.get('A_tose_rate'),
        'oa_wheeling_rs': b['B_wheeling'], 'oa_transmission_rs': b['B_transmission'], 'oa_operating_rs': b['B_operating'], 'oa_tose_rs': b['B_tose'],
        'total_current_bill_rs': b['total_current_bill'], 'debit_adjustment_rs': b['A_debit_adj'],
        'wheeling_loss_supplementary_rs': b.get('wheeling_loss_supp'),
        'source': {'file': b['source_file'], 'page': 1},
        'tag': 'extracted_actual',
    })
last = oa[-1]
plant_month = {k: v for k, v in gen['monthly_kwh'].items()}
alloc_ratio = []
for fm in fac_months:
    if fm['month'] in plant_month:
        alloc_ratio.append({'month': fm['month'], 'factory_injection_kwh': fm['oa_injection_kwh'], 'plant_export_kwh': plant_month[fm['month']],
                            'ratio': fm['oa_injection_kwh'] / plant_month[fm['month']]})
# Share implied by Dec-25..Jul-26 (Nov-25 ratio 0.86 is an outlier: plant commissioning month, low early readings)
steady = [r['ratio'] for r in alloc_ratio if r['month'] != '2025-11']
factory_share = sum(steady) / len(steady)

factory = {
    'id': '411639023090', 'name': 'Harrshiv Healthy Foods and More Pvt Ltd', 'site': 'Kamptee, Nagpur Rural (33 kV)',
    'kind': 'factory', 'category': 'HT-I(A) Industry', 'voltageKv': 33, 'connection': 'HT partial open access',
    'contractDemandKva': last['contract_demand'], 'oaCdKva': last['oa_cd_solar'], 'pf': 0.995,
    'oaEligible': True, 'eligibilityNote': 'Existing partial-OA consumer (STOA permissions on every bill). Group-captive ownership/consumption tests: not verified from bills.',
    'profileType': 'factory24x7',
    'todShares': {'value': [0.2174, 0.1413, 0.3768, 0.2645], 'tag': 'synthetic_estimate', 'note': 'Total-site drawal assumed 24x7 with daytime (06-18) load 1.3x night load; calibrated so engine band-wise offsets land within ~10% of the Apr-Jul 2026 billed offsets. Dec-Feb 2026 bills show higher offsets than any such profile under band netting (those bills put all residual units in zone D - see bill review). Bills only show the grid residual by zone.'},
    'dayNightRatio': {'value': 1.3, 'tag': 'synthetic_estimate'},
    'currentAllocation': {'mwp': round(factory_share * 7.5, 3), 'shareOfPlant': round(factory_share, 4), 'status': 'confirmed',
                          'note': f'Factory bill injection / plant ABT export = {factory_share:.1%} on average Dec-25..Jul-26 (monthly ratios attached). Treated as the existing contractual share of the 7.5 MWp plant.'},
    'monthly': fac_months,
    'allocationEvidence': alloc_ratio,
    'tariff': {
        'tag': 'bill_derived_FY27', 'effectiveFrom': '2026-04-01',
        'energyRsPerKvah': 8.44, 'demandRsPerKvaMonth': 650, 'todRsPerKvah': [0, 0, -1.5, 2.11],
        'todNote': 'Zones A 00-06, B 06-09, C 09-17, D 17-24. D = +2.11 derived from bills (TOD EC / zone-D units). A and B = 0 derived. C rebate assumed -1.50 (no zone-C grid units on any bill) - user assumption.',
        'facRsPerKvah': 0.35, 'facNote': 'FAC varies monthly (0.20-0.50 in FY27 bills); 0.35 = Jul-26 value used as default.',
        'edPct': 0.0, 'tosePaisePerKwh': 27.9, 'bulkRebatePct': 0.5,
        'pfBillingUnit': 'kVAh',
    },
    'oaCharges': {
        'tag': 'bill_derived_FY27',
        'wheelingRsPerKwhInjected': 0.81, 'transmissionRsPerKwhOffset': 1.022, 'operatingRsPerMonth': 16500,
        'tosePaisePerKwhOffset': 27.9, 'cssRsPerKwh': 0, 'additionalSurchargeRsPerKwh': 0,
        'inKindLossPct': {'value': 0.0, 'tag': 'user_assumption', 'note': 'Bills show injection - offset - over-injected = 3-6% of injection; MSEDCL is also raising a Rs-denominated loss supplementary (APTEL). Default 0% in kind to avoid double counting; editable.'},
        'note': 'Wheeling 0.81/kWh on injected units; transmission 1.022/kWh on offset units; operating Rs16,500/month; ToSE 27.9p on offset units - all read off the FY27 bills (B section).',
    },
    'rooftop': {'kw': 1500, 'note': 'Behind-the-meter rooftop, 4 meters, 1.1-1.9 lakh kWh/month; self-consumed first; NOT output of the 7.5 MWp plant.'},
    'ppaTariffRsPerKwh': 4.0, 'ppaBillingBasis': 'offset',
}

# ---------- Stores (LT-II C) ----------
stores = {}
for b in bills['lt']:
    cid = b['consumer_no']
    s = stores.setdefault(cid, {'id': cid, 'name': b['consumer_name'], 'bills': [], 'history': {}})
    s['sanctionedLoadKw'] = b['sanctioned_load_kw']; s['contractDemandKva'] = b['contract_demand_kva']
    s['solarKw'] = b.get('solar_kw') or 0; s['urbanRural'] = b['urban_rural']
    for h in b['history']:
        s['history'][ym(h[0])] = {'units_kvah': h[1], 'billed_demand_kva': h[2], 'bill_rs': h[3]}
    if b.get('kwh') is not None:
        s['bills'].append({'month': ym(b['bill_month']), 'kwh': b['kwh'], 'kvah': b['kvah'], 'md_kva': b['md_kva'], 'billed_demand_kva': b['billed_demand'],
                           'pf': b['billed_pf'], 'tod_kvah': [t[2] for t in b['tod']], 'tod_rates': [t[1] for t in b['tod']],
                           'energy_rate': b['ec_rate'], 'demand_rate': b['demand_rate'], 'wheeling_rate': b.get('wheeling_rate'), 'fac_paise': b.get('fac_rate_ps'),
                           'ed_pct': b.get('ed_rate_pct'), 'tose_paise': b.get('tose_rate_ps'), 'total_current_bill_rs': b['total_current_bill'],
                           'solar_gen_kwh': b.get('solar_gen_units'), 'solar_export_kwh': b.get('solar_export'), 'grid_support_rs': b.get('grid_support_charge'),
                           'source': {'file': b['source_file']}, 'tag': 'extracted_actual'})
store_list = []
for cid, s in stores.items():
    s['bills'].sort(key=lambda x: x['month'])
    fy27 = [x for x in s['bills'] if x['month'] >= '2026-04']
    ref = max(fy27, key=lambda x: (sum(1 for t in x['tod_kvah'] if t > 0), x['month']))
    tod_flags = [x['month'] for x in fy27 if sum(1 for t in x['tod_kvah'] if t > 0) < 3]
    tod_tot = sum(ref['tod_kvah']) or 1
    shares = [t / tod_tot for t in ref['tod_kvah']]
    pf = sum(x['pf'] for x in fy27) / len(fy27)
    store_list.append({
        'id': cid, 'name': s['name'], 'site': 'Nagpur (LT)', 'kind': 'store', 'category': 'LT-II(C) Commercial', 'voltageKv': 0.415,
        'connection': 'LT (no open access)', 'contractDemandKva': s['contractDemandKva'], 'sanctionedLoadKw': s['sanctionedLoadKw'], 'pf': round(pf, 3),
        'oaEligible': False, 'eligibilityNote': 'LT-II(C) connection well below the 1 MW open-access threshold; no OA permission on the bills. Allocation to this site is NOT currently feasible; toggle eligibility only if a verified route exists (e.g. HT conversion, aggregation rule, virtual net metering).',
        'profileType': 'store',
        'todShares': {'value': shares, 'tag': 'derived_from_actual', 'note': f"ToD kVAh split from {ref['month']} bill" + (f"; ToD registers implausible in {tod_flags} (bands empty) - meter check recommended" if tod_flags else '')},
        'currentAllocation': {'mwp': 0, 'shareOfPlant': 0, 'status': 'unknown', 'note': 'No captive-plant allocation evidenced on the store bills (grid + rooftop only).'},
        'monthly': [{'month': m, 'kvah': v['units_kvah'], 'kwh_est': round(v['units_kvah'] * pf, 1), 'tag': 'extracted_actual(history)'} for m, v in sorted(s['history'].items())]
                   + [{'month': x['month'], 'kwh': x['kwh'], 'kvah': x['kvah'], 'tag': 'extracted_actual'} for x in s['bills'] if x['month'] not in s['history']],
        'bills': s['bills'],
        'tariff': {'tag': 'bill_derived_FY27', 'effectiveFrom': '2026-04-01', 'energyRsPerKvah': ref['energy_rate'], 'demandRsPerKvaMonth': ref['demand_rate'],
                   'todRsPerKvah': ref['tod_rates'], 'wheelingRsPerKvah': ref['wheeling_rate'], 'facRsPerKvah': (ref['fac_paise'] or 0) / 100,
                   'edPct': ref['ed_pct'], 'tosePaisePerKwh': ref['tose_paise'], 'pfBillingUnit': 'kVAh'},
        'rooftop': {'kw': s['solarKw'], 'note': 'Rooftop net metering on the store bill; self-consumed first.'} if s['solarKw'] else None,
        'ppaTariffRsPerKwh': 4.0, 'ppaBillingBasis': 'offset',
    })
store_list.sort(key=lambda x: x['id'])

seed = {
    'version': 1, 'builtOn': datetime.date.today().isoformat(),
    'calendar': {'months': MONTHS, 'timezone': 'Asia/Kolkata', 'observedThrough': '2026-09-30', 'estimatedMonths': ['2026-10'], 'intervalsPerDay': 96},
    'plant': {
        'name': gen['plant'], 'dcMwp': 7.5, 'acMwInverter': {'value': 6.5, 'tag': 'user_assumption', 'status': 'unverified', 'note': 'Inverter MWac / approved export capacity not documented. 6.5 MWac placeholder (DC/AC ~1.15). Used only for the intraday ceiling check; days whose reconstructed peak exceeds it are flagged, never clipped.'},
        'capexRsCrPerMw': 4.0, 'capexRsCr': 30.0, 'latitude': 20.65, 'longitude': 78.48,
        'export': {'seriesType': gen['series_type'], 'meterFactor': gen['meter_factor'], 'days': [{'date': d['date'], 'kwh': d['kwh_reported'], 'hardcoded': d['hardcoded'], 'note': d['note'], 'source': d['source']} for d in gen['days']],
                   'monthlyKwh': gen['monthly_kwh'], 'totalKwh': gen['total_kwh_reported'], 'nDays': gen['n_days'], 'flatAnnualisationKwh': gen['flat_annualisation_kwh'], 'zeroDays': gen['zero_days'], 'issues': gen['issues']},
        'costSheetIllustration': {'source': 'Landed_Cost_Sheet_MH_2.xlsx / Maharashtra', 'capacityMwac': 4, 'cufAc': 0.25953743093587045, 'tariffRs': 3.5,
                                  'transmissionRsPerKwh': 1.04, 'transmissionLossPct': 3.28, 'wheelingRsPerKwh': 0.62, 'wheelingLossPct': 7.5, 'bankingPct': 8, 'bankingDeductionEffective': '30% x 8% = 2.4% (scenario assumption)',
                                  'operatingRsPerMw': 29830, 'note': 'Illustrative 4 MW / Rs3.50 example; Summary sheet formula has a #DIV/0!; NOT used as authoritative inputs.'},
    },
    'consumers': [factory] + store_list,
    'newCustomerDefaults': {'name': 'New 132 kV group-captive consumer', 'category': 'HT (132 kV) - category not confirmed', 'voltageKv': 132, 'ppaTariffRsPerKwh': 2.5,
                            'avgLoadMw': 4.0, 'profile': 'factory24x7', 'allocationMwp': 3.0, 'contractDemandKva': 6000,
                            'avoidedGridTariff': {'energyRsPerKvah': 8.44, 'todRsPerKvah': [0, 0, -1.5, 2.11], 'facRsPerKvah': 0.35, 'tag': 'illustrative', 'note': 'HT-I(A) FY27 rates copied from the factory bill as an illustration; the new customer category/tariff is unknown.'},
                            'oaCharges': {'wheelingRsPerKwhInjected': 0.81, 'transmissionRsPerKwhOffset': 1.022, 'operatingRsPerMonth': 16500, 'tosePaisePerKwhOffset': 27.9, 'applyWheeling': True,
                                          'note': 'Plant injects at 33 kV into the MSEDCL network; a 132 kV drawal point does not by itself remove the 33 kV wheeling leg. Wheeling kept ON by default, editable.'}},
    'rulePack': {
        'id': 'MH-bill-calibrated-FY27', 'label': 'Bill-calibrated ToD block settlement / regulatory verification pending', 'effectiveFrom': '2026-04-01',
        'todBands': [{'id': 'A', 'label': '00-06', 'startHour': 0, 'endHour': 6}, {'id': 'B', 'label': '06-09', 'startHour': 6, 'endHour': 9}, {'id': 'C', 'label': '09-17', 'startHour': 9, 'endHour': 17}, {'id': 'D', 'label': '17-24', 'startHour': 17, 'endHour': 24}],
        'adjustmentPeriod': 'month', 'bankingAllowed': True, 'bankingChargePct': 0.0,
        'withdrawalMatrix': {'A': ['A'], 'B': ['B'], 'C': ['C'], 'D': ['D']},
        'bankCapPctOfConsumption': 100, 'expiredCompensationRsPerKwh': 0.0,
        'notes': ['Bills show "Units offset against drawal - last month banked = 0" every month: no carry-over between months (adjustment period = month).',
                  'Default withdrawal matrix = same band only. Factory bills Mar-Jul 2026 reconcile best to band-wise netting; Dec-Feb bills placed all residual units in zone D (flagged in bill review).',
                  'Over-injected units carry no compensation line on any bill: expiredCompensation default 0 (unverified).',
                  'MERC Distribution Open Access Regulations 2026 and BESS Regulations 2026 were DRAFTS on the MERC site on 8 Oct 2026; nothing here asserts their applicability.'],
        'sources': [{'title': 'MERC draft regulations page', 'url': 'https://new.merc.gov.in/regulation_type/draft-regulations/', 'inspected': '2026-10-08', 'status': 'draft - not applied'},
                    {'title': 'MSEDCL Distribution Open Access regulation page', 'url': 'https://www.mahadiscom.in/en/distribution-open-access-regulation-2/', 'inspected': '2026-10-08', 'status': 'lists 2016 regs + 2019/2023 amendments'},
                    {'title': 'MSEDCL tariff details (MYT Case 217 of 2024, addendum 75 of 2025)', 'url': 'https://www.mahadiscom.in/consumer/en/tariff-details/', 'inspected': '2026-10-08', 'status': 'rates on bills consistent across 8 consumers; not independently re-verified'}],
    },
    'finance': {'tag': 'modelling_assumption', 'lifeYears': 25, 'solarDegradationPct': 0.5, 'omPctOfCapexYear1': 1.5, 'omEscalationPct': 5.0, 'ppaEscalationPct': 0.0, 'discountRatePct': 10.0, 'receivableDays': 30,
                'bess': {'capexRsCrPerMwh': 1.0, 'includesPcs': True, 'includesInstallation': False, 'includesConnection': False, 'otherAddersRsCr': 0.0, 'lifeYears': 12, 'omPctOfCapex': 2.0,
                         'usableSocMin': 0.1, 'usableSocMax': 0.9, 'etaCharge': 0.95, 'etaDischarge': 0.95, 'auxPctOfThroughput': 1.0, 'degradationPctPerYear': 2.0, 'maxCyclesPerDay': 1.5}},
}
json.dump(seed, open(out, 'w'), indent=1, default=str)
print('factory share', round(factory_share, 4), 'mwp', round(factory_share * 7.5, 2), '| stores', len(store_list), '| size', len(json.dumps(seed)))
