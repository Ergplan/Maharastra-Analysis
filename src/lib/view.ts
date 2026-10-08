import type { ScenarioSummary } from '../engine/summary.ts';
import { seed } from '../state/store.tsx';

/** Observed-period vs annualised helpers: observed = months with reported export (Oct-26 is estimated). */
export const observedMonths = seed.calendar.months.filter((m) => !seed.calendar.estimatedMonths.includes(m));
export function monthRows(s: ScenarioSummary, view: 'observed' | 'annualised') { return view === 'observed' ? s.monthly.filter((m) => observedMonths.includes(m.month)) : s.monthly; }
export function sumRows<K extends string>(rows: Record<K, number | string>[], key: K): number { return rows.reduce((a, r) => a + ((r[key] as number) || 0), 0); }
export function viewLabel(view: 'observed' | 'annualised'): string { return view === 'observed' ? 'observed Nov-25 → Sep-26 (334 days)' : 'annualised 12 months (Oct-26 estimated from observed daily average)'; }
