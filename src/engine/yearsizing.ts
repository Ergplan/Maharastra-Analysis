// Whole-year (365 x 96) evaluation of frozen-share allocations and a plant-size sweep.
// Solar: reported daily export (Oct estimated) spread intraday, scaled by (plantMwp / 7.5) for sizing.
// Loads: bill-calibrated existing consumers (engine profiles) + Chettinad's own 15-min series per calendar day.
// Settlement: per 15-min block, frozen share of export per consumer; optional same-band, same-day netting (ToD block).

import type { Consumer, PlantInput, RulePack, SettlementMode } from './types.ts';
import { INTERVALS_PER_DAY, INTERVAL_HOURS, buildCalendar } from './calendar.ts';
import { buildSolar } from './solar.ts';
import { buildConsumerLoad } from './profiles.ts';

export interface YearConsumer { id: string; name: string; kind: 'existing' | 'new'; kwh: Float64Array; tariffRsPerKwh: number; avoidedRsPerKwhByBand: number[] }
export interface YearSeries { months: string[]; dayDates: string[]; dayMonthIdx: Int16Array; bandOfInterval: Int8Array; solarKwh: Float64Array; consumers: YearConsumer[]; dayExportKwh: Float64Array }

export function buildYearSeries(plant: PlantInput, consumers: Consumer[], rules: RulePack, months: string[], site: { latitude: number; longitude: number }, ppa: number, chettinad: { daily: Record<string, number[]>; tariffRsPerKwh: number; avoidedRsPerKwh: number; scale: number } | null): YearSeries {
  const cal = buildCalendar(months, rules.todBands);
  const solar = buildSolar(plant, cal, site.latitude, site.longitude);
  const bands = rules.todBands;
  const out: YearConsumer[] = consumers.map((c) => {
    const ls = buildConsumerLoad(c, cal, bands, 'flat', true);
    const avoided = bands.map((_, b) => (c.tariff.energyRsPerKvah + (c.tariff.todRsPerKvah[b] ?? 0) + (c.tariff.facRsPerKvah ?? 0) + (c.tariff.wheelingRsPerKvah ?? 0)) / Math.max(0.8, c.pf || 1));
    return { id: c.id, name: c.name, kind: 'existing', kwh: ls.kwh, tariffRsPerKwh: ppa, avoidedRsPerKwhByBand: avoided };
  });
  if (chettinad) {
    const kwh = new Float64Array(cal.nIntervals);
    cal.dayDates.forEach((date, d) => {
      const key = date.slice(5); // MM-DD -> Chettinad sheet has no year
      const row = chettinad.daily[key] ?? chettinad.daily[key.slice(0, 3) + '28'] ?? null;
      for (let i = 0; i < INTERVALS_PER_DAY; i++) kwh[d * INTERVALS_PER_DAY + i] = (row ? row[i] : 0) * INTERVAL_HOURS * chettinad.scale;
    });
    out.push({ id: 'NEW', name: 'Chettinad', kind: 'new', kwh, tariffRsPerKwh: chettinad.tariffRsPerKwh, avoidedRsPerKwhByBand: bands.map(() => chettinad.avoidedRsPerKwh) });
  }
  return { months: cal.months, dayDates: cal.dayDates, dayMonthIdx: cal.dayMonthIdx, bandOfInterval: cal.bandOfInterval, solarKwh: solar.kwh, consumers: out, dayExportKwh: solar.dailyKwh };
}

export interface YearMonthRow { month: string; exportKwh: number; loadKwh: number; usedKwh: number; lapsedKwh: number; gridKwh: number; utilisationPct: number; solarShareOfLoadPct: number; daytimeLoadKwh: number; daytimeSolarKwh: number }
export interface YearConsumerRow { id: string; name: string; kind: 'existing' | 'new'; mwp: number; loadKwh: number; allocatedKwh: number; usedKwh: number; lapsedKwh: number; utilisationPct: number; solarSharePct: number; spvRevenueRs: number; consumerSavingRs: number }
export interface YearResult { plantMwp: number; exportKwh: number; usedKwh: number; lapsedKwh: number; unallocatedKwh: number; utilisationPct: number; spvRevenueRs: number; existingSavingRs: number; newSavingRs: number; months: YearMonthRow[]; consumers: YearConsumerRow[]; pooledUsedKwh: number }

