import React, { useState } from 'react';
import type { DayViewResult, DayBand } from '../engine/dayview.ts';

/** Palette for the day view (consistent with the dashboard: grid orange, exchange/new purple, solar green, surplus hatched yellow). */
export const DAY_COLORS = { grid: '#E9A23B', solar: '#3A7D44', credit: '#8FC9A0', surplus: '#F2D37A', solarOverlay: 'rgba(240, 196, 60, 0.2)', newUsed: '#7E57C2', newGrid: '#C9B8E8', loss: '#8C7A6B', load: '#1F2A37', bess: '#2A9D8F', bessNew: '#7FCDC4', bessCharge: 'rgba(42, 157, 143, 0.55)' };

const mwh = (kwh: number) => (Math.abs(kwh) >= 1000 ? `${(kwh / 1000).toFixed(1)} MWh` : `${kwh.toFixed(0)} kWh`);
const kw = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(2)} MW` : `${v.toFixed(0)} kW`);

/**
 * ToD step chart: one wide bar per ToD zone, width ∝ hours, height = average kW.
 * Consumption bar (bottom→top): solar used by existing group · battery to group · grid to group · [new consumer: solar · battery · grid].
 * Solar is drawn as a translucent overlay from 0 to the zone's average export; the slice of the overlay that was not
 * consumed directly (surplus) is split into in-band credit, battery charge and lapsing (hatched) — that is the wasted area.
 */
export function TodStepChart({ r, showNew, height = 360 }: { r: DayViewResult; showNew: boolean; height?: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 960, H = height, padL = 70, padR = 16, padT = 36, padB = 52;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const avg = (kwh: number, b: DayBand) => kwh / b.hours; // kW
  const solarAvg = (b: DayBand) => avg(b.solarKwh - b.lossKwh, b);
  const demandAvg = (b: DayBand) => avg(b.solarDirectKwh + b.blockCreditKwh + (b.bessToExistingKwh ?? 0) + b.gridKwh + (showNew ? b.newUsedKwh + b.newBlockCreditKwh + (b.bessToNewKwh ?? 0) + b.newGridKwh : 0), b);
  const maxKw = Math.max(1, ...r.bands.map((b) => Math.max(solarAvg(b), demandAvg(b)))) * 1.15;
  const yScale = (v: number) => padT + plotH - (v / maxKw) * plotH;
  const xScale = (h: number) => padL + (h / 24) * plotW;
  const step = niceStep(maxKw / 5); const yTicks: number[] = []; for (let v = 0; v <= maxKw; v += step) yTicks.push(v);
  const hasBess = r.bands.some((b) => (b.bessChargeKwh ?? 0) > 0);
  return (
    <div className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="ToD zone energy supply chart">
        <defs>
          <pattern id="hatch" patternUnits="userSpaceOnUse" width="8" height="8" patternTransform="rotate(45)"><rect width="8" height="8" fill="#F6E3A1" /><line x1="0" y1="0" x2="0" y2="8" stroke="#C8553D" strokeWidth="2.2" /></pattern>
          <pattern id="hatchCredit" patternUnits="userSpaceOnUse" width="8" height="8" patternTransform="rotate(45)"><rect width="8" height="8" fill="#DDEFE0" /><line x1="0" y1="0" x2="0" y2="8" stroke="#3A7D44" strokeWidth="1.6" /></pattern>
        </defs>
        {yTicks.map((v) => (<g key={v}><line className="grid" x1={padL} x2={W - padR} y1={yScale(v)} y2={yScale(v)} /><text x={padL - 8} y={yScale(v) + 4} textAnchor="end" fontSize="11" fill="#6b7280">{v >= 1000 ? (v / 1000).toFixed(v % 1000 ? 1 : 0) + ' MW' : v.toFixed(0)}</text></g>))}
        <text x={padL - 60} y={padT - 16} fontSize="11" fill="#6b7280">avg kW</text>
        {r.bands.map((b, i) => {
          const x0 = xScale(b.startHour) + 3, x1 = xScale(b.endHour) - 3, w = x1 - x0;
          const dim = hover !== null && hover !== i ? 0.35 : 1;
          const segs: { v: number; fill: string; label: string; kwh: number; dark?: boolean }[] = [
            { v: avg(b.solarDirectKwh + b.blockCreditKwh, b), fill: DAY_COLORS.solar, label: 'Solar used by existing group (direct + in-band credit)', kwh: b.solarDirectKwh + b.blockCreditKwh },
            { v: avg(b.bessToExistingKwh ?? 0, b), fill: DAY_COLORS.bess, label: 'Battery → existing group', kwh: b.bessToExistingKwh ?? 0 },
            { v: avg(b.gridKwh, b), fill: DAY_COLORS.grid, label: 'Grid → existing group', kwh: b.gridKwh, dark: true },
            ...(showNew ? [
              { v: avg(b.newUsedKwh + b.newBlockCreditKwh, b), fill: DAY_COLORS.newUsed, label: 'Solar → new consumer', kwh: b.newUsedKwh + b.newBlockCreditKwh },
              { v: avg(b.bessToNewKwh ?? 0, b), fill: DAY_COLORS.bessNew, label: 'Battery → new consumer', kwh: b.bessToNewKwh ?? 0 },
              { v: avg(b.newGridKwh, b), fill: DAY_COLORS.newGrid, label: 'Grid → new consumer', kwh: b.newGridKwh, dark: true },
            ] : []),
          ];
          const demand = demandAvg(b), solar = solarAvg(b);
          // surplus slice of the overlay: top of the overlay down by (credit + bess charge + lapsing)
          const surplusParts = [
            { v: avg(b.expiredKwh, b), fill: 'url(#hatch)', label: 'Solar lapsing — wasted', kwh: b.expiredKwh },
            { v: avg(b.bessChargeKwh ?? 0, b), fill: DAY_COLORS.bessCharge, label: 'Solar charged into battery', kwh: b.bessChargeKwh ?? 0 },
            { v: avg(b.blockCreditKwh + (showNew ? b.newBlockCreditKwh : 0), b), fill: 'url(#hatchCredit)', label: 'Surplus credited within the band (settlement)', kwh: b.blockCreditKwh + (showNew ? b.newBlockCreditKwh : 0) },
          ];
          let acc = 0; let top = solar;
          return (
            <g key={b.id} opacity={dim} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              {segs.map((sg, k) => { if (sg.v <= 0) return null; const y0 = yScale(acc), y1 = yScale(acc + sg.v); acc += sg.v; const hgt = y0 - y1; return (
                <g key={k}><rect x={x0} y={y1} width={w * 0.78} height={hgt} fill={sg.fill} stroke="#fff" strokeWidth="1" />
                  {hgt > 15 && w > 70 && <text x={x0 + 8} y={y0 - 5} fontSize="11.5" fontWeight={600} fill={sg.dark ? '#2b2b2b' : '#fff'}>{mwh(sg.kwh)}</text>}
                  <title>{`${b.label} · ${sg.label}: ${mwh(sg.kwh)} (${kw(sg.v)} avg)`}</title></g>); })}
              {/* translucent solar overlay over the whole zone width */}
              {solar > 0 && <rect x={x0} y={yScale(solar)} width={w} height={yScale(0) - yScale(solar)} fill={DAY_COLORS.solarOverlay} stroke="#b58f1c" strokeWidth="1.5" strokeDasharray="4 3"><title>{`${b.label} · plant export ${mwh(b.solarKwh - b.lossKwh)} (${kw(solar)} avg)`}</title></rect>}
              {surplusParts.map((sp, k) => { if (sp.v <= 0) return null; const y1 = yScale(top), y0 = yScale(top - sp.v); top -= sp.v; const hgt = y0 - y1; return (
                <g key={'s' + k}><rect x={x0} y={y1} width={w} height={hgt} fill={sp.fill} opacity={0.95} stroke="#fff" strokeWidth="0.8" />
                  {hgt > 15 && w > 70 && <text x={x1 - 8} y={y0 - 5} textAnchor="end" fontSize="11.5" fontWeight={700} fill="#7a2e1d">{mwh(sp.kwh)}</text>}
                  <title>{`${b.label} · ${sp.label}: ${mwh(sp.kwh)}`}</title></g>); })}
              <line x1={x0} x2={x1} y1={yScale(demand)} y2={yScale(demand)} stroke={DAY_COLORS.load} strokeWidth="2" />
              {solar > 0 && (solar > demand * 1.05
                ? <text x={x1 - 6} y={yScale(solar) - 6} textAnchor="end" fontSize="11" fontWeight={600} fill="#8a6a10">solar {mwh(b.solarKwh - b.lossKwh)}</text>
                : <text x={x1 - 4} y={yScale(solar) + 12} textAnchor="end" fontSize="10.5" fontWeight={600} fill="#8a6a10">solar {mwh(b.solarKwh - b.lossKwh)}</text>)}
              <text x={x0 + 6} y={yScale(demand) - 6} fontSize="11.5" fontWeight={700} fill="#1f2a37">demand {mwh((demand) * b.hours)}</text>
              <text x={(x0 + x1) / 2} y={H - padB + 16} textAnchor="middle" fontSize="12" fontWeight={600} fill="#1f2a37">{String(b.startHour).padStart(2, '0')}:00 – {String(b.endHour).padStart(2, '0')}:00</text>
              <text x={(x0 + x1) / 2} y={H - padB + 32} textAnchor="middle" fontSize="11" fill="#6b7280">Zone {b.id} · {b.hours} h</text>
            </g>
          );
        })}
        <line x1={padL} x2={W - padR} y1={padT + plotH} y2={padT + plotH} stroke="#cfd5db" />
      </svg>
      <div className="legend">
        <span><i style={{ background: DAY_COLORS.solar }} />Solar used by existing group</span>
        {hasBess && <span><i style={{ background: DAY_COLORS.bess }} />Battery → existing</span>}
        <span><i style={{ background: DAY_COLORS.grid }} />Grid → existing</span>
        {showNew && <span><i style={{ background: DAY_COLORS.newUsed }} />Solar → new consumer</span>}
        {showNew && hasBess && <span><i style={{ background: DAY_COLORS.bessNew }} />Battery → new</span>}
        {showNew && <span><i style={{ background: DAY_COLORS.newGrid }} />Grid → new consumer</span>}
        <span><i style={{ background: DAY_COLORS.solarOverlay, border: '1px dashed #b58f1c' }} />Plant export (overlay)</span>
        <span><i style={{ background: 'repeating-linear-gradient(45deg,#F6E3A1,#F6E3A1 3px,#C8553D 3px,#C8553D 4px)' }} />Solar lapsing (wasted)</span>
        {hasBess && <span><i style={{ background: DAY_COLORS.bessCharge }} />Solar charged into battery</span>}
        <span><i style={{ background: 'repeating-linear-gradient(45deg,#DDEFE0,#DDEFE0 3px,#3A7D44 3px,#3A7D44 4px)' }} />Surplus credited in-band</span>
        <span><i style={{ background: 'none', borderTop: '2px solid #1F2A37', height: 0 }} />Total demand</span>
      </div>
    </div>
  );
}

/** 15-minute timeline: stacked areas (solar used, grid, new-consumer uptake, lapsing surplus) with the load and solar lines. */
export function TodTimelineChart({ r, showNew, height = 320 }: { r: DayViewResult; showNew: boolean; height?: number }) {
  const W = 960, H = height, padL = 70, padR = 16, padT = 20, padB = 40;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const n = r.x.length;
  const stackTop = r.x.map((_, i) => r.directKw[i] + r.gridKw[i] + (showNew ? r.newUsedKw[i] + (r.newLoadKw[i] - r.newUsedKw[i]) : 0) + (showNew ? r.residualSurplusKw[i] : r.surplusKw[i]));
  const maxKw = Math.max(1, ...stackTop, ...r.solarKw) * 1.08;
  const ys = (v: number) => padT + plotH - (v / maxKw) * plotH;
  const xs = (i: number) => padL + (i / n) * plotW;
  const area = (lower: number[], upper: number[]) => {
    let d = '';
    for (let i = 0; i < n; i++) d += `${i ? 'L' : 'M'}${xs(i)},${ys(upper[i])} L${xs(i + 1)},${ys(upper[i])} `;
    for (let i = n - 1; i >= 0; i--) d += `L${xs(i + 1)},${ys(lower[i])} L${xs(i)},${ys(lower[i])} `;
    return d + 'Z';
  };
  const line = (v: number[]) => { let d = ''; for (let i = 0; i < n; i++) d += `${i ? 'L' : 'M'}${xs(i)},${ys(v[i])} L${xs(i + 1)},${ys(v[i])} `; return d; };
  const zero = r.x.map(() => 0);
  const l1 = r.directKw, l2 = l1.map((v, i) => v + r.gridKw[i]);
  const l3 = l2.map((v, i) => v + (showNew ? r.newUsedKw[i] : 0));
  const l4 = l3.map((v, i) => v + (showNew ? r.newLoadKw[i] - r.newUsedKw[i] : 0));
  const l5 = l4.map((v, i) => v + (showNew ? r.residualSurplusKw[i] : r.surplusKw[i]));
  const step = niceStep(maxKw / 5); const yT: number[] = []; for (let v = 0; v <= maxKw; v += step) yT.push(v);
  return (
    <div className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="15-minute timeline">
        <defs><pattern id="hatch2" patternUnits="userSpaceOnUse" width="8" height="8" patternTransform="rotate(45)"><rect width="8" height="8" fill={DAY_COLORS.surplus} /><line x1="0" y1="0" x2="0" y2="8" stroke="#b58f1c" strokeWidth="2" /></pattern></defs>
        {yT.map((v) => (<g key={v}><line className="grid" x1={padL} x2={W - padR} y1={ys(v)} y2={ys(v)} /><text x={padL - 8} y={ys(v) + 4} textAnchor="end" fontSize="11" fill="#6b7280">{v >= 1000 ? (v / 1000).toFixed(v % 1000 ? 1 : 0) + ' MW' : v.toFixed(0)}</text></g>))}
        {r.bands.map((b) => (<g key={b.id}><line x1={xs(b.startHour * 4)} x2={xs(b.startHour * 4)} y1={padT} y2={padT + plotH} stroke="#d9dee4" strokeDasharray="3 3" /><text x={(xs(b.startHour * 4) + xs(b.endHour * 4)) / 2} y={padT + 12} textAnchor="middle" fontSize="11" fill="#6b7280">Zone {b.id}</text></g>))}
        <path d={area(zero, l1)} fill={DAY_COLORS.solar} opacity={0.9} />
        <path d={area(l1, l2)} fill={DAY_COLORS.grid} opacity={0.9} />
        {showNew && <path d={area(l2, l3)} fill={DAY_COLORS.newUsed} opacity={0.9} />}
        {showNew && <path d={area(l3, l4)} fill={DAY_COLORS.newGrid} opacity={0.9} />}
        <path d={area(l4, l5)} fill="url(#hatch2)" opacity={0.95} />
        <path d={line(r.solarKw)} fill="none" stroke="#b58f1c" strokeWidth="2" />
        <path d={line(r.loadKw)} fill="none" stroke={DAY_COLORS.load} strokeWidth="2" strokeDasharray="6 4" />
        {showNew && <path d={line(r.loadKw.map((v, i) => v + r.newLoadKw[i]))} fill="none" stroke={DAY_COLORS.newUsed} strokeWidth="1.5" strokeDasharray="3 3" />}
        {[0, 3, 6, 9, 12, 15, 18, 21, 24].map((h) => (<text key={h} x={xs(h * 4)} y={H - padB + 16} textAnchor="middle" fontSize="11" fill="#6b7280">{String(h).padStart(2, '0')}:00</text>))}
        <line x1={padL} x2={W - padR} y1={padT + plotH} y2={padT + plotH} stroke="#cfd5db" />
      </svg>
      <div className="legend">
        <span><i style={{ background: DAY_COLORS.solar }} />Solar used by group</span><span><i style={{ background: DAY_COLORS.grid }} />Grid to group</span>
        {showNew && <span><i style={{ background: DAY_COLORS.newUsed }} />Surplus to new consumer</span>}{showNew && <span><i style={{ background: DAY_COLORS.newGrid }} />New consumer grid</span>}
        <span><i style={{ background: 'repeating-linear-gradient(45deg,#F2D37A,#F2D37A 3px,#b58f1c 3px,#b58f1c 4px)' }} />Surplus lapsing</span>
        <span><i style={{ background: 'none', borderTop: '2px solid #b58f1c', height: 0 }} />Plant export (after losses in kind: delivered)</span>
        <span><i style={{ background: 'none', borderTop: '2px dashed #1F2A37', height: 0 }} />Group demand</span>
      </div>
    </div>
  );
}

function niceStep(v: number): number {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v))); const m = v / p;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * p;
}
