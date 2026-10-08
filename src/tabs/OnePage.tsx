import React, { useMemo, useState } from 'react';
import { useStore, seed, site } from '../state/store.tsx';
import { Kpi, Badge, Section, Table, Select } from '../components/charts.tsx';
import { TodStepChart } from '../components/TodDayChart.tsx';
import { runDayView, allocateCapacity, evaluateAllocation, evaluateBess, type AllocConsumer, type DayViewResult, type AllocCase, type BessParams } from '../engine/dayview.ts';
import { fmtInr, fmtKwh, monthLabel } from '../lib/format.ts';
import chettinadJson from '../data/seed/chettinad_profile.json';

interface ChettinadProfile { name: string; annualKwh: number; annualAvgDayKw: number[]; monthlyAvgDayKw: Record<string, number[]> }
const chettinad = chettinadJson as unknown as ChettinadProfile;
const mwh = (kwh: number) => fmtKwh(kwh, 1);
const PLANT = seed.plant.dcMwp;

/** Wrap an allocation case into the DayViewResult shape the ToD chart expects (bands + 15-min arrays unused by the step chart). */
function asDayView(base: DayViewResult, c: AllocCase, bands?: AllocCase['bands']): DayViewResult {
  return { ...base, bands: bands ?? c.bands };
}

