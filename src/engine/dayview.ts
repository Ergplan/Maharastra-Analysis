// One-day representative view: annual-average (or month-average) 15-minute day for the whole plant and all consumers.
// Deliberately simple: every existing consumer is treated as eligible and solar is pooled across the group
// (physical 15-minute matching first, then optional same-ToD-band netting for the block-settlement view).
// Units: kW for curves (average over the 15-min block), kWh for energy. ₹ at interfaces only.

import type { Calendar, Consumer, PlantInput, RulePack, SettlementMode, TodBand } from './types.ts';
import { INTERVALS_PER_DAY, INTERVAL_HOURS, buildCalendar } from './calendar.ts';
import { buildSolar } from './solar.ts';
import { buildConsumerLoad } from './profiles.ts';

export interface DayViewInput {
  plant: PlantInput;
  consumers: Consumer[];
  rules: RulePack;
  months: string[];
  site: { latitude: number; longitude: number };
  period: 'annual' | string;          // 'annual' or 'YYYY-MM' (average day of that month)
  mode: SettlementMode;               // tod_block => same-band netting of surplus against grid within the day
  networkLossPct: number;             // in-kind wheeling/transmission loss on injected solar (0-20)
  eligibleIds: string[];              // consumers that may take captive solar (default: all)
  newConsumer: { enabled: boolean; name: string; dayKw: number[]; tariffRsPerKwh: number; avoidedRsPerKwh: number } | null;
  existingPpaRsPerKwh: number;        // ₹4 default
}

export interface DayBand { id: string; label: string; startHour: number; endHour: number; hours: number;
  loadKwh: number; solarDirectKwh: number; blockCreditKwh: number; gridKwh: number; surplusAfterGroupKwh: number; newUsedKwh: number; newBlockCreditKwh: number; newLoadKwh: number; newGridKwh: number; expiredKwh: number; lossKwh: number; solarKwh: number }

export interface DayViewResult {
  period: string; daysAveraged: number; mode: SettlementMode;
  x: number[];                             // 96 interval start hours
  solarKw: number[]; solarDeliveredKw: number[]; loadKw: number[]; directKw: number[]; gridKw: number[]; surplusKw: number[];
  newLoadKw: number[]; newUsedKw: number[]; residualSurplusKw: number[];
  perConsumerLoadKw: Record<string, number[]>;
  bands: DayBand[];
  totals: {
    solarKwh: number; lossKwh: number; deliveredKwh: number; loadKwh: number; directKwh: number; blockCreditKwh: number; gridKwh: number; gridPhysicalKwh: number;
    surplusAfterGroupKwh: number; newLoadKwh: number; newUsedKwh: number; newBlockCreditKwh: number; expiredKwh: number; usefulKwh: number;
    utilisationPct: number; groupSolarSharePct: number;
  };
  money: { existingAvoidedRs: number; existingPpaRs: number; existingNetSavingRs: number; spvExistingRs: number; spvNewRs: number; newAvoidedRs: number; newNetSavingRs: number; expiredValueAtNewTariffRs: number; expiredValueAtPpaRs: number; lossValueAtPpaRs: number };
  annualised: { factor: number; usefulKwh: number; expiredKwh: number; spvNewRs: number; existingNetSavingRs: number; newNetSavingRs: number; expiredValueAtNewTariffRs: number };
  notes: string[];
}

function avgDay(series: Float64Array, cal: Calendar, dayIdx: number[]): number[] {
  const out = new Array(INTERVALS_PER_DAY).fill(0);
  for (const d of dayIdx) for (let i = 0; i < INTERVALS_PER_DAY; i++) out[i] += series[d * INTERVALS_PER_DAY + i];
  const n = dayIdx.length || 1;
  return out.map((v) => v / n / INTERVAL_HOURS); // kWh/interval -> average kW
}

/** Energy-weighted avoided ₹/kWh of a consumer in a band (energy charge + ToD, kVAh billing via PF). */
function avoidedRate(c: Consumer, bandIdx: number): number {
  const t = c.tariff;
  const perKvah = t.energyRsPerKvah + (t.todRsPerKvah[bandIdx] ?? 0) + (t.facRsPerKvah ?? 0) + (t.wheelingRsPerKvah ?? 0);
  const kvahPerKwh = t.pfBillingUnit === 'kVAh' ? 1 / Math.max(0.8, c.pf || 1) : 1;
  return perKvah * kvahPerKwh;
}

