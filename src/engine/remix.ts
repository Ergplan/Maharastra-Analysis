// Solar + wind mix sizing for a single consumer's measured 15-minute year (Chettinad).
// Wind is a SYNTHETIC Maharashtra profile (monsoon-dominant, evening/night-biased) until a real WRA/plant series is supplied.
// Matching: per 15-min block (solar + wind vs load) with optional same-band same-day netting (ToD block).

import type { RulePack, SettlementMode } from './types.ts';
import { INTERVALS_PER_DAY, INTERVAL_HOURS, buildCalendar } from './calendar.ts';
import type { YearSeries } from './yearsizing.ts';

/** Typical Maharashtra wind-belt monthly CUF (Satara/Sangli/Dhule class sites, modern turbines). Editable; annual ≈ 30%. */
export const MH_WIND_MONTHLY_CUF: Record<string, number> = { '01': 0.18, '02': 0.19, '03': 0.22, '04': 0.26, '05': 0.34, '06': 0.48, '07': 0.55, '08': 0.50, '09': 0.37, '10': 0.21, '11': 0.16, '12': 0.17 };

function hash01(s: string): number { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return ((h >>> 0) % 100000) / 100000; }

/** Wind kWh per 15-min block for 1 MW, over the calendar: monthly CUF x diurnal shape x deterministic day-to-day variability, re-normalised to the monthly CUF. */
export function buildWindPerMw(months: string[], dayDates: string[], dayMonthIdx: Int16Array, monthlyCuf: Record<string, number>, diurnalBias = 0.35): Float64Array {
  const n = dayDates.length * INTERVALS_PER_DAY; const out = new Float64Array(n);
  // diurnal: higher 17:00-03:00, lower 09:00-15:00 (typical for the Western Ghats lee sites in monsoon); bias 0 = flat
  const diurnal = new Array(INTERVALS_PER_DAY).fill(0).map((_, i) => { const h = i * INTERVAL_HOURS; const night = Math.cos(((h - 22) / 24) * 2 * Math.PI); return 1 + diurnalBias * night; });
  const monthSum = months.map(() => 0), monthBlocks = months.map(() => 0);
  dayDates.forEach((date, d) => {
    const mi = dayMonthIdx[d]; const dayFactor = 0.45 + 1.1 * hash01(date + ':wind'); // 0.45..1.55 day-to-day
    for (let i = 0; i < INTERVALS_PER_DAY; i++) { const k = i >> 2; const hourly = 0.85 + 0.3 * hash01(`${date}:${k}`); const v = dayFactor * diurnal[i] * hourly; out[d * INTERVALS_PER_DAY + i] = v; monthSum[mi] += v; monthBlocks[mi]++; }
  });
  dayDates.forEach((date, d) => {
    const mi = dayMonthIdx[d]; const cuf = monthlyCuf[months[mi].slice(5)] ?? 0.3; const target = cuf * 1000 * INTERVAL_HOURS; // kWh per block per MW
    const scale = monthSum[mi] > 0 ? (target * monthBlocks[mi]) / monthSum[mi] : 0;
    for (let i = 0; i < INTERVALS_PER_DAY; i++) out[d * INTERVALS_PER_DAY + i] = Math.min(out[d * INTERVALS_PER_DAY + i] * scale, 1000 * INTERVAL_HOURS); // cap at 100% CUF
  });
  return out;
}

export interface MixParams {
  solarMwp: number; windMw: number; mode: SettlementMode;
  solarRsPerKwhUsed: number;      // ₹ paid per solar kWh credited (offset basis, from the existing plant)
  windRsPerKwhGenerated: number;  // ₹ paid per wind kWh injected (typical wind PPA basis) — lapsed wind is still paid for
  windPaidOnUsedOnly: boolean;    // alternative: pay only for wind that is credited
  gridRsPerKwh: number;           // avoided grid rate (illustrative)
  oaRsPerKwhUsed: number;         // OA charges per RE kWh credited (wheeling + transmission + ToSE etc.)
}
export interface MixResult {
  solarMwp: number; windMw: number; loadKwh: number; solarGenKwh: number; windGenKwh: number; reGenKwh: number;
  solarUsedKwh: number; windUsedKwh: number; creditKwh: number; usedKwh: number; lapsedKwh: number; gridKwh: number;
  reSharePct: number; utilisationPct: number;
  costSolarRs: number; costWindRs: number; costOaRs: number; costGridRs: number; totalCostRs: number; gridOnlyCostRs: number; savingRs: number; blendedRsPerKwh: number;
  monthly: { month: string; load: number; solar: number; wind: number; used: number; grid: number; lapsed: number }[];
}

