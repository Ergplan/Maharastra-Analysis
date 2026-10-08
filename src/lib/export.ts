export function downloadText(name: string, text: string, mime = 'text/plain'): void {
  const blob = new Blob([text], { type: mime });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
export function toCsv(rows: Record<string, unknown>[]): string {
  if (!rows.length) return '';
  const cols = Object.keys(rows[0]);
  const esc = (v: unknown) => { const s = v === null || v === undefined ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n');
}
export const downloadCsv = (name: string, rows: Record<string, unknown>[]) => downloadText(name, toCsv(rows), 'text/csv');
export const downloadJson = (name: string, obj: unknown) => downloadText(name, JSON.stringify(obj, null, 1), 'application/json');
