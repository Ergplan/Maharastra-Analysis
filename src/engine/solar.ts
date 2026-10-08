import type { Calendar, PlantInput } from './types.ts';
import { INTERVALS_PER_DAY, INTERVAL_HOURS } from './calendar.ts';

export interface SolarSeries {
  kwh: Float64Array;              // per interval, normalised to each day's reported total
  dailyKwh: Float64Array;         // per calendar day
  dailySource: ('reported' | 'estimated' | 'recovered')[];
  acCeilingFlags: { date: string; peakKw: number; ceilingKw: number }[];
  observedDays: number; estimatedDays: number;
  observedKwh: number; totalKwh: number;
}

/** Deterministic pseudo-random in [0,1) from a string (no re-seeding between renders). */
function hash01(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return ((h >>> 0) % 100000) / 100000;
}

/** Clear-sky-like intraday weights for a date at (lat, lon) in IST (UTC+5:30). Sum normalised to 1. */
export function intradayWeights(date: string, lat: number, lon: number, shape: 'smooth' | 'variable'): Float64Array {
  const w = new Float64Array(INTERVALS_PER_DAY);
  const d = new Date(date + 'T00:00:00Z');
  const doy = Math.floor((d.getTime() - Date.UTC(d.getUTCFullYear(), 0, 1)) / 86400000) + 1;
  const decl = 23.45 * Math.PI / 180 * Math.sin(2 * Math.PI * (284 + doy) / 365);
  const B = 2 * Math.PI * (doy - 81) / 364;
  const eot = 9.87 * Math.sin(2 * B) - 7.53 * Math.cos(B) - 1.5 * Math.sin(B); // minutes
  const latR = lat * Math.PI / 180;
  const tzMeridian = 82.5; // IST
  let sum = 0;
  for (let i = 0; i < INTERVALS_PER_DAY; i++) {
    const clock = (i + 0.5) * INTERVAL_HOURS; // mid-interval wall clock hour
    const solarTime = clock + (4 * (lon - tzMeridian) + eot) / 60;
    const ha = (solarTime - 12) * 15 * Math.PI / 180;
    const cosZ = Math.sin(latR) * Math.sin(decl) + Math.cos(latR) * Math.cos(decl) * Math.cos(ha);
    let v = cosZ > 0 ? Math.pow(cosZ, 1.15) : 0;
    if (shape === 'variable' && v > 0) {
      // deterministic cloud-like modulation (±25%), smooth over ~2 h windows
      const k = Math.floor(i / 8);
      v *= 0.75 + 0.5 * hash01(`${date}:${k}`);
    }
    w[i] = v; sum += v;
  }
  if (sum > 0) for (let i = 0; i < INTERVALS_PER_DAY; i++) w[i] /= sum;
  return w;
}

/**
 * Build the whole-plant export series on the calendar.
 * - Reported daily ABT export kWh preserved as-is (optionally scaled by a meter-factor override).
 * - Missing calendar days (October) estimated with the observed daily average (editable).
 * - The Jul-8 breakdown (0 kWh, marked) is preserved unless `recoveredAvailability` is on.
 */
export function buildSolar(plant: PlantInput, cal: Calendar, lat: number, lon: number): SolarSeries {
  const byDate = new Map<string, { kwh: number; note?: string | null }>();
  for (const d of plant.exportDaily) byDate.set(d.date, { kwh: d.kwh, note: d.note });
  const mf = plant.meterFactorOverride ?? 1;
  const reported = plant.exportDaily.map((d) => d.kwh * mf);
  const avgDaily = reported.length ? reported.reduce((a, b) => a + b, 0) / reported.length : 0;
  const estDaily = plant.octoberEstimateKwhPerDay ?? avgDaily;
  const nonZero = reported.filter((k) => k > 0);
  const recoveredDaily = nonZero.length ? nonZero.reduce((a, b) => a + b, 0) / nonZero.length : 0;

  const kwh = new Float64Array(cal.nIntervals);
  const dailyKwh = new Float64Array(cal.dayDates.length);
  const dailySource: SolarSeries['dailySource'] = [];
  const acCeilingFlags: SolarSeries['acCeilingFlags'] = [];
  let observedDays = 0, estimatedDays = 0, observedKwh = 0, totalKwh = 0;
  const ceilingKw = plant.acMw * 1000;
  cal.dayDates.forEach((date, di) => {
    const rec = byDate.get(date);
    let day: number; let src: SolarSeries['dailySource'][number];
    if (rec) {
      day = rec.kwh * mf; src = 'reported'; observedDays++; observedKwh += day;
      if (day === 0 && plant.recoveredAvailability && (rec.note ?? '').toLowerCase().includes('breakdown')) { day = recoveredDaily; src = 'recovered'; }
    } else { day = estDaily; src = 'estimated'; estimatedDays++; }
    dailyKwh[di] = day; dailySource.push(src); totalKwh += day;
    if (day <= 0) return;
    const w = intradayWeights(date, lat, lon, plant.profileShape);
    let peak = 0;
    for (let i = 0; i < INTERVALS_PER_DAY; i++) {
      const e = day * w[i];
      kwh[di * INTERVALS_PER_DAY + i] = e;
      if (e / INTERVAL_HOURS > peak) peak = e / INTERVAL_HOURS;
    }
    if (peak > ceilingKw) acCeilingFlags.push({ date, peakKw: Math.round(peak), ceilingKw });
  });
  return { kwh, dailyKwh, dailySource, acCeilingFlags, observedDays, estimatedDays, observedKwh, totalKwh };
}