export default function OnePageTab() {
  const { state } = useStore();
  const [period, setPeriod] = useState<'annual' | string>('annual');
  const [chetMwp, setChetMwp] = useState(5.0);
  const [ppa] = useState(4.0), [newTariff] = useState(2.5), [newAvoided] = useState(8.44);
  const [bessMwh, setBessMwh] = useState(0);
  const [bessCost, setBessCost] = useState(1.0);

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

  const bessParams = (mwh: number): BessParams => {
    const bands = state.rules.todBands;
    // existing-group avoided rate per band = load-weighted across existing consumers
    const exAvoided = bands.map((_, b) => { let w = 0, v = 0; cons.filter((c) => c.kind === 'existing').forEach((c) => { const l = c.loadKw.reduce((a, x) => a + x, 0); w += l; v += l * c.avoidedRsPerKwh[b]; }); return w ? v / w : 0; });
    return { energyMwh: mwh, powerMw: mwh / 2, capexRsCrPerMwh: bessCost, usableFraction: 0.9, etaRoundTrip: 0.88, dischargeBandIds: ['D', 'A', 'B'], omPctOfCapex: 2, lifeYears: 12, discountRatePct: 10, degradationPctPerYear: 2, existingTariffRsPerKwh: ppa, newTariffRsPerKwh: newTariff, existingAvoidedRsPerKwhByBand: exAvoided, newAvoidedRsPerKwh: newAvoided };
  };
  const bessGrid = useMemo(() => [0.5, 1, 1.5, 2, 3, 4, 5, 6, 8, 10, 12].map((mwh) => { const r = evaluateBess(chosen, bessParams(mwh), f); let cons12 = 0; for (let y = 1; y <= 12; y++) cons12 += (r.existingSavingRsPerYear + r.newSavingRsPerYear) * Math.pow(0.98, y - 1) / Math.pow(1.1, y); return { mwh, r, groupNpv: r.npvRs + cons12 }; }), [chosen, bessCost, cons, ppa, newTariff, newAvoided]); // eslint-disable-line react-hooks/exhaustive-deps
  const bestSpv = bessGrid.reduce((best, x) => (x.r.npvRs > (best?.r.npvRs ?? 0) ? x : best), null as null | typeof bessGrid[number]);
  const bestGroup = bessGrid.reduce((best, x) => (x.groupNpv > (best?.groupNpv ?? 0) ? x : best), null as null | typeof bessGrid[number]);
  const bess = useMemo(() => (bessMwh > 0 ? evaluateBess(chosen, bessParams(bessMwh), f) : null), [chosen, bessMwh, bessCost, cons, ppa, newTariff, newAvoided]); // eslint-disable-line react-hooks/exhaustive-deps

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

      <Section title={`Energy supply by ToD zone — chosen allocation${bess ? ` + ${bessMwh} MWh battery` : ''}`} note="Solid bars = consumption and how it is met (existing group first, then Chettinad). The translucent yellow block is the plant's export in that zone; the hatched slice at its top is solar nobody consumed — wasted. A battery turns part of that slice teal (charged) and adds teal into the evening/night bars (discharged).">
        <TodStepChart r={asDayView(day, chosen, bess?.bands)} showNew height={340} />
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

      <Section title={`Battery on the same base — ₹${bessCost.toFixed(2)} Cr/MWh`} right={<div className="fields" style={{ margin: 0 }}>
          <label className="field"><span>Battery size (MWh)</span><input type="range" min={0} max={12} step={0.5} value={bessMwh} onChange={(e) => setBessMwh(Number(e.target.value))} /><b style={{ color: '#1f2a37' }}>{bessMwh > 0 ? `${bessMwh} MWh · ${(bessMwh / 2).toFixed(1)} MW` : 'no battery'}</b></label>
          <label className="field"><span>Cost (₹ Cr/MWh)</span><input type="number" step={0.1} min={0.3} value={bessCost} onChange={(e) => setBessCost(Number(e.target.value) || 1)} style={{ width: 80 }} /></label>
          {bestGroup && <button className="btn" onClick={() => setBessMwh(bestGroup.mwh)}>Best for group ({bestGroup.mwh} MWh)</button>}
          {bestSpv && bestSpv.r.npvRs > 0 && <button className="btn" onClick={() => setBessMwh(bestSpv.mwh)}>Best for SPV ({bestSpv.mwh} MWh)</button>}
        </div>}
        note="Charges from the lapsing midday surplus, discharges into evening (17–24) then night (00–06, 06–09) grid demand — existing consumers first, Chettinad after. Battery energy is billed at each consumer's PPA tariff; the consumer saves its avoided grid rate (incl. the evening ToD surcharge) less that tariff. 2-hour battery (MW = MWh/2), 90% usable, 88% round-trip, 2% O&M, 12-year life, 2%/yr degradation, 10% discount rate, no replacement/terminal value — editable in the code, labelled modelling assumptions.">
        {bess ? (
          <div className="grid kpis">
            <Kpi label="Charged from surplus" value={`${mwh(bess.chargeKwh)}/day`} sub={`lapsing ${mwh(bess.lapsedBeforeKwh)} → ${mwh(bess.lapsedAfterKwh)}`} tone="good" />
            <Kpi label="Delivered in evening/night" value={`${mwh(bess.dischargeKwh)}/day`} sub={`${mwh(bess.toExistingKwh)} to existing · ${mwh(bess.toNewKwh)} to Chettinad · ${bess.cyclesPerDay.toFixed(2)} cycles`} tone="good" />
            <Kpi label="Capex" value={fmtInr(bess.capexRs)} sub={`O&M ${fmtInr(bess.omRsPerYear)}/yr`} />
            <Kpi label="SPV revenue from battery" value={fmtInr(bess.spvRevenueRsPerYear)} sub={`per year · net of O&M ${fmtInr(bess.netCashRsPerYear)}`} tone="good" />
            <Kpi label="Consumers' extra saving" value={fmtInr(bess.existingSavingRsPerYear + bess.newSavingRsPerYear)} sub={`existing ${fmtInr(bess.existingSavingRsPerYear)} · Chettinad ${fmtInr(bess.newSavingRsPerYear)} per year`} tone="good" />
            <Kpi label="SPV payback / NPV (12 y, 10%)" value={bess.simplePaybackYears ? `${bess.simplePaybackYears.toFixed(1)} y` : 'never'} sub={`NPV ${fmtInr(bess.npvRs)} · ${bess.npvRs > 0 ? 'adds value' : 'destroys value at this tariff'}`} tone={bess.npvRs > 0 ? 'good' : 'bad'} />
          </div>
        ) : <p className="note">No battery selected. {bestSpv && bestSpv.r.npvRs > 0 ? `Best size for the SPV alone: ${bestSpv.mwh} MWh (NPV ${fmtInr(bestSpv.r.npvRs)}).` : 'At the PPA tariffs no size in the grid pays for the SPV alone — "No BESS" is the SPV answer unless battery energy is priced above the PPA rate.'} {bestGroup && bestGroup.groupNpv > 0 ? `For the owner group (SPV + consumers) the best evaluated size is ${bestGroup.mwh} MWh (group NPV ${fmtInr(bestGroup.groupNpv)}).` : ''}</p>}
        <Table dense columns={[{ key: 'mwh', label: 'MWh', align: 'right' }, { key: 'd', label: 'Delivered/day', align: 'right' }, { key: 'lap', label: 'Lapsing after', align: 'right' }, { key: 'capex', label: 'Capex', align: 'right' }, { key: 'rev', label: 'SPV revenue/yr', align: 'right' }, { key: 'sav', label: 'Consumer saving/yr', align: 'right' }, { key: 'pb', label: 'Payback', align: 'right' }, { key: 'npv', label: 'SPV NPV', align: 'right' }, { key: 'total', label: 'Group NPV (SPV + consumers)', align: 'right' }]}
          rows={bessGrid.map(({ mwh: m, r, groupNpv }) => { return { mwh: m, d: mwh(r.dischargeKwh), lap: mwh(r.lapsedAfterKwh), capex: fmtInr(r.capexRs), rev: fmtInr(r.spvRevenueRsPerYear), sav: fmtInr(r.existingSavingRsPerYear + r.newSavingRsPerYear), pb: r.simplePaybackYears ? `${r.simplePaybackYears.toFixed(1)} y` : '—', npv: fmtInr(r.npvRs), total: fmtInr(groupNpv) }; })} />
        <p className="note">Two readings: the <b>SPV</b> earns only the PPA tariff on battery energy (₹{ppa} existing / ₹{newTariff} Chettinad), so at ₹{bessCost} Cr/MWh the battery rarely pays for the SPV alone. The <b>group</b> view adds the consumers' avoided evening grid cost (₹8–10/kWh HT, ~₹20/kWh LT incl. the 17–24 h surcharge); where consumer and SPV are the same owner, that is the number that matters.</p>
      </Section>

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