export function runDayView(inp: DayViewInput): DayViewResult {
  const bands = inp.rules.todBands;
  const cal = buildCalendar(inp.months, bands);
  const solar = buildSolar(inp.plant, cal, inp.site.latitude, inp.site.longitude);
  const dayIdx: number[] = [];
  for (let d = 0; d < cal.dayDates.length; d++) {
    if (inp.period === 'annual' || cal.dayDates[d].startsWith(inp.period)) dayIdx.push(d);
  }
  const notes: string[] = [];
  const solarKw = avgDay(solar.kwh, cal, dayIdx);
  const lossF = Math.min(0.5, Math.max(0, inp.networkLossPct / 100));
  const solarDeliveredKw = solarKw.map((v) => v * (1 - lossF));

  const perConsumerLoadKw: Record<string, number[]> = {};
  const loadKw = new Array(INTERVALS_PER_DAY).fill(0);
  const eligible = new Set(inp.eligibleIds);
  const bandLoadByConsumer: number[][] = [];
  for (const c of inp.consumers) {
    const ls = buildConsumerLoad(c, cal, bands, 'flat', true);
    const day = avgDay(ls.kwh, cal, dayIdx);
    perConsumerLoadKw[c.id] = day;
    if (!eligible.has(c.id)) continue;
    for (let i = 0; i < INTERVALS_PER_DAY; i++) loadKw[i] += day[i];
    const bl = bands.map(() => 0);
    for (let i = 0; i < INTERVALS_PER_DAY; i++) bl[cal.bandOfInterval[i]] += day[i] * INTERVAL_HOURS;
    bandLoadByConsumer.push(bl);
  }
  const eligibleConsumers = inp.consumers.filter((c) => eligible.has(c.id));

  // Physical 15-minute matching for the existing group (pooled).
  const directKw = new Array(INTERVALS_PER_DAY).fill(0), gridKw = new Array(INTERVALS_PER_DAY).fill(0), surplusKw = new Array(INTERVALS_PER_DAY).fill(0);
  for (let i = 0; i < INTERVALS_PER_DAY; i++) {
    directKw[i] = Math.min(loadKw[i], solarDeliveredKw[i]);
    gridKw[i] = loadKw[i] - directKw[i];
    surplusKw[i] = solarDeliveredKw[i] - directKw[i];
  }
  // New consumer takes what is physically left, 15-minute.
  const nc = inp.newConsumer && inp.newConsumer.enabled ? inp.newConsumer : null;
  const newLoadKw = nc ? nc.dayKw.slice(0, INTERVALS_PER_DAY) : new Array(INTERVALS_PER_DAY).fill(0);
  const newUsedKw = new Array(INTERVALS_PER_DAY).fill(0), residualSurplusKw = new Array(INTERVALS_PER_DAY).fill(0);
  for (let i = 0; i < INTERVALS_PER_DAY; i++) {
    newUsedKw[i] = nc ? Math.min(newLoadKw[i], surplusKw[i]) : 0;
    residualSurplusKw[i] = surplusKw[i] - newUsedKw[i];
  }

  // Band aggregation + optional same-band netting (ToD block settlement): surplus left in a band is credited
  // against grid drawal in the same band (group first, then the new consumer). No cross-band, no carry-over.
  const dayBands: DayBand[] = bands.map((b: TodBand) => ({ id: b.id, label: b.label, startHour: b.startHour, endHour: b.endHour, hours: b.endHour - b.startHour,
    loadKwh: 0, solarDirectKwh: 0, blockCreditKwh: 0, gridKwh: 0, surplusAfterGroupKwh: 0, newUsedKwh: 0, newBlockCreditKwh: 0, newLoadKwh: 0, newGridKwh: 0, expiredKwh: 0, lossKwh: 0, solarKwh: 0 }));
  for (let i = 0; i < INTERVALS_PER_DAY; i++) {
    const b = dayBands[cal.bandOfInterval[i]]; const h = INTERVAL_HOURS;
    b.loadKwh += loadKw[i] * h; b.solarDirectKwh += directKw[i] * h; b.gridKwh += gridKw[i] * h; b.surplusAfterGroupKwh += surplusKw[i] * h;
    b.newUsedKwh += newUsedKw[i] * h; b.newLoadKwh += newLoadKw[i] * h; b.expiredKwh += residualSurplusKw[i] * h; b.lossKwh += (solarKw[i] - solarDeliveredKw[i]) * h; b.solarKwh += solarKw[i] * h;
  }
  for (const b of dayBands) {
    b.newGridKwh = b.newLoadKwh - b.newUsedKwh;
    if (inp.mode === 'tod_block') {
      // Existing group has first claim on the band's surplus (protect existing savings), then the new consumer.
      const credit = Math.min(b.surplusAfterGroupKwh, b.gridKwh);
      b.blockCreditKwh = credit; b.gridKwh -= credit;
      let remaining = b.surplusAfterGroupKwh - credit;
      if (nc) {
        const used = Math.min(b.newUsedKwh, remaining); b.newUsedKwh = used; b.newGridKwh = b.newLoadKwh - used; remaining -= used;
        const c2 = Math.min(remaining, b.newGridKwh); b.newBlockCreditKwh = c2; b.newGridKwh -= c2; remaining -= c2;
      }
      b.expiredKwh = remaining;
    }
  }
  if (inp.mode === 'tod_block') notes.push('ToD block settlement: surplus inside a band is credited against grid drawal in the same band (same-day, same-band netting as the bill-calibrated rule pack); nothing carries across bands or days.');
  else notes.push('15-minute settlement: only solar coincident with load in the same 15-minute block counts; all other surplus lapses.');

  const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
  const t = {
    solarKwh: sum(dayBands.map((b) => b.solarKwh)), lossKwh: sum(dayBands.map((b) => b.lossKwh)), deliveredKwh: 0, loadKwh: sum(dayBands.map((b) => b.loadKwh)),
    directKwh: sum(dayBands.map((b) => b.solarDirectKwh)), blockCreditKwh: sum(dayBands.map((b) => b.blockCreditKwh)), gridKwh: sum(dayBands.map((b) => b.gridKwh)), gridPhysicalKwh: sum(gridKw) * INTERVAL_HOURS,
    surplusAfterGroupKwh: sum(dayBands.map((b) => b.surplusAfterGroupKwh)), newLoadKwh: sum(dayBands.map((b) => b.newLoadKwh)), newUsedKwh: sum(dayBands.map((b) => b.newUsedKwh)), newBlockCreditKwh: sum(dayBands.map((b) => b.newBlockCreditKwh)),
    expiredKwh: sum(dayBands.map((b) => b.expiredKwh)), usefulKwh: 0, utilisationPct: 0, groupSolarSharePct: 0,
  };
  t.deliveredKwh = t.solarKwh - t.lossKwh;
  t.usefulKwh = t.directKwh + t.blockCreditKwh + t.newUsedKwh + t.newBlockCreditKwh;
  t.utilisationPct = t.solarKwh > 0 ? (t.usefulKwh / t.solarKwh) * 100 : 0;
  t.groupSolarSharePct = t.loadKwh > 0 ? ((t.directKwh + t.blockCreditKwh) / t.loadKwh) * 100 : 0;

  // Money (approximate attribution: group solar valued at the load-weighted avoided rate per band).
  let existingAvoidedRs = 0;
  dayBands.forEach((b, bi) => {
    const solarToGroup = b.solarDirectKwh + b.blockCreditKwh;
    if (solarToGroup <= 0) return;
    let w = 0, rate = 0;
    eligibleConsumers.forEach((c, ci) => { const l = bandLoadByConsumer[ci][bi]; w += l; rate += l * avoidedRate(c, bi); });
    existingAvoidedRs += solarToGroup * (w > 0 ? rate / w : 0);
  });
  const existingSolar = t.directKwh + t.blockCreditKwh;
  const existingPpaRs = existingSolar * inp.existingPpaRsPerKwh;
  const newSolar = t.newUsedKwh + t.newBlockCreditKwh;
  const spvNewRs = nc ? newSolar * nc.tariffRsPerKwh : 0;
  const newAvoidedRs = nc ? newSolar * nc.avoidedRsPerKwh : 0;
  const money = {
    existingAvoidedRs, existingPpaRs, existingNetSavingRs: existingAvoidedRs - existingPpaRs, spvExistingRs: existingPpaRs, spvNewRs,
    newAvoidedRs, newNetSavingRs: newAvoidedRs - spvNewRs,
    expiredValueAtNewTariffRs: t.expiredKwh * (nc ? nc.tariffRsPerKwh : 2.5), expiredValueAtPpaRs: t.expiredKwh * inp.existingPpaRsPerKwh, lossValueAtPpaRs: t.lossKwh * inp.existingPpaRsPerKwh,
  };
  const factor = inp.period === 'annual' ? 365 : dayIdx.length;
  const annualised = { factor, usefulKwh: t.usefulKwh * factor, expiredKwh: t.expiredKwh * factor, spvNewRs: spvNewRs * factor, existingNetSavingRs: money.existingNetSavingRs * factor, newNetSavingRs: money.newNetSavingRs * factor, expiredValueAtNewTariffRs: money.expiredValueAtNewTariffRs * factor };
  notes.push(`Representative day = average of ${dayIdx.length} calendar days (${inp.period === 'annual' ? 'Nov-25 → Oct-26, October estimated' : inp.period}); intraday shapes are reconstructions normalised to reported daily export and billed ToD totals.`);
  if (lossF > 0) notes.push(`Network losses taken in kind at ${inp.networkLossPct}% of injection (editable). MSEDCL is separately billing loss charges in ₹ — do not count both.`);
  notes.push('Existing-consumer savings are approximate: pooled solar is valued at each band\'s load-weighted avoided rate (energy charge + ToD + FAC, kVAh via PF). Demand charges unchanged.');
  return { period: inp.period, daysAveraged: dayIdx.length, mode: inp.mode, x: Array.from({ length: INTERVALS_PER_DAY }, (_, i) => i * INTERVAL_HOURS), solarKw, solarDeliveredKw, loadKw, directKw, gridKw, surplusKw, newLoadKw, newUsedKw, residualSurplusKw, perConsumerLoadKw, bands: dayBands, totals: t, money, annualised, notes };
}

