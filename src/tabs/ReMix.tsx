import React, { useMemo, useState } from 'react';
import { useStore, seed, site } from '../state/store.tsx';
import { Kpi, Badge, Section, Table, BarChart, Toggle, NumberInput, COLORS } from '../components/charts.tsx';
import { buildYearSeries } from '../engine/yearsizing.ts';
import { buildWindPerMw, evaluateMix, sweepMix, MH_WIND_MONTHLY_CUF, type MixResult } from '../engine/remix.ts';
import { buildCalendar } from '../engine/calendar.ts';
import { fmtInr, fmtKwh, monthLabel } from '../lib/format.ts';
import chettinadJson from '../data/seed/chettinad_profile.json';

interface ChettinadProfile { name: string; annualKwh: number; daily: Record<string, number[]> }
const chettinad = chettinadJson as unknown as ChettinadProfile;
const SOLAR_SIZES = [0, 1, 2, 3, 4, 5, 6, 7.5]; const WIND_SIZES = [0, 0.5, 1, 1.5, 2, 2.5, 3, 4, 5, 6];

export default function ReMixTab() {
  const { state } = useStore();
  const [solarMwp, setSolarMwp] = useState(5); const [windMw, setWindMw] = useState(2.5);
  const [solarRs, setSolarRs] = useState(2.5); const [windRs, setWindRs] = useState(3.5); const [windOnUsed, setWindOnUsed] = useState(false);
  const [gridRs, setGridRs] = useState(8.44); const [oaRs, setOaRs] = useState(1.1);
  const [cufScale, setCufScale] = useState(100); const [diurnal, setDiurnal] = useState(0.35);

  const ys = useMemo(() => buildYearSeries(state.plant, state.consumers, state.rules, seed.calendar.months, site, 4, { daily: chettinad.daily, tariffRsPerKwh: solarRs, avoidedRsPerKwh: gridRs, scale: 1 }), [state.plant, state.consumers, state.rules, solarRs, gridRs]);
  const inputs = useMemo(() => {
    const c = ys.consumers[ys.consumers.length - 1];
    const solarPerMwp = new Float64Array(ys.solarKwh.length); for (let i = 0; i < solarPerMwp.length; i++) solarPerMwp[i] = ys.solarKwh[i] / seed.plant.dcMwp;
    const cuf: Record<string, number> = {}; for (const k of Object.keys(MH_WIND_MONTHLY_CUF)) cuf[k] = MH_WIND_MONTHLY_CUF[k] * cufScale / 100;
    const windPerMw = buildWindPerMw(ys.months, ys.dayDates, ys.dayMonthIdx, cuf, diurnal);
    const cal = buildCalendar(ys.months, state.rules.todBands);
    let w = 0; for (const v of windPerMw) w += v;
    return { load: c.kwh, solarPerMwp, windPerMw, months: ys.months, dayMonthIdx: ys.dayMonthIdx, bandOfInterval: cal.bandOfInterval, windCuf: w / 8760 / 1000 };
  }, [ys, cufScale, diurnal, state.rules]);
  const base = { mode: state.mode, solarRsPerKwhUsed: solarRs, windRsPerKwhGenerated: windRs, windPaidOnUsedOnly: windOnUsed, gridRsPerKwh: gridRs, oaRsPerKwhUsed: oaRs };
  const grid = useMemo(() => sweepMix(inputs.load, inputs.solarPerMwp, inputs.windPerMw, inputs.months, inputs.dayMonthIdx, inputs.bandOfInterval, base, SOLAR_SIZES, WIND_SIZES), [inputs, state.mode, solarRs, windRs, windOnUsed, gridRs, oaRs]); // eslint-disable-line react-hooks/exhaustive-deps
  const best = grid.reduce((a, b) => (b.savingRs > a.savingRs ? b : a), grid[0]);
  const chosen = useMemo(() => evaluateMix(inputs.load, inputs.solarPerMwp, inputs.windPerMw, inputs.months, inputs.dayMonthIdx, inputs.bandOfInterval, { ...base, solarMwp, windMw }), [inputs, solarMwp, windMw, state.mode, solarRs, windRs, windOnUsed, gridRs, oaRs]); // eslint-disable-line react-hooks/exhaustive-deps
  const solarOnly = grid.find((g) => g.solarMwp === 5 && g.windMw === 0)!; const windOnly = grid.find((g) => g.solarMwp === 0 && g.windMw === 3)!;
  const cell = (s: number, w: number) => grid.find((g) => g.solarMwp === s && g.windMw === w)!;
  const maxSave = best.savingRs;
  const months = chosen.monthly.map((m) => monthLabel(m.month));

  return (
    <>
      <p className="note"><b>Chettinad on its own</b>: its measured 15‑minute year (14.0 GWh, 1.3–2.05 MW, night‑heavy) against a solar share of the existing 7.5 MWp plant plus new wind. Matching per 15‑min block{state.mode === 'tod_block' ? ' with same‑band same‑day netting' : ''}. Costs are Chettinad's: solar paid on credited kWh, wind paid on {windOnUsed ? 'credited' : 'generated'} kWh, OA charges on credited kWh, grid for the rest. <Badge tone="warn">Wind profile is synthetic</Badge> — a Maharashtra wind‑belt shape (monsoon‑dominant Jun–Sep, evening/night bias, annual CUF {(inputs.windCuf * 100).toFixed(0)}%); replace with the actual WRA/plant series before deciding.</p>
      <div className="fields">
        <label className="field"><span>Solar share (MWp of the 7.5 MWp plant)</span><input type="range" min={0} max={7.5} step={0.5} value={solarMwp} onChange={(e) => setSolarMwp(Number(e.target.value))} /><b style={{ color: '#1f2a37' }}>{solarMwp} MWp</b></label>
        <label className="field"><span>New wind (MW)</span><input type="range" min={0} max={6} step={0.5} value={windMw} onChange={(e) => setWindMw(Number(e.target.value))} /><b style={{ color: '#1f2a37' }}>{windMw} MW · {fmtKwh(chosen.windGenKwh, 1)}/yr</b></label>
        <NumberInput label="Solar ₹/kWh (on credited)" value={solarRs} onChange={setSolarRs} step={0.1} min={0} />
        <NumberInput label="Wind ₹/kWh" value={windRs} onChange={setWindRs} step={0.1} min={0} note="Typical Maharashtra group‑captive wind PPA ₹3.3–3.8/kWh on injected energy" />
        <Toggle label="Wind paid only on credited kWh" checked={windOnUsed} onChange={setWindOnUsed} note="Default off: wind PPAs usually bill injected energy, so lapsed wind is still paid for" />
        <NumberInput label="Avoided grid ₹/kWh" value={gridRs} onChange={setGridRs} step={0.1} min={0} note="Illustrative HT rate; Chettinad's category not confirmed" />
        <NumberInput label="OA charges ₹/kWh credited" value={oaRs} onChange={setOaRs} step={0.1} min={0} note="wheeling + transmission + ToSE etc. on RE energy credited" />
        <NumberInput label="Wind CUF scale" value={cufScale} onChange={setCufScale} step={5} min={50} max={150} unit="%" note="100% = annual ~30% CUF" />
        <NumberInput label="Wind evening/night bias" value={diurnal} onChange={setDiurnal} step={0.05} min={0} max={0.8} note="0 = flat through the day" />
      </div>

      <div className="grid kpis">
        <Kpi label="RE share of Chettinad's load" value={`${chosen.reSharePct.toFixed(0)}%`} sub={`solar ${fmtKwh(chosen.solarUsedKwh, 2)} + wind ${fmtKwh(chosen.windUsedKwh, 2)} of ${fmtKwh(chosen.loadKwh, 2)}`} tone="good" />
        <Kpi label="RE utilisation" value={`${chosen.utilisationPct.toFixed(0)}%`} sub={`${fmtKwh(chosen.lapsedKwh, 2)}/yr lapses`} tone={chosen.utilisationPct > 65 ? 'good' : 'warn'} />
        <Kpi label="Grid still needed" value={fmtKwh(chosen.gridKwh, 2)} sub={`${(100 - chosen.reSharePct).toFixed(0)}% of load · ${fmtInr(chosen.costGridRs)}/yr`} />
        <Kpi label="Chettinad's annual energy cost" value={fmtInr(chosen.totalCostRs)} sub={`grid‑only ${fmtInr(chosen.gridOnlyCostRs)} · blended ₹${chosen.blendedRsPerKwh.toFixed(2)}/kWh`} />
        <Kpi label="Saving vs grid‑only" value={fmtInr(chosen.savingRs)} sub={`solar‑only (5 MWp) ${fmtInr(solarOnly.savingRs)} · wind‑only (3 MW) ${fmtInr(windOnly.savingRs)}`} tone="good" />
        <Kpi label="Best evaluated mix" value={`${best.solarMwp} MWp + ${best.windMw} MW`} sub={`saving ${fmtInr(best.savingRs)} · RE ${best.reSharePct.toFixed(0)}%`} tone="good" />
      </div>

      <div className="grid two">
        <Section title="Annual saving by mix (₹ Cr/yr vs grid‑only)" note="Rows = solar MWp, columns = new wind MW. Darker = higher saving; the plateau is wide, so pick the cheapest‑capital point on it.">
          <div className="table-wrap"><table className="dense heat">
            <thead><tr><th>Solar \ Wind</th>{WIND_SIZES.map((w) => <th key={w} style={{ textAlign: 'right' }}>{w} MW</th>)}</tr></thead>
            <tbody>{SOLAR_SIZES.map((s) => (<tr key={s}><th>{s} MWp</th>{WIND_SIZES.map((w) => { const g = cell(s, w); const t = maxSave > 0 ? Math.max(0, g.savingRs) / maxSave : 0; const isBest = g === best; const isChosen = s === solarMwp && w === windMw; return (
              <td key={w} onClick={() => { setSolarMwp(s); setWindMw(w); }} title={`RE ${g.reSharePct.toFixed(0)}% · util ${g.utilisationPct.toFixed(0)}% · grid ${fmtKwh(g.gridKwh, 1)}`} style={{ textAlign: 'right', cursor: 'pointer', background: `rgba(58,125,68,${(t * 0.75).toFixed(2)})`, color: t > 0.55 ? '#fff' : '#1f2a37', fontWeight: isBest || isChosen ? 700 : 400, outline: isChosen ? '2px solid #1D6FB8' : isBest ? '2px dashed #1f2a37' : 'none' }}>{(g.savingRs / 1e7).toFixed(2)}</td>); })}</tr>))}</tbody>
          </table></div>
          <p className="note">Click a cell to load it into the sliders. Solid outline = chosen, dashed = best evaluated.</p>
        </Section>
        <Section title={`Month by month — ${solarMwp} MWp solar + ${windMw} MW wind`} note="Wind fills the monsoon trough in solar (Jun–Sep) and the evening/night hours; solar carries Oct–May daytime.">
          <BarChart categories={months} stacked height={240} format={(v) => `${(v / 1000).toFixed(0)}`} yLabel="MWh"
            series={[{ name: 'RE used', values: chosen.monthly.map((m) => m.used), color: COLORS.direct }, { name: 'Grid', values: chosen.monthly.map((m) => m.grid), color: COLORS.grid }, { name: 'RE lapsing', values: chosen.monthly.map((m) => m.lapsed), color: COLORS.expired }]} />
          <Table dense columns={[{ key: 'm', label: 'Month' }, { key: 'load', label: 'Load', align: 'right' }, { key: 'solar', label: 'Solar gen', align: 'right' }, { key: 'wind', label: 'Wind gen', align: 'right' }, { key: 'used', label: 'RE used', align: 'right' }, { key: 'grid', label: 'Grid', align: 'right' }, { key: 'share', label: 'RE share', align: 'right' }]}
            rows={chosen.monthly.map((m) => { const M = (v: number) => `${(v / 1000).toFixed(0)}`; return { m: monthLabel(m.month), load: M(m.load), solar: M(m.solar), wind: M(m.wind), used: M(m.used), grid: M(m.grid), share: `${m.load ? ((m.used / m.load) * 100).toFixed(0) : 0}%` }; })} />
        </Section>
      </div>

      <Section title="Cost build‑up — chosen mix vs alternatives (₹/yr)">
        <Table dense columns={[{ key: 'k', label: 'Case' }, { key: 'share', label: 'RE share', align: 'right' }, { key: 'util', label: 'Utilisation', align: 'right' }, { key: 'solar', label: 'Solar cost', align: 'right' }, { key: 'wind', label: 'Wind cost', align: 'right' }, { key: 'oa', label: 'OA charges', align: 'right' }, { key: 'grid', label: 'Grid cost', align: 'right' }, { key: 'total', label: 'Total', align: 'right' }, { key: 'save', label: 'Saving', align: 'right' }, { key: 'bl', label: '₹/kWh blended', align: 'right' }]}
          rows={[{ k: 'Grid only', g: { ...solarOnly, reSharePct: 0, utilisationPct: 0, costSolarRs: 0, costWindRs: 0, costOaRs: 0, costGridRs: solarOnly.gridOnlyCostRs, totalCostRs: solarOnly.gridOnlyCostRs, savingRs: 0, blendedRsPerKwh: gridRs } as MixResult }, { k: 'Solar only 5 MWp (today\'s offer)', g: solarOnly }, { k: 'Wind only 3 MW', g: windOnly }, { k: `Chosen ${solarMwp} MWp + ${windMw} MW`, g: chosen }, { k: `Best evaluated ${best.solarMwp} MWp + ${best.windMw} MW`, g: best }]
            .map(({ k, g }) => ({ k, share: `${g.reSharePct.toFixed(0)}%`, util: g.utilisationPct ? `${g.utilisationPct.toFixed(0)}%` : '—', solar: fmtInr(g.costSolarRs), wind: fmtInr(g.costWindRs), oa: fmtInr(g.costOaRs), grid: fmtInr(g.costGridRs), total: fmtInr(g.totalCostRs), save: fmtInr(g.savingRs), bl: `₹${g.blendedRsPerKwh.toFixed(2)}` }))} />
        <p className="note">Wind cost is {windOnUsed ? 'on credited kWh only — optimistic for the buyer' : 'on generated kWh — lapsed wind is paid for, which is why the sweep stops adding wind around 2.5–3 MW'}. Flip the toggle to see how much the PPA billing basis moves the answer. Demand charges, banking charges and any CSS/AS for a non‑compliant group‑captive are excluded. The wind shape is a modelling assumption; the solar shape is the measured 7.5 MWp export; Chettinad's load is its supplied 15‑minute series.</p>
      </Section>
    </>
  );
}
