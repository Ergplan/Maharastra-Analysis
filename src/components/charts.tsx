import React, { useState } from 'react';

export const COLORS = {
  solar: '#E0A106', direct: '#3A7D44', bank: '#2A9D8F', bess: '#7B5EA7', expired: '#C8553D', compensated: '#E08E6D',
  grid: '#5B6B7C', unallocated: '#B8BFC7', losses: '#8C7A6B', load: '#1F2A37', new: '#1D6FB8', accent: '#1D6FB8',
};

export interface Series { name: string; values: number[]; color: string }

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const m = v / p;
  const n = m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10;
  return n * p;
}

export function BarChart({ series, categories, stacked = true, height = 240, format = (v: number) => v.toFixed(0), yLabel, showLegend = true }: { series: Series[]; categories: string[]; stacked?: boolean; height?: number; format?: (v: number) => string; yLabel?: string; showLegend?: boolean }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 720, H = height, padL = 72, padR = 12, padT = 12, padB = 36;
  const n = categories.length;
  const totals = categories.map((_, i) => (stacked ? series.reduce((a, s) => a + Math.max(0, s.values[i] ?? 0), 0) : Math.max(...series.map((s) => s.values[i] ?? 0))));
  const yMax = niceMax(Math.max(...totals, 1e-9));
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const bw = plotW / Math.max(n, 1);
  const y = (v: number) => padT + plotH - (v / yMax) * plotH;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * yMax);
  return (
    <div className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" onMouseLeave={() => setHover(null)}>
        {ticks.map((t) => (<g key={t}><line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} className="grid" /><text x={padL - 6} y={y(t) + 4} textAnchor="end" className="tick">{format(t)}</text></g>))}
        {yLabel && <text x={12} y={padT + 10} className="tick axis-label">{yLabel}</text>}
        {categories.map((c, i) => {
          let acc = 0;
          return (
            <g key={c} onMouseEnter={() => setHover(i)}>
              <rect x={padL + i * bw} y={padT} width={bw} height={plotH} fill={hover === i ? 'rgba(0,0,0,0.04)' : 'transparent'} />
              {series.map((s, si) => {
                const v = Math.max(0, s.values[i] ?? 0);
                if (stacked) { const y0 = y(acc + v), h = y(acc) - y(acc + v); acc += v; return <rect key={s.name} x={padL + i * bw + bw * 0.15} y={y0} width={bw * 0.7} height={Math.max(0, h)} fill={s.color} />; }
                const gw = (bw * 0.8) / series.length;
                return <rect key={s.name} x={padL + i * bw + bw * 0.1 + si * gw} y={y(v)} width={gw} height={plotH - (y(v) - padT)} fill={s.color} />;
              })}
              <text x={padL + i * bw + bw / 2} y={H - padB + 14} textAnchor="middle" className="tick">{c}</text>
            </g>
          );
        })}
        {hover !== null && (
          <g>
            <rect x={Math.min(padL + hover * bw + bw / 2, W - 190)} y={padT} width={180} height={16 + series.length * 14} rx={4} className="tooltip-bg" />
            {series.map((s, si) => (<text key={s.name} x={Math.min(padL + hover * bw + bw / 2, W - 190) + 8} y={padT + 14 + si * 14} className="tooltip-text"><tspan fill={s.color}>■</tspan> {s.name}: {format(s.values[hover] ?? 0)}</text>))}
          </g>
        )}
      </svg>
      {showLegend && <div className="legend">{series.map((s) => (<span key={s.name}><i style={{ background: s.color }} />{s.name}</span>))}</div>}
    </div>
  );
}

