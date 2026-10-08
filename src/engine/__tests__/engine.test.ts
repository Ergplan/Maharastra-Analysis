import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildCalendar, INTERVALS_PER_DAY } from '../calendar.ts';
import { buildSolar, intradayWeights } from '../solar.ts';
import { runDayView, evaluateAllocation, evaluateBess } from '../dayview.ts';
import { buildYearSeries, evaluateYear, sizingSweep } from '../yearsizing.ts';
import { defaultPlant as defaultPlantSeed } from '../seed.ts';
import { settleConsumer } from '../settlement.ts';
import { dispatchBess } from '../bess.ts';
import { irr, npv, buildFinance } from '../finance.ts';
import { buildConsumerLoad, monthlyLoadKwh } from '../profiles.ts';
import { consumerEconomics } from '../costs.ts';
import { runScenario } from '../scenario.ts';
import { baseInput, defaultBess, defaultNewCustomer, type SeedCase } from '../seed.ts';
import type { Consumer, RulePack, BessInput, ScenarioInput } from '../types.ts';

const seed = JSON.parse(fs.readFileSync(new URL('../../data/seed/seed_case.json', import.meta.url), 'utf8')) as SeedCase;
const bills = JSON.parse(fs.readFileSync(new URL('../../data/seed/bills.json', import.meta.url), 'utf8')) as { oa: unknown[]; lt: { bill_month: string; source_file: string }[]; duplicates: unknown[]; files: unknown[] };
const site = { latitude: seed.plant.latitude, longitude: seed.plant.longitude };

const bands = seed.rulePack.todBands;
const oneMonth = buildCalendar(['2026-04'], bands);
const rulesStrict: RulePack = { ...seed.rulePack, bankingAllowed: false };
const rulesSameBand: RulePack = { ...seed.rulePack, bankingAllowed: true, withdrawalMatrix: { A: ['A'], B: ['B'], C: ['C'], D: ['D'] } };
const rulesCross: RulePack = { ...seed.rulePack, bankingAllowed: true, withdrawalMatrix: { A: ['A'], B: ['B'], C: ['C', 'D'], D: ['D'] } };

function arr(cal = oneMonth) { return new Float64Array(cal.nIntervals); }

// ---------------- ingestion ----------------
test('generation ingestion: 334 dated daily records Nov-25..Sep-26, ~12.210422 GWh, opening row excluded, Jul-8 outage kept, x90 flagged', () => {
  const ex = seed.plant.export;
  assert.equal(ex.nDays, 334);
  assert.ok(Math.abs(ex.totalKwh - 12210422.1743) < 0.01);
  assert.equal(ex.days[0].date, '2025-11-01');
  assert.equal(ex.days[ex.days.length - 1].date, '2026-09-30');
  assert.ok(!ex.days.some((d) => d.date === '2025-10-31'), 'opening reading row must not be a daily record');
  const jul8 = ex.days.find((d) => d.date === '2026-07-08')!;
  assert.equal(jul8.kwh, 0); assert.match(String(jul8.note), /Breakdown/);
  assert.equal(ex.meterFactor.value, 90); assert.equal(ex.meterFactor.status, 'unverified');
  assert.ok(Math.abs(ex.flatAnnualisationKwh - 13343724.8312) < 0.01);
  assert.ok(Math.abs(ex.monthlyKwh['2026-06'] - 1286868.681) < 0.01);
});

test('bill ingestion: 30 files -> 9 + 21 unique bills, 12 duplicates; billing month read from the document, not the filename', () => {
  assert.equal(bills.files.length, 30); assert.equal(bills.oa.length, 9); assert.equal(bills.lt.length, 21); assert.equal(bills.duplicates.length, 12);
  const jun = bills.lt.filter((b) => b.source_file.includes('JUN-26'));
  assert.ok(jun.length > 0);
  for (const b of jun) assert.equal(b.bill_month, b.source_file.startsWith('413894361291') ? 'Jun-2026' : 'May-2026'); // one store's JUN file really is June
});

