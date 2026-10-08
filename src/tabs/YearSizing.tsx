import React, { useMemo, useState } from 'react';
import { useStore, seed, site } from '../state/store.tsx';
import { Kpi, Badge, Section, Table, BarChart, COLORS } from '../components/charts.tsx';
import { buildYearSeries, evaluateYear, allocateYear, sizingSweep } from '../engine/yearsizing.ts';
import { fmtInr, fmtKwh, monthLabel } from '../lib/format.ts';
import chettinadJson from '../data/seed/chettinad_profile.json';

interface ChettinadProfile { name: string; annualKwh: number; daily: Record<string, number[]> }
const chettinad = chettinadJson as unknown as ChettinadProfile;
const PLANT = seed.plant.dcMwp;
const STORES_REC = [0.1, 0.1, 0.15, 0.05, 0.05, 0.2, 0.1]; // from the day-view search; editable here

export default function YearSizingTab() {
  const { state } = useStore();
  const [chetMwp, setChetMwp] = useState(5);
  const [chetScale, setChetScale] = useState(100);
  const [capexPerMw, setCapexPerMw] = useState(4);
  const [yearRec, setYearRec] = useState<number[] | null>(null);
  const ppa = 4, newTariff = 2.5, newAvoided = 8.44;

  const ys = useMemo(() => buildYearSeries(state.plant, state.consumers, state.rules, seed.calendar.months, site, ppa, { daily: chettinad.daily, tariffRsPerKwh: newTariff, avoidedRsPerKwh: newAvoided, scale: chetScale / 100 }), [state.plant, state.consumers, state.rules, chetScale]);
  const storesTot = STORES_REC.reduce((a, b) => a + b, 0);
  const chet = Math.min(chetMwp, PLANT - storesTot); const factory = +(PLANT - storesTot - chet).toFixed(2);
  const chosen = [factory, ...STORES_REC, chet];
  const year = useMemo(() => evaluateYear(ys, chosen, PLANT, state.mode), [ys, factory, chet, state.mode]); // eslint-disable-line react-hooks/exhaustive-deps
  const current = useMemo(() => evaluateYear(ys, [...state.consumers.map((c) => c.currentAllocation.mwp), 0], PLANT, state.mode), [ys, state.consumers, state.mode]);
  const yearRecResult = useMemo(() => (yearRec ? evaluateYear(ys, yearRec, PLANT, state.mode) : null), [ys, yearRec, state.mode]);
  const sizes = [4, 5, 6, 7.5, 9, 10, 12, 15];
  const sweep = useMemo(() => sizingSweep(ys, sizes, state.mode, capexPerMw, chosen), [ys, state.mode, capexPerMw, factory, chet]); // eslint-disable-line react-hooks/exhaustive-deps
  const at75 = sweep.find((p) => p.plantMwp === 7.5)!;
  const months = year.months.map((m) => monthLabel(m.month));

  return (
    <>
      <p className="note">Whole year, 365 days × 96 blocks: the reported daily export (334 days, October estimated), bill‑calibrated loads for the 8 existing consumers, and <b>Chettinad's own 15‑minute profile for every calendar day</b> (35,040 rows). Frozen shares as in the One page; {state.mode === 'tod_block' ? 'same‑band same‑day netting' : 'strict 15‑minute matching'}. This replaces the one‑day average with the real seasonality. <Badge tone="warn">intraday solar/load shapes still reconstructed</Badge></p>
      <div className="fields">
        <label className="field"><span>Chettinad allocation (MWp)</span><input type="range" min={0} max={PLANT - storesTot} step={0.25} value={chet} onChange={(e) => setChetMwp(Number(e.target.value))} /><b style={{ color: '#1f2a37' }}>{chet.toFixed(2)} MWp → factory {factory.toFixed(2)} MWp · stores {storesTot.toFixed(2)}</b></label>
        <label className="field"><span>Chettinad load scale (% of profile)</span><input type="range" min={50} max={300} step={10} value={chetScale} onChange={(e) => setChetScale(Number(e.target.value))} /><b style={{ color: '#1f2a37' }}>{chetScale}% · {fmtKwh(chettinad.annualKwh * chetScale / 100, 1)}/yr</b></label>
        <label className="field"><span>Solar capex (₹ Cr/MW)</span><input type="number" step={0.25} min={1} value={capexPerMw} onChange={(e) => setCapexPerMw(Number(e.target.value) || 4)} style={{ width: 80 }} /></label>
        <button className="btn" onClick={() => setYearRec(allocateYear(ys, PLANT, state.mode, 'revenue', 0.25))}>Re‑run allocation on the full year (≈2 s)</button>
      </div>

      <div className="grid kpis">
        <Kpi label="Export (year)" value={fmtKwh(year.exportKwh, 2)} sub="334 reported days + October estimate" />
        <Kpi label="Useful solar (year)" value={`${fmtKwh(year.usedKwh, 2)} · ${year.utilisationPct.toFixed(0)}%`} sub={`pooled upper bound ${((year.pooledUsedKwh / year.exportKwh) * 100).toFixed(0)}% · current allocation ${current.utilisationPct.toFixed(0)}% · one‑day average view said 69%`} tone="good" />
        <Kpi label="Lapsing (year)" value={fmtKwh(year.lapsedKwh + year.unallocatedKwh, 2)} sub={`${fmtInr((year.lapsedKwh + year.unallocatedKwh) * newTariff)}/yr at ₹${newTariff}`} tone="warn" />
        <Kpi label="SPV revenue" value={fmtInr(year.spvRevenueRs)} sub={`current (this group) ${fmtInr(current.spvRevenueRs)}`} tone="good" />
        <Kpi label="Existing savings" value={fmtInr(year.existingSavingRs)} sub={`current ${fmtInr(current.existingSavingRs)}`} tone="good" />
        <Kpi label="Chettinad saving" value={fmtInr(year.newSavingRs)} sub="illustrative avoided ₹8.44" />
      </div>

      <div className="grid two">
        <Section title="Month by month — chosen allocation" note="Export vs useful vs lapsing. Monsoon months (Jul–Sep) use 80–87% of a much smaller export; the waste is concentrated in Dec–Mar when the plant produces most.">
          <BarChart categories={months} stacked height={260} format={(v) => `${(v / 1000).toFixed(0)}`} yLabel="MWh"
            series={[{ name: 'Useful solar', values: year.months.map((m) => m.usedKwh), color: COLORS.direct }, { name: 'Lapsing', values: year.months.map((m) => m.lapsedKwh), color: COLORS.expired }]} />
          <Table dense columns={[{ key: 'm', label: 'Month' }, { key: 'exp', label: 'Export', align: 'right' }, { key: 'dl', label: '09–17 h load', align: 'right' }, { key: 'ds', label: '09–17 h solar', align: 'right' }, { key: 'used', label: 'Useful', align: 'right' }, { key: 'lap', label: 'Lapsing', align: 'right' }, { key: 'u', label: 'Util.', align: 'right' }]}
            rows={year.months.map((m) => { const M = (v: number) => `${(v / 1000).toFixed(0)} MWh`; return { m: monthLabel(m.month) + (seed.calendar.estimatedMonths.includes(m.month) ? ' (est.)' : ''), exp: M(m.exportKwh), dl: M(m.daytimeLoadKwh), ds: M(m.daytimeSolarKwh), used: M(m.usedKwh), lap: M(m.lapsedKwh), u: `${m.utilisationPct.toFixed(0)}%` }; })} />
        </Section>
        <Section title={`Should the plant be bigger? Plant size sweep at ₹${capexPerMw} Cr/MW`} note="Export scaled from the measured 7.5 MWp series; allocation kept in the chosen ratio. 'Marginal utilisation' = share of the last added MW's energy that anyone consumes; payback = incremental capex ÷ incremental SPV revenue (undiscounted, before O&M).">
          <BarChart categories={sweep.map((p) => `${p.plantMwp} MWp`)} stacked={false} height={220} format={(v) => `${v.toFixed(0)}%`} yLabel="%"
            series={[{ name: 'Utilisation of whole plant', values: sweep.map((p) => p.utilisationPct), color: COLORS.direct }, { name: 'Marginal utilisation of last step', values: sweep.map((p) => p.marginalUtilisationPct), color: COLORS.expired }]} />
          <Table dense columns={[{ key: 'p', label: 'Plant', align: 'right' }, { key: 'exp', label: 'Export/yr', align: 'right' }, { key: 'used', label: 'Useful/yr', align: 'right' }, { key: 'u', label: 'Util.', align: 'right' }, { key: 'mu', label: 'Marginal util.', align: 'right' }, { key: 'rev', label: 'SPV revenue/yr', align: 'right' }, { key: 'ir', label: 'Δ revenue', align: 'right' }, { key: 'ic', label: 'Δ capex', align: 'right' }, { key: 'pb', label: 'Payback of step', align: 'right' }]}
            rows={sweep.map((p, i) => ({ p: `${p.plantMwp} MWp${p.plantMwp === 7.5 ? ' (now)' : ''}`, exp: fmtKwh(p.exportKwh, 1), used: fmtKwh(p.usedKwh, 2), u: `${p.utilisationPct.toFixed(0)}%`, mu: i ? `${p.marginalUtilisationPct.toFixed(0)}%` : '—', rev: fmtInr(p.spvRevenueRs), ir: i ? fmtInr(p.incrementalRevenueRs) : '—', ic: i ? fmtInr(p.incrementalCapexRs) : '—', pb: i ? (p.simplePaybackYears ? `${p.simplePaybackYears.toFixed(0)} y` : '—') : '—' }))} />
          <p className="note">Reading: beyond 7.5 MWp only {sweep.find((p) => p.plantMwp === 9)?.marginalUtilisationPct.toFixed(0)}% of each extra MW's output finds a consumer; at ₹{capexPerMw} Cr/MW that is a {sweep.find((p) => p.plantMwp === 9)?.simplePaybackYears?.toFixed(0)}-year payback on the step. <b>More solar does not pay unless daytime load grows</b> — move the Chettinad load slider to 200% and the picture changes (see the KPIs). The 7.5 MWp plant uses {at75.utilisationPct.toFixed(0)}% of its export with this group.</p>
        </Section>
      </div>

      <Section title="Allocation — full‑year result by consumer" right={yearRecResult && <Badge tone="info">year search: {yearRec!.map((v, i) => `${ys.consumers[i].name.split(' ')[0]} ${v}`).join(' · ')}</Badge>}>
        <Table dense columns={[{ key: 'name', label: 'Consumer' }, { key: 'mwp', label: 'MWp', align: 'right', render: (v) => (v as number).toFixed(2) }, { key: 'loadKwh', label: 'Load/yr', align: 'right', render: (v) => fmtKwh(v as number, 2) }, { key: 'usedKwh', label: 'Solar used/yr', align: 'right', render: (v) => fmtKwh(v as number, 2) }, { key: 'solarSharePct', label: 'Solar share of load', align: 'right', render: (v) => `${(v as number).toFixed(0)}%` }, { key: 'utilisationPct', label: 'Share used', align: 'right', render: (v) => `${(v as number).toFixed(0)}%` }, { key: 'lapsedKwh', label: 'Lapsing/yr', align: 'right', render: (v) => fmtKwh(v as number, 2) }, { key: 'spvRevenueRs', label: 'SPV revenue/yr', align: 'right', render: (v) => fmtInr(v as number) }, { key: 'consumerSavingRs', label: 'Saving/yr', align: 'right', render: (v) => fmtInr(v as number) }]}
          rows={year.consumers.map((c) => ({ ...c }))} />
        {yearRecResult && <p className="note">Full‑year greedy search (0.25 MWp steps, max SPV revenue): useful {fmtKwh(yearRecResult.usedKwh, 2)} ({yearRecResult.utilisationPct.toFixed(0)}%), SPV revenue {fmtInr(yearRecResult.spvRevenueRs)} — vs chosen {fmtKwh(year.usedKwh, 2)} / {fmtInr(year.spvRevenueRs)}. The split barely moves the totals; daytime load is the constraint in every month.</p>}
      </Section>
    </>
  );
}
