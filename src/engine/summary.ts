import type { ScenarioResult, SettlementMode } from './types.ts';
import { INTERVALS_PER_DAY } from './calendar.ts';

/** Lightweight, structured-clone-friendly view of a ScenarioResult for the UI thread. */
export interface ConsumerMonthRow { month: string; load: number; direct: number; bankWithdrawn: number; offset: number; bess: number; grid: number; expired: number; compensated: number; solar: number }

export interface ScenarioSummary {
  key: string; id: string; label: string; mode: SettlementMode; approx: boolean;
  calendar: ScenarioResult['calendar'];
  plant: ScenarioResult['plant'];
  bridge: ScenarioResult['bridge'];
  monthly: ScenarioResult['monthly'];
  bandTotals: ScenarioResult['bandTotals'];
  consumers: { id: string; totals: Record<string, number>; months: ConsumerMonthRow[] }[];
  economics: ScenarioResult['economics'];
  bess: (Omit<NonNullable<ScenarioResult['bess']>, 'socSeries'>) | null;
  spv: ScenarioResult['spv'];
  finance: ScenarioResult['finance'];
  newCustomer: ScenarioResult['newCustomer'];
  perfMs: number; warnings: string[];
  dailyExport: number[];
  dates: string[];
}

export function summarise(r: ScenarioResult, key: string, approx: boolean, dates: string[], dailyExport: number[]): ScenarioSummary {
  const months = r.calendar.months;
  const consumers = r.consumers.map((s) => {
    const rows: ConsumerMonthRow[] = months.map((m) => ({ month: m, load: 0, direct: 0, bankWithdrawn: 0, offset: 0, bess: 0, grid: 0, expired: 0, compensated: 0, solar: 0 }));
    let mi = 0; let dayCount = 0;
    const dim = months.map((m) => new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7), 0)).getUTCDate());
    for (let t = 0; t < s.load.length; t++) {
      if (t % INTERVALS_PER_DAY === 0 && t > 0) { dayCount++; if (dayCount >= dim[mi]) { dayCount = 0; mi++; } }
      const row = rows[mi];
      row.load += s.load[t]; row.direct += s.physicalDirect[t]; row.bankWithdrawn += s.bankWithdrawn[t]; row.offset += s.settledOffset[t]; row.bess += s.bessDelivered[t];
      row.grid += s.gridBilled[t]; row.expired += s.expired[t]; row.compensated += s.compensated[t]; row.solar += s.solarDelivered[t];
    }
    return { id: s.id, totals: s.totals, months: rows };
  });
  const bess = r.bess ? (({ socSeries, ...rest }) => { void socSeries; return rest; })(r.bess) : null;
  return { key, id: r.id, label: r.label, mode: r.mode, approx, calendar: r.calendar, plant: r.plant, bridge: r.bridge, monthly: r.monthly, bandTotals: r.bandTotals, consumers, economics: r.economics, bess, spv: r.spv, finance: r.finance, newCustomer: r.newCustomer, perfMs: r.perfMs, warnings: r.warnings, dailyExport, dates };
}

export interface DayDetail {
  date: string; hours: number[];
  portfolio: { load: number[]; solar: number[]; direct: number[]; grid: number[]; bess: number[]; surplus: number[] };
  perConsumer: { id: string; load: number[]; solar: number[]; direct: number[]; grid: number[] }[];
  plantExport: number[]; soc: number[] | null;
}

export function dayDetail(r: ScenarioResult, plantExport: Float64Array, day: number, date: string): DayDetail {
  const n = INTERVALS_PER_DAY; const base = day * n;
  const z = () => new Array(n).fill(0);
  const load = z(), solar = z(), direct = z(), grid = z(), bess = z(), surplus = z(), exp = z();
  const perConsumer = r.consumers.map((s) => {
    const L = z(), S = z(), D = z(), G = z();
    for (let i = 0; i < n; i++) { const t = base + i; L[i] = s.load[t] * 4; S[i] = s.solarDelivered[t] * 4; D[i] = s.physicalDirect[t] * 4; G[i] = s.gridPhysical[t] * 4; load[i] += L[i]; solar[i] += S[i]; direct[i] += D[i]; grid[i] += G[i]; bess[i] += s.bessDelivered[t] * 4; }
    return { id: s.id, load: L, solar: S, direct: D, grid: G };
  });
  for (let i = 0; i < n; i++) { exp[i] = plantExport[base + i] * 4; surplus[i] = Math.max(0, solar[i] - direct[i]); }
  const soc = r.bess?.socSeries ? Array.from({ length: n }, (_, i) => r.bess!.socSeries![base + i]) : null;
  return { date, hours: Array.from({ length: n }, (_, i) => i / 4), portfolio: { load, solar, direct, grid, bess, surplus }, perConsumer, plantExport: exp, soc };
}
