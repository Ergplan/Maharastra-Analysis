import React, { useMemo, useState } from 'react';
import { useStore, seed, site } from '../state/store.tsx';
import { Kpi, Badge, Section, Table, Select } from '../components/charts.tsx';
import { TodStepChart } from '../components/TodDayChart.tsx';
import { runDayView, allocateCapacity, evaluateAllocation, type AllocConsumer, type DayViewResult, type AllocCase } from '../engine/dayview.ts';
import { fmtInr, fmtKwh, monthLabel } from '../lib/format.ts';
import chettinadJson from '../data/seed/chettinad_profile.json';

interface ChettinadProfile { name: string; annualKwh: number; annualAvgDayKw: number[]; monthlyAvgDayKw: Record<string, number[]> }
const chettinad = chettinadJson as unknown as ChettinadProfile;
const mwh = (kwh: number) => fmtKwh(kwh, 1);
const PLANT = seed.plant.dcMwp;

/** Wrap an allocation case into the DayViewResult shape the ToD chart expects (bands + 15-min arrays unused by the step chart). */
function asDayView(base: DayViewResult, c: AllocCase): DayViewResult {
  return { ...base, bands: c.bands };
}

export default function OnePageTab() {
  const { state } = useStore();
  const [period, setPeriod] = useState<'annual' | string>('annual');
  const [chetMwp, setChetMwp] = useState(5.0);
  const [ppa] = useState(4.0), [newTariff] = useState(2.5), [newAvoided] = useState(8.44);

  const day = useMemo(() => runDayView({ plant: state.plant, consumers: state.consumers, rules: state.rules, months: seed.calendar.months, site, period, mode: state.mode, networkLossPct: 0, eligibleIds: state.consumers.map((c) => c.id), newConsumer: null, existingPpaRsPerKwh: ppa }), [state.plant, state.consumers, state.rules, state.mode, period, ppa]);
  const chetKw = period === 'annual' ? chettinad.annualAvgDayKw : (chettinad.monthlyAvgDayKw[period.slice(5)] ?? chettinad.annualAvgDayKw);

  const cons: AllocConsumer[] = useMemo(() => {
    const bands = state.rules.todBands;
    const avoided = (c: typeof state.consumers[number]) => bands.map((_, b) => (c.tariff.energyRsPerKvah + (c.tariff.todRsPerKvah[b] ?? 0) + (c.tariff.facRsPerKvah ?? 0) + (c.tariff.wheelingRsPerKvah ?? 0)) / Math.max(0.8, c.pf || 1));
    return [...state.consumers.map((c) => ({ id: c.id, name: c.name, kind: 'existing' as const, loadKw: day.perConsumerLoadKw[c.id], tariffRsPerKwh: ppa, avoidedRsPerKwh: avoided(c), currentMwp: c.currentAllocation.mwp })),
      { id: 'NEW', name: chettinad.name, kind: 'new' as const, loadKw: chetKw, tariffRsPerKwh: newTariff, avoidedRsPerKwh: bands.map(() => newAvoided), currentMwp: 0 }];
  }, [state.consumers, state.rules, day, chetKw, ppa, newTariff, newAvoided]);

  const ev = (mwps: number[]) => evaluateAllocation(cons, mwps, day.solarKw, state.rules, state.mode, PLANT);
  const current = useMemo(() => ev(cons.map((c) => c.currentMwp)), [cons, day, state.mode]); // eslint-disable-line react-hooks/exhaustive-deps
  const rec = useMemo(() => allocateCapacity(cons, day.solarKw, state.rules, state.mode, PLANT, 'revenue'), [cons, day, state.rules, state.mode]);
  const recommended = useMemo(() => ev(rec.rows.map((r) => r.mwp)), [rec]); // eslint-disable-line react-hooks/exhaustive-deps
  const storesRec = rec.rows.slice(1, -1).map((r) => r.mwp); const storesTot = storesRec.reduce((a, b) => a + b, 0);
  const chet = Math.min(chetMwp, PLANT - storesTot);
  const factoryMwp = +(PLANT - chet - storesTot).toFixed(2);
  const chosen = useMemo(() => ev([factoryMwp, ...storesRec, chet]), [cons, day, state.mode, factoryMwp, chet]); // eslint-disable-line react-hooks/exhaustive-deps
  const f = day.annualised.factor;

  const caseRows = [
    { k: 'Current (factory only, 4.41 MWp; 3.09 MWp outside this group)', c: current },
    { k: `Recommended by search (factory ${rec.rows[0].mwp.toFixed(2)} · stores ${storesTot.toFixed(2)} · Chettinad ${rec.rows[rec.rows.length - 1].mwp.toFixed(2)} MWp)`, c: recommended },
    { k: `Chosen: Chettinad ${chet.toFixed(2)} · stores ${storesTot.toFixed(2)} · factory ${factoryMwp.toFixed(2)} MWp`, c: chosen },
  ];
  const fac = chosen.rows[0], facCur = current.rows[0], newRow = chosen.rows[chosen.rows.length - 1];
  const periodOptions = [{ value: 'annual', label: 'Annual average day' }, ...seed.calendar.months.map((mo) => ({ value: mo, label: `${monthLabel(mo)} average day` }))];

  return (
    <div className="onepage">
      <div className="card-head" style={{ marginBottom: 6 }}>
        <div><h2 style={{ margin: 0 }}>7.5 MWp captive solar — who should get the capacity</h2><p className="note" style={{ margin: '4px 0 0' }}>One representative day · {period === 'annual' ? 'annual average' : monthLabel(period)} · {state.mode === 'tod_block' ? 'ToD block' : '15-minute'} settlement · all 8 existing consumers eligible · Chettinad at ₹{newTariff.toFixed(2)}, existing at ₹{ppa.toFixed(2)} · prepared {new Date().toISOString().slice(0, 10)}</p></div>
        <div className="fields" style={{ margin: 0 }}>
          <Select label="Day" value={period} options={periodOptions} onChange={setPeriod} />
          <label className="field"><span>Chettinad allocation (MWp)</span><input type="range" min={0} max={PLANT - storesTot} step={0.05} value={chet} onChange={(e) => setChetMwp(Number(e.target.value))} /><b style={{ color: '#1f2a37' }}>{chet.toFixed(2)} MWp → factory {factoryMwp.toFixed(2)} MWp</b></label>
          <button className="btn" onClick={() => window.print()}>Print / PDF</button>
        </div>
      </div>

      <div className="grid kpis">
        <Kpi label="Plant export" value={`${mwh(chosen.totals.exportKwh)}/day`} sub={`${fmtKwh(chosen.totals.exportKwh * f, 2)}/yr · peak ${(Math.max(...day.solarKw) / 1000).toFixed(1)} MW`} />
        <Kpi label="Useful solar" value={`${current.totals.utilisationPct.toFixed(0)}% → ${chosen.totals.utilisationPct.toFixed(0)}%`} sub={`${mwh(current.totals.usedKwh)} → ${mwh(chosen.totals.usedKwh)} per day`} tone="good" />
        <Kpi label="Lapsing / unused" value={`${mwh(chosen.totals.lapsedKwh)}/day`} sub={`was ${mwh(current.totals.lapsedKwh + current.totals.unallocatedKwh)} (incl. ${mwh(current.totals.unallocatedKwh)} outside group) · ${fmtInr(chosen.totals.lapsedKwh * newTariff * f)}/yr at ₹${newTariff}`} tone="warn" />
        <Kpi label="SPV revenue" value={fmtInr(chosen.totals.spvRevenueRs * f)} sub={`per year · was ${fmtInr(current.totals.spvRevenueRs * f)} (this group only)`} tone="good" />
        <Kpi label="Existing consumers' saving" value={fmtInr(chosen.totals.existingSavingRs * f)} sub={`per year after ₹${ppa} PPA · factory ${fmtInr(fac.consumerSavingRs * f)} (was ${fmtInr(facCur.consumerSavingRs * f)})`} tone="good" />
        <Kpi label="Chettinad" value={`${chet.toFixed(2)} MWp`} sub={`uses ${mwh(newRow.usedKwh)}/day (${newRow.utilisationPct.toFixed(0)}% of its share) · saves ${fmtInr(newRow.consumerSavingRs * f)}/yr (illustrative)`} tone={newRow.utilisationPct < 70 ? 'warn' : 'good'} />
      </div>

      <Section title="Energy supply by ToD zone — chosen allocation" note="Below the dashed line: how the existing group's demand is met (solar directly · solar credited in-band · grid). Above it: Chettinad's uptake (purple), its grid (lilac) and solar that lapses (hatched).">
        <TodStepChart r={asDayView(day, chosen)} showNew height={330} />
      </Section>

      <div className="grid two">
        <Section title="Three allocations, same day">
          <Table dense columns={[{ key: 'k', label: 'Case' }, { key: 'used', label: 'Useful solar', align: 'right' }, { key: 'util', label: '% of export', align: 'right' }, { key: 'lapse', label: 'Lapsing/day', align: 'right' }, { key: 'rev', label: 'SPV revenue/yr', align: 'right' }, { key: 'sav', label: 'Existing saving/yr', align: 'right' }, { key: 'nsav', label: 'Chettinad saving/yr', align: 'right' }]}
            rows={caseRows.map(({ k, c }) => ({ k, used: mwh(c.totals.usedKwh), util: `${c.totals.utilisationPct.toFixed(0)}%`, lapse: mwh(c.totals.lapsedKwh + c.totals.unallocatedKwh), rev: fmtInr(c.totals.spvRevenueRs * f), sav: fmtInr(c.totals.existingSavingRs * f), nsav: c.totals.usedNewKwh ? fmtInr(c.totals.newSavingRs * f) : '—' }))} />
          <p className="note">"Current" counts only this group: 3.09 MWp of today's export goes to parties outside the dataset and is shown as unused here. Savings are approximate (band avoided rate = energy charge + ToD + FAC, kVAh via PF); demand charges unchanged.</p>
        </Section>
        <Section title="What changes, and why">
          <ul className="tight">
            <li><b>Factory {facCur.mwp.toFixed(2)} → {fac.mwp.toFixed(2)} MWp.</b> Today it uses only {facCur.utilisationPct.toFixed(0)}% of its share (≈5 MW at noon against ~1.1 MW of load). At {fac.mwp.toFixed(2)} MWp it still gets {fac.solarSharePct.toFixed(0)}% of its energy from solar (was {facCur.solarSharePct.toFixed(0)}%) and uses {fac.utilisationPct.toFixed(0)}% of what it is allocated; saving {fmtInr(fac.consumerSavingRs * f)}/yr vs {fmtInr(facCur.consumerSavingRs * f)}.</li>
            <li><b>Stores get {storesTot.toFixed(2)} MWp in total</b> (0.05–0.20 each): small energy, high value — each solar unit displaces ~₹17 of LT‑II(C) grid cost vs ~₹8 at the factory. Together ≈ {fmtInr(chosen.rows.slice(1, -1).reduce((a, r) => a + r.consumerSavingRs, 0) * f)}/yr of savings.</li>
            <li><b>Chettinad at {chet.toFixed(2)} MWp</b> uses {mwh(newRow.usedKwh)}/day ({newRow.utilisationPct.toFixed(0)}% of its share); its profile has only ~1.4 MW in the 09–17 h window, so {mwh(newRow.lapsedKwh)}/day of its share lapses. The revenue-maximising search stops at {rec.rows[rec.rows.length - 1].mwp.toFixed(2)} MWp; going to {chet.toFixed(2)} MWp moves lapsing from the factory's share to Chettinad's — total useful solar is unchanged at {mwh(chosen.totals.usedKwh)}/day.</li>
            <li><b>The ceiling is daytime load, not allocation.</b> Every split leaves ≈{mwh(chosen.totals.lapsedKwh)}/day (≈{fmtKwh(chosen.totals.lapsedKwh * f, 1)}/yr) unused. Only more 09–17 h load (Chettinad shifting load into the day, another consumer) or storage changes that.</li>
          </ul>
        </Section>
      </div>

      <Section title="Allocation by consumer — chosen case">
        <Table dense columns={[
          { key: 'name', label: 'Consumer' }, { key: 'kind', label: '', render: (v) => <Badge tone={v === 'new' ? 'info' : 'neutral'}>{v === 'new' ? `new @ ₹${newTariff.toFixed(2)}` : `existing @ ₹${ppa.toFixed(2)}`}</Badge> },
          { key: 'currentMwp', label: 'Now MWp', align: 'right', render: (v) => (v as number).toFixed(2) }, { key: 'mwp', label: 'Proposed MWp', align: 'right', render: (v) => <b>{(v as number).toFixed(2)}</b> },
          { key: 'loadKwh', label: 'Load/day', align: 'right', render: (v) => mwh(v as number) }, { key: 'usedKwh', label: 'Solar used/day', align: 'right', render: (v) => mwh(v as number) },
          { key: 'solarSharePct', label: 'Solar share of load', align: 'right', render: (v) => `${(v as number).toFixed(0)}%` }, { key: 'utilisationPct', label: 'Share used', align: 'right', render: (v) => `${(v as number).toFixed(0)}%` },
          { key: 'lapsedKwh', label: 'Lapsing/day', align: 'right', render: (v) => mwh(v as number) }, { key: 'spvRevenueRs', label: 'SPV revenue/yr', align: 'right', render: (v) => fmtInr((v as number) * f) }, { key: 'consumerSavingRs', label: 'Saving/yr', align: 'right', render: (v) => fmtInr((v as number) * f) },
        ]} rows={chosen.rows.map((r) => ({ ...r }))} />
      </Section>
      <p className="note">Basis: 334 days of ABT export (12.21 GWh, Nov‑25→Sep‑26, October estimated), MSEDCL bills Nov‑25→Jul‑26 (factory) and Mar–Jun‑26 (stores), Chettinad's 15‑min Maharashtra profile (14.0 GWh/yr). Intraday shapes are reconstructions normalised to measured daily/ToD totals. Allocation = frozen share of each interval's export; bounded search, best evaluated — not a proven optimum. Regulatory status: bill‑calibrated, verification pending (OA eligibility of LT stores, group‑captive compliance, banking rules).</p>
    </div>
  );
}
