import React, { useEffect, useState } from 'react';
import { useStore, useResult, seed, scenarioInput, site } from '../state/store.tsx';
import { Kpi, Badge, Table, Section, Select, NumberInput, LineChart, COLORS } from '../components/charts.tsx';
import { fmtInr, fmtKwh, fmtPct, fmtNum } from '../lib/format.ts';
import type { Objective } from '../engine/optimise.ts';
import type { ScenarioSummary } from '../engine/summary.ts';

export function useSizing(key: string | undefined, version: number) {
  const { client } = useStore();
  const [s, setS] = useState<{ requiredDaytimeMw: number; hourlyAvgKw: number[]; annualKwh: number; daytimeHours: string } | null>(null);
  useEffect(() => { if (!key) return; let alive = true; client.request<{ type: 'sizeCustomer'; sizing: typeof s }>({ type: 'sizeCustomer', key }).then((r) => { if (alive) setS(r.sizing); }).catch(() => {}); return () => { alive = false; }; }, [key, version, client]);
  return s;
}

export default function OptimiseTab() {
  const { state, dispatch, client } = useStore();
  const s0 = useResult('S0'); const s1 = useResult('S1');
  const [objective, setObjective] = useState<Objective>('owner_npv');
  const [step, setStep] = useState(0.25);
  const [protect, setProtect] = useState(true);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [report, setReport] = useState<{ method: string; evaluated: number; value: number } | null>(null);
  const sizing = useSizing(s1?.key, state.status.version);
  const cap = seed.plant.dcMwp;
  const total = Object.values(state.allocS1).reduce((a, b) => a + b, 0);

  async function findBest() {
    if (!s0) return;
    const baseline: Record<string, number> = {}; for (const e of s0.economics) baseline[e.id] = e.broaderVariableSavingRs;
    const spec = state.consumers.filter((c) => c.oaEligible).map((c) => ({ id: c.id, min: 0, max: cap, step }));
    if (!spec.length) return;
    setProgress({ done: 0, total: 1 });
    try {
      const res = await client.request<{ type: 'optimise'; allocations: Record<string, number>; value: number; evaluated: number; method: string; summary: ScenarioSummary }>({ type: 'optimise', input: scenarioInput(state, 'S1', state.mode), site, spec, objective, baseline: protect ? baseline : undefined }, (d, t) => setProgress({ done: d, total: t }));
      dispatch({ type: 'setAllocs', allocs: res.allocations });
      setReport({ method: res.method, evaluated: res.evaluated, value: res.value });
    } finally { setProgress(null); }
  }

  const rows = state.consumers.map((c) => {
    const e0 = s0?.economics.find((e) => e.id === c.id); const e1 = s1?.economics.find((e) => e.id === c.id);
    const c1 = s1?.consumers.find((x) => x.id === c.id);
    return { id: c.id, name: c.name, eligible: c.oaEligible, cur: c.currentAllocation.mwp, rec: state.allocS1[c.id] ?? 0, usable: e1 ? e1.offsetKwh + e1.bessKwh : 0, saving0: e0?.broaderVariableSavingRs ?? 0, saving1: e1?.broaderVariableSavingRs ?? 0, expired: c1?.totals.expired ?? 0, energyEqMw: e1 && s1 ? (e1.loadKwh / (s1.plant.exportKwh / cap)) : 0, landed: e1?.landedSolarRsPerKwh ?? 0 };
  });
  const incr = (s1?.economics.reduce((a, e) => a + e.broaderVariableSavingRs, 0) ?? 0) - (s0?.economics.reduce((a, e) => a + e.broaderVariableSavingRs, 0) ?? 0);
  return (
    <>
      <p className="note">Contractual MWp allocations are frozen for the whole year (no 15-minute re-allocation between sites). Energy-equivalent MW is shown only for orientation; the recommendation is computed from coincident load, losses, settlement and value. "Find best allocation" is a bounded grid search — a <b>best evaluated scenario</b>, not a proven global optimum.</p>
      <div className="grid kpis">
        <Kpi label="Allocated in S1" value={`${total.toFixed(2)} / ${cap} MWp`} sub={`spare contractual capacity ${(cap - total).toFixed(2)} MWp`} tone={total > cap ? 'bad' : 'neutral'} />
        <Kpi label="Useful solar (S1)" value={fmtKwh((s1?.bridge.physicalDirect ?? 0) + (s1?.bridge.bankWithdrawn ?? 0))} sub={`vs S0 ${fmtKwh((s0?.bridge.physicalDirect ?? 0) + (s0?.bridge.bankWithdrawn ?? 0))}`} tone="good" />
        <Kpi label="Incremental saving vs S0" value={fmtInr(incr)} sub="existing consumers, broader variable-bill basis" tone={incr >= 0 ? 'good' : 'bad'} />
        <Kpi label="Residual surplus (S1)" value={fmtKwh((s1?.bridge.expired ?? 0) + (s1?.bridge.unallocatedResidual ?? 0))} sub={`expired ${fmtKwh(s1?.bridge.expired ?? 0)} + unallocated ${fmtKwh(s1?.bridge.unallocatedResidual ?? 0)}`} tone="warn" />
        <Kpi label="Consolidated owner NPV (S1)" value={fmtInr(s1?.finance.consolidatedOwner.npvRs ?? 0)} sub="existing group, internal ₹4 cancels, 25 y @ 10%" />
      </div>

      <Section title="Allocation sliders (MWp-equivalent, contractual)" right={
        <div className="btn-row">
          <Select label="Objective" value={objective} options={[{ value: 'owner_npv', label: 'Maximise consolidated owner NPV' }, { value: 'spv_npv', label: 'Maximise SPV NPV' }, { value: 'utilisation', label: 'Maximise useful solar' }]} onChange={setObjective} />
          <NumberInput label="Grid step" unit="MWp" value={step} step={0.05} min={0.05} max={1} onChange={setStep} />
          <label className="field toggle"><input type="checkbox" checked={protect} onChange={(e) => setProtect(e.target.checked)} /><span>Protect baseline savings</span></label>
          <button className="btn primary" disabled={!!progress} onClick={findBest}>{progress ? `searching ${progress.done}/${progress.total}` : 'Find best allocation'}</button>
          <button className="btn" onClick={() => dispatch({ type: 'setAllocs', allocs: Object.fromEntries(state.consumers.map((c) => [c.id, c.currentAllocation.mwp])) })}>Back to current</button>
        </div>}>
        {progress && <div className="progress"><i style={{ width: `${(100 * progress.done) / progress.total}%` }} /></div>}
        {rows.map((r) => (
          <div className="slider" key={r.id}>
            <div>
              <b>{r.name}</b> <span className="muted small">current {r.cur.toFixed(2)} MWp · energy-eq {r.energyEqMw.toFixed(2)} MW</span>
              {!r.eligible && <Badge tone="bad" title={state.consumers.find((c) => c.id === r.id)?.eligibilityNote}>not OA-eligible</Badge>}
              <label className="small muted" style={{ marginLeft: 8 }}><input type="checkbox" checked={r.eligible} onChange={(e) => dispatch({ type: 'patchConsumer', id: r.id, patch: { oaEligible: e.target.checked } })} /> treat as eligible</label>
            </div>
            <input type="range" min={0} max={cap} step={0.05} value={r.rec} disabled={!r.eligible} onChange={(e) => dispatch({ type: 'setAlloc', id: r.id, mwp: Number(e.target.value) })} />
            <div className="val">{r.rec.toFixed(2)} MWp</div>
          </div>
        ))}
        {report && <p className="note">Best evaluated: objective value {objective === 'utilisation' ? fmtKwh(report.value) : fmtInr(report.value)} after {report.evaluated} evaluations. Method: {report.method}.</p>}
      </Section>

      <Section title="Current vs recommended" note="Usable kWh = settled offset (+ battery). Residual surplus = this consumer's expired allocation. Savings on broader variable-bill basis (C).">
        <Table dense columns={[
          { key: 'name', label: 'Consumer' }, { key: 'cur', label: 'Current MWp', align: 'right', render: (v) => (v as number).toFixed(2) }, { key: 'rec', label: 'S1 MWp', align: 'right', render: (v) => (v as number).toFixed(2) },
          { key: 'usable', label: 'Usable kWh/yr', align: 'right', render: (v) => fmtKwh(v as number) }, { key: 'landed', label: 'Landed ₹/kWh', align: 'right', render: (v) => ((v as number) ? (v as number).toFixed(2) : '—') },
          { key: 'saving0', label: 'Saving S0', align: 'right', render: (v) => fmtInr(v as number) }, { key: 'saving1', label: 'Saving S1', align: 'right', render: (v) => fmtInr(v as number) },
          { key: 'incr', label: 'Incremental', align: 'right', render: (_v, row) => fmtInr((row.saving1 as number) - (row.saving0 as number)) }, { key: 'expired', label: 'Residual surplus', align: 'right', render: (v) => fmtKwh(v as number) },
        ]} rows={rows} />
      </Section>

      <div className="grid two">
        <Section title="Time-varying surplus (S1) — average kW by hour" note="Expired surplus + unallocated export, averaged over the year. This is the physical surplus profile a new customer or battery could absorb; it is NOT 7.5 MW minus peak demands.">
          {sizing ? <LineChart x={sizing.hourlyAvgKw.map((_, h) => h)} xFormat={(h) => `${String(h).padStart(2, '0')}:00`} format={(v) => `${fmtNum(v / 1000, 2)} MW`} area={['Residual surplus']} series={[{ name: 'Residual surplus', values: sizing.hourlyAvgKw, color: COLORS.expired }]} /> : <p className="muted">…</p>}
          {sizing && <p className="note">Peak average residual ≈ {sizing.requiredDaytimeMw.toFixed(2)} MW during {sizing.daytimeHours}; {fmtKwh(sizing.annualKwh)}/yr. Spare contractual MW: {(cap - total).toFixed(2)} MWp — a different number.</p>}
        </Section>
        <Section title="Explicit daytime load-shift scenario" note="Moves kWh/day from outside 09-17 into 09-17 for one consumer, conserving daily energy. Off by default; never alters the baseline silently.">
          <div className="fields">
            <Select label="Consumer" value={state.loadShift?.consumerId ?? ''} options={[{ value: '', label: 'none' }, ...state.consumers.map((c) => ({ value: c.id, label: c.name }))]} onChange={(v) => dispatch({ type: 'set', patch: { loadShift: v ? { consumerId: v, kwhPerDayToDaytime: state.loadShift?.kwhPerDayToDaytime ?? 2000 } : null } })} />
            <NumberInput label="kWh/day shifted into 09-17" value={state.loadShift?.kwhPerDayToDaytime ?? 0} step={500} min={0} onChange={(v) => state.loadShift && dispatch({ type: 'set', patch: { loadShift: { ...state.loadShift, kwhPerDayToDaytime: v } } })} />
          </div>
          <p className="note">Applies to S1/S2/S3 only; S0 stays the measured baseline. Site limits (contract demand) are not enforced automatically — check the representative day in Tab 1.</p>
        </Section>
      </div>

      <Section title="Implementation checklist (tied to findings)">
        <ul className="tight">
          <li><b>Allocation / permission:</b> factory STOA permissions are monthly (Open Access Permissions table on every bill, OA CD 4,911 kVA). Changing the factory's share from {seed.consumers[0].currentAllocation.mwp} to {fmtNum(state.allocS1[seed.consumers[0].id] ?? 0, 2)} MWp means a revised allocation/scheduling arrangement with Ortusun and MSEDCL/SLDC; the 1,500 kW rooftop stays behind the meter.</li>
          <li><b>Eligibility:</b> stores are LT-II(C); no OA route is evidenced. Any store allocation needs a verified mechanism (HT conversion / aggregation / virtual net metering) — currently "not verified".</li>
          <li><b>Captive ownership:</b> group-captive tests (≥26% ownership, ≥51% proportional consumption) are not verifiable from bills — obtain shareholding and consumption schedules before relying on CSS/AS exemption.</li>
          <li><b>Metering:</b> ABT meter factor (×90) and inverter MWac must be documented (metering certificate, CEIG approval) — both are flagged "unverified".</li>
          <li><b>Banking / scheduling:</b> bills show no inter-month banking and no compensation for over-injection; confirm the current settlement provision (block vs 15-min) in writing from MSEDCL before contracting the new customer.</li>
          <li><b>Bill disputes:</b> recurring ₹9.04 L debit adjustments, the ₹80.5 L wheeling-loss supplementary and the Dec–Feb zone-D booking should be resolved independently; they are excluded from the recurring savings here.</li>
        </ul>
        <p className="note">Factory allocation now {fmtPct((state.allocS1[seed.consumers[0].id] ?? 0) / cap)} of plant; remaining {fmtPct(Math.max(0, cap - total) / cap)} unallocated — residual energy {fmtKwh(s1?.bridge.unallocatedResidual ?? 0)}.</p>
      </Section>
    </>
  );
}