// ---------------------------------------------------------------------------------------------
// Capacity allocation on the representative day.
// Each consumer holds a frozen share s_c of every interval's plant export (contractual MWp = s_c x 7.5).
// Useful energy for a share: Σ_t min(load_c(t), s_c·E(t)) (+ same-band credit under ToD-block settlement).
// Greedy search in fixed MWp steps: give the next step to the consumer whose marginal useful energy x tariff is highest.
// This is a bounded search ("best evaluated"), not a proven optimum. Objective 'energy' ignores tariffs.
// ---------------------------------------------------------------------------------------------

export interface AllocConsumer { id: string; name: string; kind: 'existing' | 'new'; loadKw: number[]; tariffRsPerKwh: number; avoidedRsPerKwh: number[]; currentMwp: number; maxMwp?: number }
export interface AllocRow { id: string; name: string; kind: 'existing' | 'new'; mwp: number; currentMwp: number; energyEquivalentMwp: number; loadKwh: number; allocatedKwh: number; usedKwh: number; creditKwh: number; lapsedKwh: number; gridKwh: number; utilisationPct: number; solarSharePct: number; spvRevenueRs: number; consumerSavingRs: number; marginalUtilAtCutPct: number }
export interface AllocResult { rows: AllocRow[]; totalMwp: number; unallocatedMwp: number; stepMwp: number; objective: 'revenue' | 'energy'; totals: { usedKwh: number; lapsedKwh: number; unallocatedKwh: number; spvRevenueRs: number; consumerSavingRs: number; utilisationPct: number }; note: string }