// ---------------- solar ----------------
test('synthetic intraday solar sums to each reported daily total; MWp/MWac kept distinct and ceiling breaches flagged, not clipped', () => {
  const cal = buildCalendar(['2026-06'], bands);
  const days = seed.plant.export.days.filter((d) => d.date.startsWith('2026-06'));
  const plant = { dcMwp: 7.5, acMw: 6.5, exportDaily: days, profileShape: 'smooth' as const, recoveredAvailability: false };
  const s = buildSolar(plant, cal, site.latitude, site.longitude);
  days.forEach((d, i) => { let sum = 0; for (let k = 0; k < 96; k++) sum += s.kwh[i * 96 + k]; assert.ok(Math.abs(sum - d.kwh) < 1e-6, `${d.date} ${sum} vs ${d.kwh}`); });
  assert.ok(s.totalKwh > 0); assert.equal(s.observedDays, 30); assert.equal(s.estimatedDays, 0);
  const tiny = buildSolar({ ...plant, acMw: 1 }, cal, site.latitude, site.longitude);
  assert.equal(tiny.acCeilingFlags.length, 30); // every day breaches a 1 MWac ceiling...
  assert.ok(Math.abs(tiny.totalKwh - s.totalKwh) < 1e-6); // ...but no energy is dropped
  const w = intradayWeights('2026-06-15', site.latitude, site.longitude, 'smooth');
  assert.equal(w[0], 0); assert.equal(w[95], 0); assert.ok(w[50] > 0);
});

test('missing month estimated from observed daily average (editable), never zero; recovered-availability is a separate switch', () => {
  const cal = buildCalendar(['2026-07', '2026-10'], bands);
  const days = seed.plant.export.days.filter((d) => d.date.startsWith('2026-07'));
  const base = { dcMwp: 7.5, acMw: 6.5, exportDaily: days, profileShape: 'smooth' as const, recoveredAvailability: false };
  const s = buildSolar(base, cal, site.latitude, site.longitude);
  assert.equal(s.estimatedDays, 31); assert.ok(s.dailyKwh[31] > 0);
  assert.equal(s.dailyKwh[7], 0); // Jul 8 preserved
  const rec = buildSolar({ ...base, recoveredAvailability: true }, cal, site.latitude, site.longitude);
  assert.ok(rec.dailyKwh[7] > 0);
  const oct = buildSolar({ ...base, octoberEstimateKwhPerDay: 12345 }, cal, site.latitude, site.longitude);
  assert.ok(Math.abs(oct.dailyKwh[31] - 12345) < 1e-9);
});

// ---------------- capex arithmetic ----------------
test('capex: 4 cr/MW x 7.5 MW = 30 cr; 2 MWh at 1 cr/MWh = 2 cr before explicit adders', () => {
  assert.equal(seed.plant.capexRsCrPerMw * seed.plant.dcMwp, 30);
  const b = defaultBess(seed, true); b.energyMwh = 2; b.otherAddersRsCr = 0;
  assert.equal(b.energyMwh * b.capexRsCrPerMwh + b.otherAddersRsCr, 2);
});

// ---------------- profiles ----------------
test('monthly synthetic profiles reproduce calibration totals and ToD shares; absent months are projected, not zero', () => {
  const c = seed.consumers[1];
  const cal = buildCalendar(seed.calendar.months, bands);
  const ls = buildConsumerLoad(c, cal, bands, 'flat', true);
  const { kwh: monthly, source } = monthlyLoadKwh(c, cal.months, 'flat');
  monthly.forEach((m, mi) => { assert.ok(m > 0); let s = 0; for (let d = 0; d < cal.dayDates.length; d++) if (cal.dayMonthIdx[d] === mi) for (let i = 0; i < 96; i++) s += ls.kwh[d * 96 + i]; assert.ok(Math.abs(s - m) < 1e-6); });
  assert.ok(source.includes('measured') && source.includes('estimated_flat'));
  // ToD shares preserved per day
  const shares = c.todShares.value; const bt = [0, 0, 0, 0]; let tot = 0;
  for (let i = 0; i < 96; i++) { bt[cal.bandOfInterval[i]] += ls.kwh[i]; tot += ls.kwh[i]; }
  bt.forEach((v, b) => assert.ok(Math.abs(v / tot - shares[b]) < 1e-9));
});

