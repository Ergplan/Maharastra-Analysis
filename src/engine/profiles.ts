import type { Calendar, Consumer, NewCustomerInput, TodBand } from './types.ts';
import { INTERVALS_PER_DAY, INTERVAL_HOURS, addMonths, daysInMonth } from './calendar.ts';

export interface LoadSeries {
  kwh: Float64Array;
  monthlyKwh: number[];
  monthlySource: ('measured' | 'estimated_flat' | 'estimated_seasonal' | 'synthetic')[];
  note: string;
}

/** Monthly kWh on the calendar for a consumer, with bill-day-weighted flat or seasonal projection for missing months. */
export function monthlyLoadKwh(c: Consumer, months: string[], trend: 'flat' | 'seasonal'): { kwh: number[]; source: LoadSeries['monthlySource'] } {
  const obs = new Map<string, number>();
  for (const m of c.monthly) {
    const v = (m.drawal_kwh ?? m.kwh ?? m.kwh_est) as number | undefined;
    if (v !== undefined && v !== null && Number.isFinite(v)) obs.set(m.month, v);
  }
  // daily average over the latest 12 observed months (bill-day weighted)
  const keys = [...obs.keys()].sort();
  const last12 = keys.slice(-12);
  let sumK = 0, sumD = 0;
  for (const k of last12) { sumK += obs.get(k)!; sumD += daysInMonth(k); }
  const avgDaily = sumD ? sumK / sumD : 0;
  const kwh: number[] = []; const source: LoadSeries['monthlySource'] = [];
  for (const m of months) {
    if (obs.has(m)) { kwh.push(obs.get(m)!); source.push('measured'); continue; }
    const prior = addMonths(m, -12);
    if (trend === 'seasonal' && obs.has(prior)) {
      // same month last year scaled to the recent daily-average level
      const priorDaily = obs.get(prior)! / daysInMonth(prior);
      const priorKeys = keys.filter((k) => k <= prior).slice(-12);
      let pk = 0, pd = 0; for (const k of priorKeys) { pk += obs.get(k)!; pd += daysInMonth(k); }
      const priorAvg = pd ? pk / pd : priorDaily;
      const scale = priorAvg > 0 ? avgDaily / priorAvg : 1;
      kwh.push(priorDaily * scale * daysInMonth(m)); source.push('estimated_seasonal');
    } else { kwh.push(avgDaily * daysInMonth(m)); source.push('estimated_flat'); }
  }
  return { kwh, source };
}

/** Relative 96-interval weights from ToD band shares (flat inside each band), optionally smoothed. */
export function dayWeightsFromBands(shares: number[], bands: TodBand[], bandOfInterval: Int8Array, smooth: boolean): Float64Array {
  const w = new Float64Array(INTERVALS_PER_DAY);
  const perBandIntervals = bands.map((b) => (b.endHour - b.startHour) / INTERVAL_HOURS);
  for (let i = 0; i < INTERVALS_PER_DAY; i++) {
    const b = bandOfInterval[i];
    w[i] = (shares[b] ?? 0) / (perBandIntervals[b] || 1);
  }
  if (smooth) {
    // 5-point moving average (circular) that preserves the daily total but softens band edges;
    // afterwards re-impose band totals so ToD calibration is exact.
    const s = new Float64Array(INTERVALS_PER_DAY);
    for (let i = 0; i < INTERVALS_PER_DAY; i++) {
      let acc = 0; for (let k = -2; k <= 2; k++) acc += w[(i + k + INTERVALS_PER_DAY) % INTERVALS_PER_DAY];
      s[i] = acc / 5;
    }
    const bandTot = bands.map(() => 0), bandS = bands.map(() => 0);
    for (let i = 0; i < INTERVALS_PER_DAY; i++) { bandTot[bandOfInterval[i]] += w[i]; bandS[bandOfInterval[i]] += s[i]; }
    for (let i = 0; i < INTERVALS_PER_DAY; i++) { const b = bandOfInterval[i]; w[i] = bandS[b] > 0 ? s[i] * bandTot[b] / bandS[b] : w[i]; }
  }
  const tot = w.reduce((a, b) => a + b, 0);
  if (tot > 0) for (let i = 0; i < INTERVALS_PER_DAY; i++) w[i] /= tot;
  return w;
}