/** Evaluate one allocation (MWp per consumer) for a plant of `plantMwp` (export scaled from the 7.5 MWp series). */
export function evaluateYear(ys: YearSeries, mwps: number[], plantMwp: number, mode: SettlementMode, baseMwp = 7.5): YearResult {
  const scale = plantMwp / baseMwp; const nB = Math.max(...Array.from(ys.bandOfInterval)) + 1; const n = ys.solarKwh.length; const nd = ys.dayDates.length;
  const months = ys.months.map((m) => ({ month: m, exportKwh: 0, loadKwh: 0, usedKwh: 0, lapsedKwh: 0, gridKwh: 0, utilisationPct: 0, solarShareOfLoadPct: 0, daytimeLoadKwh: 0, daytimeSolarKwh: 0 }));
  const rows: YearConsumerRow[] = ys.consumers.map((c, ci) => ({ id: c.id, name: c.name, kind: c.kind, mwp: mwps[ci] ?? 0, loadKwh: 0, allocatedKwh: 0, usedKwh: 0, lapsedKwh: 0, utilisationPct: 0, solarSharePct: 0, spvRevenueRs: 0, consumerSavingRs: 0 }));
  const shares = ys.consumers.map((_, ci) => (mwps[ci] ?? 0) / plantMwp);
  let exportTot = 0, pooledUsed = 0;
  const bandSurplus = new Float64Array(nB), bandGrid = new Float64Array(nB);
  for (let d = 0; d < nd; d++) {
    const mi = ys.dayMonthIdx[d]; const base = d * INTERVALS_PER_DAY;
    for (let i = 0; i < INTERVALS_PER_DAY; i++) { const e = ys.solarKwh[base + i] * scale; exportTot += e; months[mi].exportKwh += e; if (ys.bandOfInterval[i] === 2) months[mi].daytimeSolarKwh += e; }
    // pooled upper bound (all consumers as one buyer)
    for (let i = 0; i < INTERVALS_PER_DAY; i++) { let l = 0; for (const c of ys.consumers) l += c.kwh[base + i]; pooledUsed += Math.min(l, ys.solarKwh[base + i] * scale); }
    ys.consumers.forEach((c, ci) => {
      bandSurplus.fill(0); bandGrid.fill(0); const bu = new Float64Array(nB);
      let used = 0, alloc = 0, load = 0;
      for (let i = 0; i < INTERVALS_PER_DAY; i++) {
        const s = ys.solarKwh[base + i] * scale * shares[ci], l = c.kwh[base + i], dd = Math.min(s, l); const b = ys.bandOfInterval[i];
        used += dd; alloc += s; load += l; bandSurplus[b] += s - dd; bandGrid[b] += l - dd; bu[b] += dd;
        if (b === 2) months[mi].daytimeLoadKwh += l;
      }
      let credit = 0;
      if (mode === 'tod_block') for (let b = 0; b < nB; b++) { const cr = Math.min(bandSurplus[b], bandGrid[b]); credit += cr; bu[b] += cr; }
      const tot = used + credit; let avoided = 0; for (let b = 0; b < nB; b++) avoided += bu[b] * c.avoidedRsPerKwhByBand[b];
      const r = rows[ci]; r.loadKwh += load; r.allocatedKwh += alloc; r.usedKwh += tot; r.lapsedKwh += alloc - tot; r.spvRevenueRs += tot * c.tariffRsPerKwh; r.consumerSavingRs += avoided - tot * c.tariffRsPerKwh;
      const m = months[mi]; m.loadKwh += load; m.usedKwh += tot; m.lapsedKwh += alloc - tot; m.gridKwh += load - tot;
    });
  }
  for (const r of rows) { r.utilisationPct = r.allocatedKwh > 0 ? (r.usedKwh / r.allocatedKwh) * 100 : 0; r.solarSharePct = r.loadKwh > 0 ? (r.usedKwh / r.loadKwh) * 100 : 0; }
  const allocShare = shares.reduce((a, b) => a + b, 0);
  for (const m of months) { m.lapsedKwh += m.exportKwh * (1 - allocShare); m.utilisationPct = m.exportKwh > 0 ? (m.usedKwh / m.exportKwh) * 100 : 0; m.solarShareOfLoadPct = m.loadKwh > 0 ? (m.usedKwh / m.loadKwh) * 100 : 0; }
  const used = rows.reduce((a, r) => a + r.usedKwh, 0);
  return { plantMwp, exportKwh: exportTot, usedKwh: used, lapsedKwh: rows.reduce((a, r) => a + r.lapsedKwh, 0), unallocatedKwh: exportTot * (1 - allocShare), utilisationPct: exportTot > 0 ? (used / exportTot) * 100 : 0,
    spvRevenueRs: rows.reduce((a, r) => a + r.spvRevenueRs, 0), existingSavingRs: rows.filter((r) => r.kind === 'existing').reduce((a, r) => a + r.consumerSavingRs, 0), newSavingRs: rows.filter((r) => r.kind === 'new').reduce((a, r) => a + r.consumerSavingRs, 0), months, consumers: rows, pooledUsedKwh: pooledUsed };
}