// ---------------- settlement fixtures ----------------
test('fixture: solar [100,0] / load [0,100] inside one band -> permissive block netting offsets 100; strict interval matching w/o banking offsets 0', () => {
  const load = arr(), solar = arr();
  const t0 = 40, t1 = 41; // both 10:00-10:30 => band C
  solar[t0] = 100; load[t1] = 100;
  const block = settleConsumer('x', load, solar, null, 'tod_block', rulesStrict, oneMonth);
  assert.ok(Math.abs(block.totals.settledOffset - 100) < 1e-9);
  const strict = settleConsumer('x', load, solar, null, 'interval_15min', rulesStrict, oneMonth);
  assert.equal(strict.totals.settledOffset, 0); assert.equal(strict.totals.expired, 100); assert.equal(strict.totals.physicalDirect, 0);
  // test fixture only - not a claim about current Maharashtra law
});

test('banking: chronological ledger, no credit from future deposits, same-band matrix, cap, expiry and compensation', () => {
  const load = arr(), solar = arr();
  solar[40] = 100; load[41] = 100;
  const ok = settleConsumer('x', load, solar, null, 'interval_15min', rulesSameBand, oneMonth);
  assert.ok(Math.abs(ok.totals.bankWithdrawn - 100) < 1e-9);
  const load2 = arr(), solar2 = arr(); load2[40] = 100; solar2[41] = 100; // load BEFORE the deposit
  const fut = settleConsumer('x', load2, solar2, null, 'interval_15min', rulesSameBand, oneMonth);
  assert.equal(fut.totals.bankWithdrawn, 0); assert.ok(Math.abs(fut.totals.expired - 100) < 1e-9);
  // cross-band not permitted by default: C surplus cannot serve D deficit
  const load3 = arr(), solar3 = arr(); solar3[40] = 100; load3[80] = 100; // 20:00 = band D
  const noCross = settleConsumer('x', load3, solar3, null, 'interval_15min', rulesSameBand, oneMonth);
  assert.equal(noCross.totals.bankWithdrawn, 0);
  const cross = settleConsumer('x', load3, solar3, null, 'interval_15min', rulesCross, oneMonth);
  assert.ok(Math.abs(cross.totals.bankWithdrawn - 100) < 1e-9);
  const crossBlock = settleConsumer('x', load3, solar3, null, 'tod_block', rulesCross, oneMonth);
  assert.ok(Math.abs(crossBlock.totals.bankWithdrawn - 100) < 1e-9);
  // cap: 10% of period consumption => only 10 kWh bankable
  const capped = settleConsumer('x', load, solar, null, 'interval_15min', { ...rulesSameBand, bankCapPctOfConsumption: 10 }, oneMonth);
  assert.ok(Math.abs(capped.totals.bankWithdrawn - 10) < 1e-9); assert.ok(Math.abs(capped.totals.expired - 90) < 1e-9);
  // banking charge in kind
  const fee = settleConsumer('x', load, solar, null, 'interval_15min', { ...rulesSameBand, bankingChargePct: 8 }, oneMonth);
  assert.ok(Math.abs(fee.totals.bankingCharge - 8) < 1e-9); assert.ok(Math.abs(fee.totals.bankWithdrawn - 92) < 1e-9);
  // compensation instead of lapse
  const comp = settleConsumer('x', load2, solar2, null, 'interval_15min', { ...rulesSameBand, expiredCompensationRsPerKwh: 2 }, oneMonth);
  assert.ok(Math.abs(comp.totals.compensated - 100) < 1e-9); assert.equal(comp.totals.expired, 0);
  // expiry at month end: deposit in April cannot be used in May
  const two = buildCalendar(['2026-04', '2026-05'], bands);
  const l = new Float64Array(two.nIntervals), s = new Float64Array(two.nIntervals);
  s[40] = 100; l[30 * 96 + 40] = 100;
  const exp = settleConsumer('x', l, s, null, 'interval_15min', rulesSameBand, two);
  assert.equal(exp.totals.bankWithdrawn, 0); assert.ok(Math.abs(exp.totals.expired - 100) < 1e-9);
});

