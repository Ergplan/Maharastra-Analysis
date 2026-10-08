import React, { useState } from 'react';
import { useStore, useResult, seed, scenarioInput, site } from '../state/store.tsx';
import { Kpi, Badge, Table, Section, Select, NumberInput, Toggle, LineChart, COLORS } from '../components/charts.tsx';
import { fmtInr, fmtKwh, fmtNum, fmtIrr } from '../lib/format.ts';
import { useDayDetail } from './Current.tsx';
import type { BessGridPoint } from '../engine/optimise.ts';

export default function BessTab() {
  const { state, dispatch, client } = useStore();
  const b = state.bess;
  const s2 = useResult('S2'); const s3 = useResult('S3');
  const detail = useDayDetail(s3?.key, state.selectedDay, state.status.version);
  const [grid, setGrid] = useState<{ points: BessGridPoint[]; bestEconomic: BessGridPoint; maxUtilisation: BessGridPoint; recommendation: string } | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [mwList, setMwList] = useState('0.5, 1, 2, 3');
  const [mwhList, setMwhList] = useState('1, 2, 4, 8');
  const capex = (b.energyMwh * b.capexRsCrPerMwh + b.otherAddersRsCr) * 1e7;
  const incrNpv = (s3?.finance.consolidatedOwner.npvRs ?? 0) - (s2?.finance.consolidatedOwner.npvRs ?? 0);
  const addSaving = (s3?.economics.reduce((a, e) => a + e.broaderVariableSavingRs, 0) ?? 0) - (s2?.economics.reduce((a, e) => a + e.broaderVariableSavingRs, 0) ?? 0);
  async function runGrid() {
    const mws = mwList.split(/[,\s]+/).map(Number).filter((x) => x > 0); const mwhs = mwhList.split(/[,\s]+/).map(Number).filter((x) => x > 0);
    setProgress({ done: 0, total: mws.length * mwhs.length });
    try {
      const r = await client.request<{ type: 'bessGrid'; grid: typeof grid }>({ type: 'bessGrid', input: scenarioInput(state, 'S3', state.mode), site, mwList: mws, mwhList: mwhs }, (d, t) => setProgress({ done: d, total: t }));
      setGrid(r.grid);
    } finally { setProgress(null); }
  }
  return (
    <>
      <p className="note">BESS is <b>optional</b> and off by default; "no battery" is a valid outcome. Dispatch runs sequentially at 15-minute resolution with SOC[t+1] = SOC[t] + charge·η<sub>c</sub> − discharge/η<sub>d</sub>, no simultaneous charge/discharge, usable-SOC window on degraded capacity, cycle cap and no free initial energy. The battery charges only from physically available surplus (unallocated residual first, then consumer surplus that would otherwise lapse or be credited) and is compared against S2 without storage.</p>
      <div className="grid kpis">
        <Kpi label="Battery" value={b.enabled ? `${b.powerMw} MW / ${b.energyMwh} MWh` : 'off'} sub={b.enabled ? `${b.location === 'plant' ? 'plant-side' : 'consumer-side: ' + b.location} · capex ${fmtInr(capex)}` : 'enable below or run the grid'} />
        <Kpi label="Annual discharge (year 1)" value={fmtKwh(s3?.bess?.discharged ?? 0)} sub={`charged ${fmtKwh(s3?.bess?.charged ?? 0)} · round-trip + aux losses ${fmtKwh(s3?.bess?.losses ?? 0)}`} />
        <Kpi label="Cycles / year" value={fmtNum(s3?.bess?.cycles ?? 0, 0)} sub={`cap ${b.maxCyclesPerDay}/day · SOC ${b.usableSocMin * 100}-${b.usableSocMax * 100}%`} />
        <Kpi label="Surplus reduction vs S2" value={fmtKwh(((s2?.bridge.expired ?? 0) + (s2?.bridge.unallocatedResidual ?? 0)) - ((s3?.bridge.expired ?? 0) + (s3?.bridge.unallocatedResidual ?? 0)))} />
        <Kpi label="Additional consumer saving" value={fmtInr(addSaving)} sub="S3 − S2, broader variable-bill basis" tone={addSaving > 0 ? 'good' : 'neutral'} />
        <Kpi label="Incremental owner NPV (S3 − S2)" value={fmtInr(incrNpv)} sub={`incremental SPV IRR: ${fmtIrr(s3?.finance.incremental.irr ?? null, s3?.finance.incremental.irrNote)}`} tone={incrNpv > 0 ? 'good' : b.enabled ? 'bad' : 'neutral'} />
      </div>
      {b.enabled && incrNpv <= 0 && <div className="answer"><strong>No BESS recommended at this size</strong>Incremental NPV against S2 is {fmtInr(incrNpv)}. Under the default rule pack, most daytime surplus is already credited by block/band netting, so the battery mainly displaces energy that would have been settled anyway while adding capex, losses and replacement cost. Run the grid below to check smaller sizes or change the settlement/banking assumptions in Tab 6.</div>}

      <Section title="Battery inputs">
        <div className="fields">
          <Toggle label="Enable BESS in S3" checked={b.enabled} onChange={(v) => dispatch({ type: 'patchBess', patch: { enabled: v } })} />
          <NumberInput label="Power" unit="MW" value={b.powerMw} step={0.25} min={0} onChange={(v) => dispatch({ type: 'patchBess', patch: { powerMw: v } })} />
          <NumberInput label="Energy (nameplate)" unit="MWh" value={b.energyMwh} step={0.5} min={0} onChange={(v) => dispatch({ type: 'patchBess', patch: { energyMwh: v } })} />
          <Select label="Location" value={b.location} options={[{ value: 'plant', label: 'Plant-side (charges before export)' }, ...state.consumers.filter((c) => c.oaEligible).map((c) => ({ value: c.id, label: `Consumer-side: ${c.name}` }))]} onChange={(v) => dispatch({ type: 'patchBess', patch: { location: v } })} />
          <Toggle label="Plant-side may charge from unallocated residual" checked={b.chargeFromUnallocated} onChange={(v) => dispatch({ type: 'patchBess', patch: { chargeFromUnallocated: v } })} />
          <NumberInput label="Cost" unit="₹ Cr/MWh" value={b.capexRsCrPerMwh} step={0.1} onChange={(v) => dispatch({ type: 'patchBess', patch: { capexRsCrPerMwh: v } })} />
          <NumberInput label="Other adders (PCS/installation/connection)" unit="₹ Cr" value={b.otherAddersRsCr} step={0.1} min={0} onChange={(v) => dispatch({ type: 'patchBess', patch: { otherAddersRsCr: v } })} />
          <Toggle label="₹1 Cr/MWh includes PCS" checked={b.includesPcs} onChange={(v) => dispatch({ type: 'patchBess', patch: { includesPcs: v } })} />
          <Toggle label="…includes installation" checked={b.includesInstallation} onChange={(v) => dispatch({ type: 'patchBess', patch: { includesInstallation: v } })} />
          <Toggle label="…includes grid connection" checked={b.includesConnection} onChange={(v) => dispatch({ type: 'patchBess', patch: { includesConnection: v } })} />
          <NumberInput label="Usable SOC min" value={b.usableSocMin} step={0.05} min={0} max={0.5} onChange={(v) => dispatch({ type: 'patchBess', patch: { usableSocMin: v } })} />
          <NumberInput label="Usable SOC max" value={b.usableSocMax} step={0.05} min={0.5} max={1} onChange={(v) => dispatch({ type: 'patchBess', patch: { usableSocMax: v } })} />
          <NumberInput label="η charge" value={b.etaCharge} step={0.01} min={0.5} max={1} onChange={(v) => dispatch({ type: 'patchBess', patch: { etaCharge: v } })} />
          <NumberInput label="η discharge" value={b.etaDischarge} step={0.01} min={0.5} max={1} onChange={(v) => dispatch({ type: 'patchBess', patch: { etaDischarge: v } })} />
          <NumberInput label="Auxiliary" unit="% of throughput" value={b.auxPctOfThroughput} step={0.5} min={0} onChange={(v) => dispatch({ type: 'patchBess', patch: { auxPctOfThroughput: v } })} />
          <NumberInput label="Degradation" unit="%/yr" value={b.degradationPctPerYear} step={0.5} min={0} onChange={(v) => dispatch({ type: 'patchBess', patch: { degradationPctPerYear: v } })} />
          <NumberInput label="Max cycles/day" value={b.maxCyclesPerDay} step={0.5} min={0} onChange={(v) => dispatch({ type: 'patchBess', patch: { maxCyclesPerDay: v } })} />
          <NumberInput label="Battery life (replacement)" unit="years" value={b.lifeYears} step={1} min={1} onChange={(v) => dispatch({ type: 'patchBess', patch: { lifeYears: v } })} />
          <NumberInput label="O&M" unit="% capex/yr" value={b.omPctOfCapex} step={0.5} min={0} onChange={(v) => dispatch({ type: 'patchBess', patch: { omPctOfCapex: v } })} />
          <label className="field"><span>Discharge bands (value-aware)</span><div className="btn-row">{state.rules.todBands.map((bd) => <label key={bd.id} className="small"><input type="checkbox" checked={b.dischargeBands.includes(bd.id)} onChange={(e) => dispatch({ type: 'patchBess', patch: { dischargeBands: e.target.checked ? [...b.dischargeBands, bd.id] : b.dischargeBands.filter((x) => x !== bd.id) } })} /> {bd.label}</label>)}</div></label>
        </div>
        <p className="note">Cost basis: ₹{b.capexRsCrPerMwh} Cr/MWh × {b.energyMwh} MWh = {fmtInr(b.energyMwh * b.capexRsCrPerMwh * 1e7)}{b.otherAddersRsCr ? ` + adders ${fmtInr(b.otherAddersRsCr * 1e7)}` : ''}; replacement at year {b.lifeYears} is included in the SPV and owner cash flows. The charging opportunity cost (foregone ₹{state.rules.expiredCompensationRsPerKwh}/kWh compensation, or a ₹{state.newCustomer.ppaTariffRsPerKwh} sale when the residual could instead feed the new customer) is captured by computing the S3 economics against S2 with identical allocations.</p>
      </Section>

      <Section title="Transparent MW / MWh grid (includes zero)" right={<div className="btn-row">
        <label className="field"><span>MW list</span><input type="text" value={mwList} onChange={(e) => setMwList(e.target.value)} /></label>
        <label className="field"><span>MWh list</span><input type="text" value={mwhList} onChange={(e) => setMwhList(e.target.value)} /></label>
        <button className="btn primary" disabled={!!progress} onClick={runGrid}>{progress ? `evaluating ${progress.done}/${progress.total}` : 'Evaluate grid'}</button></div>}
        note="Default selection = best incremental owner NPV (economic benefit), not maximum energy utilisation. A separately labelled maximum-utilisation case is shown.">
        {progress && <div className="progress"><i style={{ width: `${(100 * progress.done) / Math.max(1, progress.total)}%` }} /></div>}
        {grid && (<>
          <div className="answer"><strong>{grid.recommendation}</strong>Max-utilisation case: {grid.maxUtilisation.powerMw} MW / {grid.maxUtilisation.energyMwh} MWh (useful solar {fmtKwh(grid.maxUtilisation.usefulKwh)}, incremental NPV {fmtInr(grid.maxUtilisation.incrementalNpvRs)}) — <Badge tone="warn">labelled: maximum utilisation, not economic</Badge></div>
          <Table dense columns={[{ key: 'powerMw', label: 'MW', align: 'right' }, { key: 'energyMwh', label: 'MWh', align: 'right' }, { key: 'capexRs', label: 'Capex', align: 'right', render: (v) => fmtInr(v as number) }, { key: 'discharged', label: 'Discharged /yr', align: 'right', render: (v) => fmtKwh(v as number) }, { key: 'usefulKwh', label: 'Useful solar', align: 'right', render: (v) => fmtKwh(v as number) }, { key: 'incrementalNpvRs', label: 'Incremental NPV vs no BESS', align: 'right', render: (v) => fmtInr(v as number) }, { key: 'incrementalIrr', label: 'Incr. SPV IRR', align: 'right', render: (v) => fmtIrr(v as number | null) }]} rows={grid.points as unknown as Record<string, unknown>[]} />
          <div className="btn-row">{grid.bestEconomic.energyMwh > 0 && <button className="btn" onClick={() => dispatch({ type: 'patchBess', patch: { enabled: true, powerMw: grid.bestEconomic.powerMw, energyMwh: grid.bestEconomic.energyMwh } })}>Apply best economic size</button>}<button className="btn" onClick={() => dispatch({ type: 'patchBess', patch: { enabled: false } })}>Select no BESS</button></div>
        </>)}
      </Section>

      <Section title={`Selected day — charge / discharge / SOC (${detail?.date ?? ''})`}>
        {detail && detail.soc ? (<>
          <LineChart x={detail.hours} xFormat={(h) => `${String(Math.floor(h)).padStart(2, '0')}:00`} format={(v) => `${fmtNum(v / 1000, 2)} MW`} area={['Battery to load', 'Surplus']} height={220} series={[{ name: 'Surplus', values: detail.portfolio.surplus, color: COLORS.expired }, { name: 'Battery to load', values: detail.portfolio.bess, color: COLORS.bess }, { name: 'Grid', values: detail.portfolio.grid, color: COLORS.grid }]} />
          <LineChart x={detail.hours} xFormat={(h) => `${String(Math.floor(h)).padStart(2, '0')}:00`} format={(v) => `${fmtNum(v / 1000, 2)} MWh`} height={160} series={[{ name: 'SOC (kWh)', values: detail.soc, color: COLORS.bess }]} />
        </>) : <p className="muted">Enable the battery to see the daily dispatch.</p>}
      </Section>
      <p className="note">BESS regulations: MERC BESS Regulations 2026 were listed as a draft on 8 Oct 2026 — no provision from them is applied here.</p>
    </>
  );
}
void seed;