/** Greedy frozen-share allocation over the whole year (same rule as the day view, on 365 days). */
export function allocateYear(ys: YearSeries, plantMwp: number, mode: SettlementMode, objective: 'revenue' | 'energy', stepMwp = 0.25, maxMwp?: number[]): number[] {
  const nc = ys.consumers.length; const mwps = new Array(nc).fill(0);
  const value = (m: number[]) => { const r = evaluateYear(ys, m, plantMwp, mode); return objective === 'energy' ? r.usedKwh : r.spvRevenueRs; };
  let cur = value(mwps); let placed = 0;
  while (placed + stepMwp <= plantMwp + 1e-9) {
    let best = -1, bestGain = 1e-6, bestVal = 0;
    for (let ci = 0; ci < nc; ci++) {
      if (maxMwp && mwps[ci] + stepMwp > (maxMwp[ci] ?? plantMwp) + 1e-9) continue;
      const trial = mwps.slice(); trial[ci] += stepMwp; const v = value(trial); const g = v - cur;
      if (g > bestGain) { best = ci; bestGain = g; bestVal = v; }
    }
    if (best < 0) break;
    mwps[best] += stepMwp; cur = bestVal; placed += stepMwp;
  }
  return mwps.map((v) => +v.toFixed(2));
}

export interface SizingPoint { plantMwp: number; exportKwh: number; usedKwh: number; lapsedKwh: number; utilisationPct: number; marginalUtilisationPct: number; spvRevenueRs: number; incrementalRevenueRs: number; incrementalCapexRs: number; simplePaybackYears: number | null; mwps: number[] }
/** Sweep plant size; for each size re-allocate greedily (or scale a fixed allocation) and report marginal value of the added capacity. */
export function sizingSweep(ys: YearSeries, sizes: number[], mode: SettlementMode, capexRsCrPerMw: number, fixedMwps?: number[], objective: 'revenue' | 'energy' = 'revenue'): SizingPoint[] {
  const pts: SizingPoint[] = []; let prev: YearResult | null = null;
  for (const p of sizes) {
    const mwps = fixedMwps ? fixedMwps.map((m) => (m / fixedMwps.reduce((a, b) => a + b, 0)) * p) : allocateYear(ys, p, mode, objective, 0.25);
    const r = evaluateYear(ys, mwps, p, mode);
    const dE = prev ? r.exportKwh - prev.exportKwh : r.exportKwh, dU = prev ? r.usedKwh - prev.usedKwh : r.usedKwh, dR = prev ? r.spvRevenueRs - prev.spvRevenueRs : r.spvRevenueRs;
    const dC = (prev ? p - prev.plantMwp : p) * capexRsCrPerMw * 1e7;
    pts.push({ plantMwp: p, exportKwh: r.exportKwh, usedKwh: r.usedKwh, lapsedKwh: r.lapsedKwh + r.unallocatedKwh, utilisationPct: r.utilisationPct, marginalUtilisationPct: dE > 0 ? (dU / dE) * 100 : 0, spvRevenueRs: r.spvRevenueRs, incrementalRevenueRs: dR, incrementalCapexRs: dC, simplePaybackYears: dR > 0 ? dC / dR : null, mwps });
    prev = r;
  }
  return pts;
}