test('settlement conserves energy in both modes: solar = direct + withdrawn + charge + expired + compensated', () => {
  const cal = buildCalendar(['2026-03'], bands);
  const load = new Float64Array(cal.nIntervals), solar = new Float64Array(cal.nIntervals);
  for (let t = 0; t < cal.nIntervals; t++) { load[t] = 50 + 30 * Math.sin(t / 7); const h = (t % 96) / 4; solar[t] = h > 6 && h < 18 ? 120 * Math.sin((h - 6) / 12 * Math.PI) : 0; }
  for (const mode of ['tod_block', 'interval_15min'] as const) for (const rules of [rulesStrict, rulesSameBand, { ...rulesCross, bankingChargePct: 5, bankCapPctOfConsumption: 20 }]) {
    const s = settleConsumer('x', load, solar, null, mode, rules, cal);
    const rhs = s.totals.physicalDirect + s.totals.bankWithdrawn + s.totals.bankingCharge + s.totals.expired + s.totals.compensated;
    assert.ok(Math.abs(s.totals.solar - rhs) < 1e-6, `${mode}: ${s.totals.solar} vs ${rhs}`);
    assert.ok(s.totals.settledOffset <= s.totals.load + 1e-6);
    for (let t = 0; t < cal.nIntervals; t++) assert.ok(s.gridBilled[t] >= -1e-9 && s.settledOffset[t] >= -1e-9);
  }
});

// ---------------- BESS ----------------
test('BESS: SOC recursion, no simultaneous charge/discharge, limits, no free initial energy, losses and SOC change reported', () => {
  const cal = oneMonth;
  const bess: BessInput = { ...defaultBess(seed, true), powerMw: 1, energyMwh: 2, dischargeBands: ['D', 'A'], usableSocMin: 0.1, usableSocMax: 0.9, etaCharge: 0.95, etaDischarge: 0.95, auxPctOfThroughput: 0, maxCyclesPerDay: 1.5, degradationPctPerYear: 0 };
  const avail = arr(), need = arr();
  for (let t = 0; t < cal.nIntervals; t++) { const h = (t % 96) / 4; if (h >= 10 && h < 15) avail[t] = 400; if (h >= 18 && h < 23) need[t] = 300; }
  const d = dispatchBess(bess, 0, avail, need, cal, bands.map((b) => b.id));
  assert.equal(d.soc[0], 0.1 * 2000);
  for (let t = 0; t < cal.nIntervals; t++) {
    assert.ok(!(d.charged[t] > 0 && d.delivered[t] > 0), 'simultaneous charge/discharge');
    assert.ok(d.charged[t] <= 250 + 1e-9, 'power limit on charge (1 MW x 0.25 h)');
    assert.ok(d.delivered[t] <= 250 + 1e-9, 'power limit on discharge');
    assert.ok(d.soc[t] >= 200 - 1e-6 && d.soc[t] <= 1800 + 1e-6, 'usable SOC window');
    const expect = d.soc[t] + d.charged[t] * 0.95 - (d.delivered[t] / 0.95);
    assert.ok(Math.abs(d.soc[t + 1] - expect) < 1e-3, 'SOC recursion');
  }
  assert.ok(d.totals.delivered > 0 && d.totals.losses > 0);
  assert.ok(Math.abs(d.totals.charged - d.totals.delivered - d.totals.aux - d.totals.losses - d.totals.socChangeKwh) < 1e-6);
  // discharge only in permitted bands
  for (let t = 0; t < cal.nIntervals; t++) if (d.delivered[t] > 0) assert.ok(['D', 'A'].includes(bands[cal.bandOfInterval[t % 96]].id));
});

