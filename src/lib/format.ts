export const fmtInr = (rs: number, digits = 1): string => {
  if (!Number.isFinite(rs)) return '-';
  const a = Math.abs(rs);
  const sign = rs < 0 ? '-' : '';
  if (a >= 1e7) return `${sign}₹${(a / 1e7).toFixed(digits)} Cr`;
  if (a >= 1e5) return `${sign}₹${(a / 1e5).toFixed(digits)} L`;
  if (a >= 1e3) return `${sign}₹${(a / 1e3).toFixed(0)}k`;
  return `${sign}₹${a.toFixed(0)}`;
};
export const fmtCr = (rs: number, digits = 2): string => (Number.isFinite(rs) ? `₹${(rs / 1e7).toFixed(digits)} Cr` : '-');
export const fmtKwh = (kwh: number, digits = 2): string => {
  if (!Number.isFinite(kwh)) return '-';
  const a = Math.abs(kwh); const s = kwh < 0 ? '-' : '';
  if (a >= 1e6) return `${s}${(a / 1e6).toFixed(digits)} GWh`;
  if (a >= 1e3) return `${s}${(a / 1e3).toFixed(a >= 1e5 ? 0 : 1)} MWh`;
  return `${s}${a.toFixed(0)} kWh`;
};
export const fmtMw = (mw: number, d = 2): string => `${mw.toFixed(d)} MW`;
export const fmtPct = (f: number, d = 1): string => (Number.isFinite(f) ? `${(f * 100).toFixed(d)}%` : '-');
export const fmtNum = (n: number, d = 0): string => (Number.isFinite(n) ? n.toLocaleString('en-IN', { maximumFractionDigits: d, minimumFractionDigits: d }) : '-');
export const fmtIrr = (irr: number | null, note?: string): string => (irr === null || irr === undefined ? `not defined${note ? ` (${note.replace('not defined ', '').replace(/^\(|\)$/g, '')})` : ''}` : `${(irr * 100).toFixed(1)}%`);
export const monthLabel = (ym: string): string => { const [y, m] = ym.split('-'); return `${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][+m - 1]}-${y.slice(2)}`; };