function usedForShare(load: number[], solarKw: number[], share: number, bandOf: Int8Array, nBands: number, mode: SettlementMode): { used: number; credit: number; alloc: number } {
  const h = INTERVAL_HOURS; let used = 0, alloc = 0;
  const bandSurplus = new Array(nBands).fill(0), bandGrid = new Array(nBands).fill(0);
  for (let i = 0; i < load.length; i++) {
    const s = solarKw[i] * share * h, l = load[i] * h, d = Math.min(s, l);
    used += d; alloc += s; bandSurplus[bandOf[i]] += s - d; bandGrid[bandOf[i]] += l - d;
  }
  let credit = 0;
  if (mode === 'tod_block') for (let b = 0; b < nBands; b++) credit += Math.min(bandSurplus[b], bandGrid[b]);
  return { used, credit, alloc };
}

export function allocateCapacity(consumers: AllocConsumer[], solarKw: number[], rules: RulePack, mode: SettlementMode, plantMwp: number, objective: 'revenue' | 'energy', stepMwp = 0.05): AllocResult {
  const cal = buildCalendar(['2026-01'], rules.todBands); const bandOf = cal.bandOfInterval; const nB = rules.todBands.length;
  const dayExport = solarKw.reduce((a, v) => a + v * INTERVAL_HOURS, 0);
  const yieldPerMwp = dayExport / plantMwp; // kWh/day per MWp
  const shares = consumers.map(() => 0);
  const value = (ci: number, share: number) => { const u = usedForShare(consumers[ci].loadKw, solarKw, share, bandOf, nB, mode); const e = u.used + u.credit; return objective === 'energy' ? e : e * consumers[ci].tariffRsPerKwh; };
  const cur = consumers.map((_, ci) => value(ci, 0));
  let placed = 0; const stepShare = stepMwp / plantMwp; const marginalAtCut = consumers.map(() => 0);
  while (placed + stepMwp <= plantMwp + 1e-9) {
    let best = -1, bestGain = 1e-6, bestVal = 0;
    for (let ci = 0; ci < consumers.length; ci++) {
      const max = consumers[ci].maxMwp ?? plantMwp; if (shares[ci] * plantMwp + stepMwp > max + 1e-9) continue;
      const v = value(ci, shares[ci] + stepShare); const gain = v - cur[ci];
      if (gain > bestGain) { best = ci; bestGain = gain; bestVal = v; }
    }
    if (best < 0) break;
    const stepEnergy = stepMwp * yieldPerMwp; marginalAtCut[best] = objective === 'energy' ? bestGain / stepEnergy : bestGain / consumers[best].tariffRsPerKwh / stepEnergy;
    shares[best] += stepShare; cur[best] = bestVal; placed += stepMwp;
  }
  const rows: AllocRow[] = consumers.map((c, ci) => {
    const u = usedForShare(c.loadKw, solarKw, shares[ci], bandOf, nB, mode);
    const loadKwh = c.loadKw.reduce((a, v) => a + v * INTERVAL_HOURS, 0);
    const used = u.used + u.credit; const h = INTERVAL_HOURS;
    // consumer saving: used energy valued at band avoided rate minus PPA
    let avoided = 0; const bandUsed = new Array(nB).fill(0);
    for (let i = 0; i < c.loadKw.length; i++) bandUsed[bandOf[i]] += Math.min(solarKw[i] * shares[ci] * h, c.loadKw[i] * h);
    const creditScale = u.used > 0 ? used / u.used : 1; // spread in-band credit pro rata over bands
    for (let b = 0; b < nB; b++) avoided += bandUsed[b] * creditScale * (c.avoidedRsPerKwh[b] ?? 0);
    return { id: c.id, name: c.name, kind: c.kind, mwp: +(shares[ci] * plantMwp).toFixed(2), currentMwp: c.currentMwp, energyEquivalentMwp: yieldPerMwp > 0 ? +(loadKwh / yieldPerMwp).toFixed(2) : 0,
      loadKwh, allocatedKwh: u.alloc, usedKwh: used, creditKwh: u.credit, lapsedKwh: u.alloc - used, gridKwh: loadKwh - used, utilisationPct: u.alloc > 0 ? (used / u.alloc) * 100 : 0, solarSharePct: loadKwh > 0 ? (used / loadKwh) * 100 : 0,
      spvRevenueRs: used * c.tariffRsPerKwh, consumerSavingRs: avoided - used * c.tariffRsPerKwh, marginalUtilAtCutPct: marginalAtCut[ci] * 100 };
  });
  const usedKwh = rows.reduce((a, r) => a + r.usedKwh, 0), lapsed = rows.reduce((a, r) => a + r.lapsedKwh, 0);
  const totalMwp = +placed.toFixed(2);
  return { rows, totalMwp, unallocatedMwp: +(plantMwp - placed).toFixed(2), stepMwp, objective,
    totals: { usedKwh, lapsedKwh: lapsed, unallocatedKwh: dayExport * (1 - placed / plantMwp), spvRevenueRs: rows.reduce((a, r) => a + r.spvRevenueRs, 0), consumerSavingRs: rows.reduce((a, r) => a + r.consumerSavingRs, 0), utilisationPct: dayExport > 0 ? (usedKwh / dayExport) * 100 : 0 },
    note: `Greedy ${stepMwp} MWp steps on the representative day, objective = ${objective === 'revenue' ? 'SPV revenue (₹ tariff x useful kWh)' : 'useful kWh'}; frozen share of every interval's export per consumer; best evaluated allocation, not a proven optimum.` };
}