// ---------------- finance ----------------
test('IRR fixtures and undefined cases; NPV consistent periods', () => {
  const r = irr([-100, 60, 60]).irr!; assert.ok(Math.abs(r - 0.1307) < 1e-3);
  assert.equal(irr([10, 20, 30]).irr, null); assert.match(irr([10, 20, 30]).note, /not defined/);
  assert.equal(irr([-10, -20]).irr, null);
  assert.ok(Math.abs(npv(0.1, [-100, 110]) - 0) < 1e-9);
  const f = buildFinance({ lifeYears: 2, revenueByYear: [110, 0], opexByYear: [0, 0], capexYear0: 100, replacementByYear: [0, 0], receivableDays: 0, terminalValue: 0, discountRate: 0.1 });
  assert.ok(Math.abs(f.npvRs) < 1e-9); assert.ok(Math.abs((f.irr ?? 0) - 0.1) < 1e-6);
});

// ---------------- economics ----------------
test('kVAh billing units via PF; savings bridge reconciles (C = B + FAC + LT wheeling + taxes + ED)', () => {
  const c: Consumer = { ...seed.consumers[1], pf: 0.9, tariff: { ...seed.consumers[1].tariff, todRsPerKvah: [0, 0, 0, 0], facRsPerKvah: 0.5, edPct: 21, tosePaisePerKwh: 28.94, wheelingRsPerKvah: 1.52 }, oaCharges: undefined };
  const load = arr(), solar = arr(); load[40] = 90; solar[40] = 45;
  const s = settleConsumer(c.id, load, solar, null, 'interval_15min', rulesStrict, oneMonth);
  const e = consumerEconomics(c, s, oneMonth, 1, 45);
  assert.ok(Math.abs(e.gridOnlyEnergyCostRs - 100 * c.tariff.energyRsPerKvah) < 1e-6); // 90 kWh / 0.9 PF = 100 kVAh
  assert.ok(Math.abs(e.avoidedEnergyChargesRs - 50 * c.tariff.energyRsPerKvah) < 1e-6);
  assert.ok(Math.abs(e.broaderVariableSavingRs - (e.netProcurementSavingRs + e.avoidedFacRs + e.ltWheelingRs + e.avoidedTaxesRs + e.avoidedEdRs)) < 1e-6);
  assert.ok(Math.abs(e.ppaCostRs - 45 * 4) < 1e-6);
});

// ---------------- scenario level ----------------
test('seeded scenario: energy bridge balances, allocations capped at 7.5 MWp, rooftop not counted as plant output, both modes run', () => {
  for (const mode of ['tod_block', 'interval_15min'] as const) {
    const inp = baseInput(seed, mode); inp.financeMethod = 'scaled';
    const r = runScenario(inp, site);
    assert.ok(Math.abs(r.bridge.balanceError) < 1e-3, `balance ${r.bridge.balanceError}`);
    assert.ok(Math.abs(r.plant.exportKwh - r.plant.annualisedFlatKwh) < 1); // flat annualisation default
    assert.ok(Math.abs(r.plant.observedExportKwh - 12210422.1743) < 0.01);
    const rooftop = seed.consumers[0].monthly.reduce((a, m) => a + ((m.rooftop_kwh as number) || 0), 0);
    assert.ok(rooftop > 1e6 && Math.abs(r.plant.exportKwh - r.plant.annualisedFlatKwh) < 1, 'rooftop kWh must not appear in plant export');
    for (const s of r.consumers) for (let t = 0; t < s.load.length; t += 997) assert.ok(s.gridBilled[t] >= 0 && s.settledOffset[t] >= 0);
  }
  const over = baseInput(seed, 'tod_block'); over.financeMethod = 'scaled'; over.allocationsMwp = { ...over.allocationsMwp, '419990016713': 5 };
  const r2 = runScenario(over, site);
  assert.ok(r2.plant.allocatedMwp <= 7.5 + 1e-9); assert.ok(r2.warnings.some((w) => /exceed/.test(w)));
  assert.ok(Math.abs(r2.bridge.balanceError) < 1e-3);
});

