import type { Calendar, TodBand } from './types.ts';

export const INTERVALS_PER_DAY = 96;
export const INTERVAL_HOURS = 0.25;

export function daysInMonth(ym: string): number {
  const [y, m] = ym.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function addMonths(ym: string, n: number): string {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function dateStr(ym: string, day: number): string {
  return `${ym}-${String(day).padStart(2, '0')}`;
}

/** Build a 12-month calendar (selected calendar length, 96 intervals/day, Asia/Kolkata wall-clock bands). */
export function buildCalendar(months: string[], bands: TodBand[]): Calendar {
  const dayDates: string[] = [];
  const dayMonth: number[] = [];
  const dim: number[] = [];
  months.forEach((ym, mi) => {
    const n = daysInMonth(ym);
    dim.push(n);
    for (let d = 1; d <= n; d++) { dayDates.push(dateStr(ym, d)); dayMonth.push(mi); }
  });
  const bandOfInterval = new Int8Array(INTERVALS_PER_DAY);
  for (let i = 0; i < INTERVALS_PER_DAY; i++) {
    const h = i * INTERVAL_HOURS;
    let b = bands.findIndex((bd) => h >= bd.startHour && h < bd.endHour);
    if (b < 0) b = bands.length - 1;
    bandOfInterval[i] = b;
  }
  const isWeekend = new Uint8Array(dayDates.length);
  dayDates.forEach((ds, i) => {
    const dow = new Date(ds + 'T00:00:00Z').getUTCDay();
    isWeekend[i] = dow === 0 ? 1 : 0; // Sunday only by default (Indian commercial practice); editable later
  });
  return {
    months, dayDates, dayMonthIdx: Int16Array.from(dayMonth), intervalsPerDay: INTERVALS_PER_DAY,
    nIntervals: dayDates.length * INTERVALS_PER_DAY, bandOfInterval, daysInMonth: dim, isWeekend,
  };
}

export function hoursInBand(b: TodBand): number { return b.endHour - b.startHour; }