export function profileWeights(kind: 'factory24x7' | 'dayShift' | 'custom' | 'store', custom?: number[]): Float64Array {
  const w = new Float64Array(INTERVALS_PER_DAY);
  for (let i = 0; i < INTERVALS_PER_DAY; i++) {
    const h = i * INTERVAL_HOURS;
    if (kind === 'dayShift') w[i] = h >= 8 && h < 18 ? 1 : 0.2;
    else if (kind === 'custom' && custom && custom.length === INTERVALS_PER_DAY) w[i] = Math.max(0, custom[i]);
    else w[i] = 1;
  }
  const tot = w.reduce((a, b) => a + b, 0);
  for (let i = 0; i < INTERVALS_PER_DAY; i++) w[i] /= tot;
  return w;
}

/** Deterministic load series for an existing consumer, calibrated to monthly totals and ToD shares. */
export function buildConsumerLoad(c: Consumer, cal: Calendar, bands: TodBand[], trend: 'flat' | 'seasonal', smooth: boolean): LoadSeries {
  const { kwh: monthly, source } = monthlyLoadKwh(c, cal.months, trend);
  const w = dayWeightsFromBands(c.todShares.value, bands, cal.bandOfInterval, smooth);
  const kwh = new Float64Array(cal.nIntervals);
  const weekendFactor = c.weekendFactor ?? 1;
  cal.months.forEach((_, mi) => {
    // distribute month kWh over days with weekend factor, then over intervals by w
    let dayWeightSum = 0; const days: number[] = [];
    for (let d = 0; d < cal.dayDates.length; d++) if (cal.dayMonthIdx[d] === mi) { days.push(d); dayWeightSum += cal.isWeekend[d] ? weekendFactor : 1; }
    for (const d of days) {
      const dayKwh = monthly[mi] * ((cal.isWeekend[d] ? weekendFactor : 1) / dayWeightSum);
      for (let i = 0; i < INTERVALS_PER_DAY; i++) kwh[d * INTERVALS_PER_DAY + i] = dayKwh * w[i];
    }
  });
  const n = source.filter((s) => s !== 'measured').length;
  return { kwh, monthlyKwh: monthly, monthlySource: source, note: n ? `${n} of 12 months projected (${trend} trend); intraday shape synthetic` : 'all 12 months measured; intraday shape synthetic' };
}

/** Synthetic load for the new customer (no bills): avgLoadMw x hours, with an illustrative shape. */
export function buildNewCustomerLoad(nc: NewCustomerInput, cal: Calendar): LoadSeries {
  const w = profileWeights(nc.profile, nc.customProfile96);
  const kwh = new Float64Array(cal.nIntervals);
  const dayKwh = nc.avgLoadMw * 1000 * 24;
  const monthly = cal.months.map(() => 0);
  for (let d = 0; d < cal.dayDates.length; d++) {
    const f = cal.isWeekend[d] ? nc.weekendFactor : 1;
    for (let i = 0; i < INTERVALS_PER_DAY; i++) kwh[d * INTERVALS_PER_DAY + i] = dayKwh * f * w[i];
    monthly[cal.dayMonthIdx[d]] += dayKwh * f;
  }
  return { kwh, monthlyKwh: monthly, monthlySource: cal.months.map(() => 'synthetic'), note: 'synthetic profile - editable assumption, not a measured customer' };
}

/** Explicit daytime load-shift scenario: moves kWh/day from bands outside [9,17) into [9,17), conserving daily energy. */
export function applyLoadShift(load: Float64Array, cal: Calendar, kwhPerDay: number): { shifted: Float64Array; movedKwh: number } {
  const shifted = Float64Array.from(load);
  let moved = 0;
  for (let d = 0; d < cal.dayDates.length; d++) {
    const base = d * INTERVALS_PER_DAY;
    let nightSum = 0, dayCount = 0;
    for (let i = 0; i < INTERVALS_PER_DAY; i++) { const h = i * INTERVAL_HOURS; if (h >= 9 && h < 17) dayCount++; else nightSum += load[base + i]; }
    const take = Math.min(kwhPerDay, nightSum);
    if (take <= 0 || nightSum <= 0) continue;
    for (let i = 0; i < INTERVALS_PER_DAY; i++) {
      const h = i * INTERVAL_HOURS;
      if (h >= 9 && h < 17) shifted[base + i] += take / dayCount;
      else shifted[base + i] -= load[base + i] / nightSum * take;
    }
    moved += take;
  }
  return { shifted, movedKwh: moved };
}