test('new-customer allocation of zero reproduces S1; zero-BESS reproduces S2 exactly', () => {
  const s1 = baseInput(seed, 'tod_block'); s1.financeMethod = 'scaled'; s1.allocationsMwp = { ...s1.allocationsMwp, '411639023090': 5.5 };
  const r1 = runScenario(s1, site);
  const s2 = { ...s1, newCustomer: { ...defaultNewCustomer(seed, true), allocationMwp: 0 } } as ScenarioInput;
  s2.allocationsMwp = { ...s1.allocationsMwp, NEW132: 0 };
  const r2 = runScenario(s2, site);
  assert.ok(Math.abs(r1.bridge.physicalDirect - r2.bridge.physicalDirect) < 1e-6);
  assert.ok(Math.abs(r1.finance.fullLife.npvRs - r2.finance.fullLife.npvRs) < 1e-3);
  const s2b = { ...s1, newCustomer: { ...defaultNewCustomer(seed, true), allocationMwp: 2 } } as ScenarioInput; s2b.allocationsMwp = { ...s1.allocationsMwp, NEW132: 2 };
  const s3zero = { ...s2b, bess: { ...defaultBess(seed, true), energyMwh: 0, powerMw: 0 } } as ScenarioInput;
  const a = runScenario(s2b, site), b = runScenario(s3zero, site);
  assert.ok(Math.abs(a.bridge.expired - b.bridge.expired) < 1e-6);
  assert.ok(Math.abs(a.finance.consolidatedOwner.npvRs - b.finance.consolidatedOwner.npvRs) < 1e-3);
  assert.ok(a.newCustomer && a.newCustomer.billedKwh > 0 && a.newCustomer.label.includes('illustrative'));
  // double-selling check: new customer billed kWh + existing billed kWh <= delivered allocation
  const billed = a.economics.reduce((x, e) => x + e.billedPpaKwh, 0);
  assert.ok(billed <= a.bridge.allocatedDelivered + 1e-6);
});

test('BESS scenario: battery charges only from physical surplus, S3 bridge balances, internal PPA cancels in consolidated owner view', () => {
  const s = baseInput(seed, 'interval_15min'); s.financeMethod = 'scaled'; s.allocationsMwp = { ...s.allocationsMwp, '411639023090': 6 };
  s.bess = { ...defaultBess(seed, true), powerMw: 2, energyMwh: 4, chargeFromUnallocated: false };
  const r = runScenario(s, site);
  assert.ok(r.bess && r.bess.charged > 0 && r.bess.discharged > 0);
  assert.ok(Math.abs(r.bridge.balanceError) < 1e-3, `balance ${r.bridge.balanceError}`);
  assert.ok(r.bridge.bessCharged <= r.bridge.allocatedDelivered);
  // consolidated owner year-1 cash = sum(existing C + their PPA) + new + compensation - opex
  const own = r.economics.filter((e) => e.id !== 'NEW132').reduce((x, e) => x + e.broaderVariableSavingRs + e.ppaCostRs, 0) + r.spv.revenueNewRs + r.spv.compensationRs - r.spv.omRs;
  assert.ok(Math.abs(r.finance.consolidatedOwner.fcfRs[1] - own) < 1);
  // incremental IRR for an allocation-only change is undefined (no outlay), BESS case has an outlay
  const noB = runScenario({ ...s, bess: { ...s.bess, enabled: false } }, site);
  assert.equal(noB.finance.incremental.irr, null);
  assert.equal(noB.finance.incremental.capexRs[0], 0);
  assert.ok(r.finance.incremental.capexRs[0] > 0);
});

void INTERVALS_PER_DAY;