export function LineChart({ series, x, height = 240, format = (v: number) => v.toFixed(0), xFormat = (v: number) => String(v), yLabel, area = [] as string[], showLegend = true }: { series: Series[]; x: number[]; height?: number; format?: (v: number) => string; xFormat?: (v: number) => string; yLabel?: string; area?: string[]; showLegend?: boolean }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 720, H = height, padL = 72, padR = 12, padT = 12, padB = 32;
  const yMax = niceMax(Math.max(...series.flatMap((s) => s.values), 1e-9));
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const n = x.length;
  const px = (i: number) => padL + (i / Math.max(n - 1, 1)) * plotW;
  const py = (v: number) => padT + plotH - (Math.max(0, v) / yMax) * plotH;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * yMax);
  const xt = Array.from({ length: Math.min(n, 9) }, (_, k) => Math.round((k * (n - 1)) / Math.min(n - 1, 8)));
  return (
    <div className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" onMouseMove={(e) => { const r = (e.target as SVGElement).closest('svg')!.getBoundingClientRect(); const fx = ((e.clientX - r.left) / r.width) * W; setHover(Math.max(0, Math.min(n - 1, Math.round(((fx - padL) / plotW) * (n - 1))))); }} onMouseLeave={() => setHover(null)}>
        {ticks.map((t) => (<g key={t}><line x1={padL} x2={W - padR} y1={py(t)} y2={py(t)} className="grid" /><text x={padL - 6} y={py(t) + 4} textAnchor="end" className="tick">{format(t)}</text></g>))}
        {yLabel && <text x={12} y={padT + 10} className="tick axis-label">{yLabel}</text>}
        {xt.map((i) => (<text key={i} x={px(i)} y={H - padB + 14} textAnchor="middle" className="tick">{xFormat(x[i])}</text>))}
        {series.map((s) => {
          const d = s.values.map((v, i) => `${i === 0 ? 'M' : 'L'}${px(i).toFixed(1)},${py(v).toFixed(1)}`).join(' ');
          return (
            <g key={s.name}>
              {area.includes(s.name) && <path d={`${d} L${px(n - 1).toFixed(1)},${py(0)} L${px(0).toFixed(1)},${py(0)} Z`} fill={s.color} opacity={0.18} />}
              <path d={d} fill="none" stroke={s.color} strokeWidth={2} />
            </g>
          );
        })}
        {hover !== null && (
          <g>
            <line x1={px(hover)} x2={px(hover)} y1={padT} y2={padT + plotH} className="crosshair" />
            <rect x={Math.min(px(hover) + 8, W - 200)} y={padT} width={190} height={16 + series.length * 14} rx={4} className="tooltip-bg" />
            <text x={Math.min(px(hover) + 8, W - 200) + 8} y={padT + 12} className="tooltip-text">{xFormat(x[hover])}</text>
            {series.map((s, si) => (<text key={s.name} x={Math.min(px(hover) + 8, W - 200) + 8} y={padT + 26 + si * 14} className="tooltip-text"><tspan fill={s.color}>■</tspan> {s.name}: {format(s.values[hover] ?? 0)}</text>))}
          </g>
        )}
      </svg>
      {showLegend && <div className="legend">{series.map((s) => (<span key={s.name}><i style={{ background: s.color }} />{s.name}</span>))}</div>}
    </div>
  );
}

export function Kpi({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'good' | 'warn' | 'bad' | 'neutral' }) {
  return (<div className={`kpi ${tone ?? ''}`}><div className="kpi-label">{label}</div><div className="kpi-value">{value}</div>{sub && <div className="kpi-sub">{sub}</div>}</div>);
}

export function Badge({ children, tone = 'neutral', title }: { children: React.ReactNode; tone?: 'good' | 'warn' | 'bad' | 'neutral' | 'info'; title?: string }) {
  return <span className={`badge ${tone}`} title={title}>{children}</span>;
}

export function Table({ columns, rows, dense }: { columns: { key: string; label: string; align?: 'left' | 'right'; render?: (v: unknown, row: Record<string, unknown>) => React.ReactNode }[]; rows: Record<string, unknown>[]; dense?: boolean }) {
  return (
    <div className="table-wrap"><table className={dense ? 'dense' : ''}>
      <thead><tr>{columns.map((c) => <th key={c.key} style={{ textAlign: c.align ?? 'left' }}>{c.label}</th>)}</tr></thead>
      <tbody>{rows.map((r, i) => (<tr key={i}>{columns.map((c) => <td key={c.key} style={{ textAlign: c.align ?? 'left' }}>{c.render ? c.render(r[c.key], r) : String(r[c.key] ?? '')}</td>)}</tr>))}</tbody>
    </table></div>
  );
}

export function Section({ title, children, right, note }: { title: string; children: React.ReactNode; right?: React.ReactNode; note?: string }) {
  return (<section className="card"><div className="card-head"><h3>{title}</h3>{right}</div>{note && <p className="note">{note}</p>}{children}</section>);
}

export function Details({ summary, children }: { summary: string; children: React.ReactNode }) {
  return (<details className="card"><summary>{summary}</summary><div style={{ marginTop: 10 }}>{children}</div></details>);
}

export function NumberInput({ label, value, onChange, step = 1, min, max, unit, note }: { label: string; value: number; onChange: (v: number) => void; step?: number; min?: number; max?: number; unit?: string; note?: string }) {
  return (
    <label className="field" title={note}>
      <span>{label}{unit ? <em> ({unit})</em> : null}</span>
      <input type="number" value={Number.isFinite(value) ? value : ''} step={step} min={min} max={max} onChange={(e) => onChange(e.target.value === '' ? 0 : Number(e.target.value))} />
    </label>
  );
}

export function Toggle({ label, checked, onChange, note }: { label: string; checked: boolean; onChange: (v: boolean) => void; note?: string }) {
  return (<label className="field toggle" title={note}><input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} /><span>{label}</span></label>);
}

export function Select<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (<label className="field"><span>{label}</span><select value={value} onChange={(e) => onChange(e.target.value as T)}>{options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></label>);
}