/** Evaluate a solar+wind mix against one consumer's 15-min load (kWh per block), whole year. solarPerMwp/windPerMw = kWh per block for 1 MW. */
export function evaluateMix(load: Float64Array, solarPerMwp: Float64Array, windPerMw: Float64Array, months: string[], dayMonthIdx: Int16Array, bandOfInterval: Int8Array, p: MixParams): MixResult {
  const nd = dayMonthIdx.length; const nB = Math.max(...Array.from(bandOfInterval)) + 1;
  const monthly = months.map((m) => ({ month: m, load: 0, solar: 0, wind: 0, used: 0, grid: 0, lapsed: 0 }));
  let loadT = 0, sGen = 0, wGen = 0, sUsed = 0, wUsed = 0, credit = 0, grid = 0;
  const bs = new Float64Array(nB), bg = new Float64Array(nB);
  for (let d = 0; d < nd; d++) {
    const mi = dayMonthIdx[d]; const base = d * INTERVALS_PER_DAY; bs.fill(0); bg.fill(0);
    for (let i = 0; i < INTERVALS_PER_DAY; i++) {
      const l = load[base + i], s = solarPerMwp[base + i] * p.solarMwp, w = windPerMw[base + i] * p.windMw; const re = s + w;
      const used = Math.min(l, re); const b = bandOfInterval[i];
      // attribute used energy pro rata to solar and wind
      const su = re > 0 ? used * (s / re) : 0, wu = used - su;
      loadT += l; sGen += s; wGen += w; sUsed += su; wUsed += wu; bs[b] += re - used; bg[b] += l - used;
      monthly[mi].load += l; monthly[mi].solar += s; monthly[mi].wind += w; monthly[mi].used += used;
    }
    let cr = 0; if (p.mode === 'tod_block') for (let b = 0; b < nB; b++) cr += Math.min(bs[b], bg[b]);
    credit += cr; monthly[mi].used += cr;
    let dayGrid = 0, dayLapsed = 0; for (let b = 0; b < nB; b++) { dayGrid += bg[b]; dayLapsed += bs[b]; }
    grid += dayGrid - cr; monthly[mi].grid += dayGrid - cr; monthly[mi].lapsed += dayLapsed - cr;
  }
  const used = sUsed + wUsed + credit; const reGen = sGen + wGen; const lapsed = reGen - used;
  // credited (netted) energy attributed pro rata to solar/wind generation
  const sCredited = sUsed + (reGen > 0 ? credit * (sGen / reGen) : 0), wCredited = wUsed + (reGen > 0 ? credit * (wGen / reGen) : 0);
  const costSolar = sCredited * p.solarRsPerKwhUsed;
  const costWind = p.windPaidOnUsedOnly ? wCredited * p.windRsPerKwhGenerated : wGen * p.windRsPerKwhGenerated;
  const costOa = used * p.oaRsPerKwhUsed; const costGrid = grid * p.gridRsPerKwh; const total = costSolar + costWind + costOa + costGrid; const gridOnly = loadT * p.gridRsPerKwh;
  return { solarMwp: p.solarMwp, windMw: p.windMw, loadKwh: loadT, solarGenKwh: sGen, windGenKwh: wGen, reGenKwh: reGen, solarUsedKwh: sCredited, windUsedKwh: wCredited, creditKwh: credit, usedKwh: used, lapsedKwh: lapsed, gridKwh: grid,
    reSharePct: loadT > 0 ? (used / loadT) * 100 : 0, utilisationPct: reGen > 0 ? (used / reGen) * 100 : 0, costSolarRs: costSolar, costWindRs: costWind, costOaRs: costOa, costGridRs: costGrid, totalCostRs: total, gridOnlyCostRs: gridOnly, savingRs: gridOnly - total, blendedRsPerKwh: loadT > 0 ? total / loadT : 0, monthly };
}

/** Grid search over solar x wind sizes; returns all points plus the best by saving and the best under a minimum-RE-share constraint. */
export function sweepMix(load: Float64Array, solarPerMwp: Float64Array, windPerMw: Float64Array, months: string[], dayMonthIdx: Int16Array, bandOfInterval: Int8Array, base: Omit<MixParams, 'solarMwp' | 'windMw'>, solarSizes: number[], windSizes: number[]): MixResult[] {
  const out: MixResult[] = [];
  for (const s of solarSizes) for (const w of windSizes) out.push(evaluateMix(load, solarPerMwp, windPerMw, months, dayMonthIdx, bandOfInterval, { ...base, solarMwp: s, windMw: w }));
  return out;
}

/** Convenience: pull Chettinad's load and the per-MWp solar series out of a YearSeries built with Chettinad included. */
export function mixInputsFromYear(ys: YearSeries, rules: RulePack, plantMwp = 7.5): { load: Float64Array; solarPerMwp: Float64Array; windPerMw: Float64Array; months: string[]; dayMonthIdx: Int16Array; bandOfInterval: Int8Array } {
  const c = ys.consumers.find((x) => x.kind === 'new'); if (!c) throw new Error('year series has no new consumer');
  const solarPerMwp = new Float64Array(ys.solarKwh.length); for (let i = 0; i < solarPerMwp.length; i++) solarPerMwp[i] = ys.solarKwh[i] / plantMwp;
  const cal = buildCalendar(ys.months, rules.todBands);
  return { load: c.kwh, solarPerMwp, windPerMw: buildWindPerMw(ys.months, ys.dayDates, ys.dayMonthIdx, MH_WIND_MONTHLY_CUF), months: ys.months, dayMonthIdx: ys.dayMonthIdx, bandOfInterval: cal.bandOfInterval };
}