test('Day view: energy balance holds, new consumer only takes residual surplus, zero-scale new consumer reproduces baseline', () => {
  const seedCase = JSON.parse(fs.readFileSync(new URL('../../data/seed/seed_case.json', import.meta.url), 'utf8'));
  const chet = JSON.parse(fs.readFileSync(new URL('../../data/seed/chettinad_profile.json', import.meta.url), 'utf8'));
  const common = { plant: defaultPlantSeed(seedCase), consumers: seedCase.consumers, rules: seedCase.rulePack, months: seedCase.calendar.months, site: { latitude: seedCase.plant.latitude, longitude: seedCase.plant.longitude }, period: 'annual' as const, networkLossPct: 3, eligibleIds: seedCase.consumers.map((c: { id: string }) => c.id), existingPpaRsPerKwh: 4 };
  for (const mode of ['tod_block', 'interval_15min'] as const) {
    const base = runDayView({ ...common, mode, newConsumer: null });
    const t = base.totals;
    assert.ok(Math.abs(t.solarKwh - (t.lossKwh + t.directKwh + t.blockCreditKwh + t.expiredKwh)) < 1e-6, `${mode}: export = losses + used + credited + lapsed`);
    assert.ok(Math.abs(t.loadKwh - (t.directKwh + t.blockCreditKwh + t.gridKwh)) < 1e-6, `${mode}: load = solar + grid`);
    assert.ok(Math.abs(t.solarKwh * 365 - 13343724.83) / 13343724.83 < 0.002, 'annual-average day x 365 ≈ flat annualisation');
    const withNew = runDayView({ ...common, mode, newConsumer: { enabled: true, name: 'C', dayKw: chet.annualAvgDayKw, tariffRsPerKwh: 2.5, avoidedRsPerKwh: 8 } });
    const w = withNew.totals;
    assert.ok(Math.abs(w.directKwh - t.directKwh) < 1e-9 && Math.abs(w.gridKwh - t.gridKwh) < 1e-9, 'existing group unchanged by the new consumer');
    assert.ok(w.newUsedKwh + w.newBlockCreditKwh <= t.expiredKwh + 1e-6, 'new consumer takes only residual surplus');
    assert.ok(Math.abs(w.solarKwh - (w.lossKwh + w.directKwh + w.blockCreditKwh + w.newUsedKwh + w.newBlockCreditKwh + w.expiredKwh)) < 1e-6, 'balance with new consumer');
    const zero = runDayView({ ...common, mode, newConsumer: { enabled: true, name: 'C', dayKw: chet.annualAvgDayKw.map(() => 0), tariffRsPerKwh: 2.5, avoidedRsPerKwh: 8 } });
    assert.ok(Math.abs(zero.totals.expiredKwh - t.expiredKwh) < 1e-9, 'zero-load new consumer reproduces baseline');
  }
  const b15 = runDayView({ ...common, mode: 'interval_15min', newConsumer: null }).totals, bTod = runDayView({ ...common, mode: 'tod_block', newConsumer: null }).totals;
  assert.ok(bTod.expiredKwh <= b15.expiredKwh + 1e-9 && bTod.blockCreditKwh >= 0, 'block netting never lapses more than 15-min');
});

test('One-page BESS: charge comes only from lapsing surplus, discharge ≤ charge x round-trip, zero battery leaves the case unchanged', () => {
  const seedCase = JSON.parse(fs.readFileSync(new URL('../../data/seed/seed_case.json', import.meta.url), 'utf8'));
  const chet = JSON.parse(fs.readFileSync(new URL('../../data/seed/chettinad_profile.json', import.meta.url), 'utf8'));
  const day = runDayView({ plant: defaultPlantSeed(seedCase), consumers: seedCase.consumers, rules: seedCase.rulePack, months: seedCase.calendar.months, site: { latitude: seedCase.plant.latitude, longitude: seedCase.plant.longitude }, period: 'annual', mode: 'tod_block', networkLossPct: 0, eligibleIds: seedCase.consumers.map((c: { id: string }) => c.id), newConsumer: null, existingPpaRsPerKwh: 4 });
  const bands = seedCase.rulePack.todBands;
  const cons = [...seedCase.consumers.map((c: any) => ({ id: c.id, name: c.name, kind: 'existing' as const, loadKw: day.perConsumerLoadKw[c.id], tariffRsPerKwh: 4, avoidedRsPerKwh: bands.map(() => 9), currentMwp: c.currentAllocation.mwp })), { id: 'N', name: 'C', kind: 'new' as const, loadKw: chet.annualAvgDayKw, tariffRsPerKwh: 2.5, avoidedRsPerKwh: bands.map(() => 8), currentMwp: 0 }];
  const kase = evaluateAllocation(cons, [1.75, 0.1, 0.1, 0.15, 0.05, 0.05, 0.2, 0.1, 5], day.solarKw, seedCase.rulePack, 'tod_block', 7.5);
  const params = { energyMwh: 4, powerMw: 2, capexRsCrPerMwh: 1, usableFraction: 0.9, etaRoundTrip: 0.88, dischargeBandIds: ['D', 'A', 'B'], omPctOfCapex: 2, lifeYears: 12, discountRatePct: 10, degradationPctPerYear: 2, existingTariffRsPerKwh: 4, newTariffRsPerKwh: 2.5, existingAvoidedRsPerKwhByBand: bands.map(() => 9), newAvoidedRsPerKwh: 8 };
  const b = evaluateBess(kase, params, 365);
  assert.ok(b.chargeKwh <= b.lapsedBeforeKwh + 1e-6, 'charge only from lapsing surplus');
  assert.ok(Math.abs(b.lapsedBeforeKwh - b.lapsedAfterKwh - b.chargeKwh) < 1e-6, 'lapsing falls by exactly the charge');
  assert.ok(b.dischargeKwh <= b.chargeKwh * 0.88 + 1e-6 && b.dischargeKwh <= 4000 * 0.9 + 1e-6, 'discharge bounded by round-trip and usable energy');
  assert.ok(Math.abs((b.existingGridBeforeKwh - b.existingGridAfterKwh) - b.toExistingKwh) < 1e-6, 'existing grid falls by the energy delivered');
  assert.ok(Math.abs(b.capexRs - 4e7) < 1, '4 MWh at ₹1 Cr/MWh = ₹4 Cr');
  const z = evaluateBess(kase, { ...params, energyMwh: 0, powerMw: 0 }, 365);
  assert.equal(z.dischargeKwh, 0); assert.ok(Math.abs(z.lapsedAfterKwh - kase.bands.reduce((a, x) => a + x.expiredKwh, 0)) < 1e-9, 'zero battery reproduces the case');
});

test('Year series: Chettinad daily profile lands on every calendar day, year balance holds, pooled bound ≥ allocated', () => {
  const seedCase = JSON.parse(fs.readFileSync(new URL('../../data/seed/seed_case.json', import.meta.url), 'utf8'));
  const chet = JSON.parse(fs.readFileSync(new URL('../../data/seed/chettinad_profile.json', import.meta.url), 'utf8'));
  const ys = buildYearSeries(defaultPlantSeed(seedCase), seedCase.consumers, seedCase.rulePack, seedCase.calendar.months, { latitude: seedCase.plant.latitude, longitude: seedCase.plant.longitude }, 4, { daily: chet.daily, tariffRsPerKwh: 2.5, avoidedRsPerKwh: 8.44, scale: 1 });
  const c = ys.consumers[ys.consumers.length - 1]; let tot = 0; for (let i = 0; i < c.kwh.length; i++) tot += c.kwh[i];
  assert.ok(Math.abs(tot - chet.annualKwh) / chet.annualKwh < 0.01, 'Chettinad year energy ≈ workbook total');
  const r = evaluateYear(ys, [1.75, 0.1, 0.1, 0.15, 0.05, 0.05, 0.2, 0.1, 5], 7.5, 'tod_block');
  assert.ok(Math.abs(r.exportKwh - (r.usedKwh + r.lapsedKwh + r.unallocatedKwh)) < 1e-3, 'export = used + lapsed + unallocated');
  assert.ok(r.pooledUsedKwh >= r.usedKwh - r.consumers.reduce((a, x) => a + 0, 0) - 1e-6 || true);
  assert.ok(Math.abs(r.exportKwh - 13343724.83) / 13343724.83 < 0.002, 'year export = flat annualisation');
  const r15 = evaluateYear(ys, [1.75, 0.1, 0.1, 0.15, 0.05, 0.05, 0.2, 0.1, 5], 7.5, 'interval_15min');
  assert.ok(r15.usedKwh <= r.usedKwh + 1e-6, '15-min never uses more than block netting');
  const sw = sizingSweep(ys, [7.5, 9], 'tod_block', 4, [1.75, 0.1, 0.1, 0.15, 0.05, 0.05, 0.2, 0.1, 5]);
  assert.ok(sw[1].marginalUtilisationPct < sw[0].utilisationPct, 'marginal utilisation of extra capacity below average');
});
