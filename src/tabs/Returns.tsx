import React, { useState } from 'react';
import { useStore, useResult, SCENARIOS, buildInputs, site, type ScenarioId } from '../state/store.tsx';
import { Table, Section, Badge, Kpi, BarChart, COLORS } from '../components/charts.tsx';
import { fmtInr, fmtKwh, fmtIrr, fmtNum, fmtPct } from '../lib/format.ts';
import { downloadCsv, downloadJson } from '../lib/export.ts';
import type { ScenarioSummary } from '../engine/summary.ts';
import type { ScenarioInput } from '../engine/types.ts';

function row(label: string, f: (s: ScenarioSummary) => string, all: (ScenarioSummary | undefined)[]) {
  return { k: label, ...Object.fromEntries(all.map((s, i) => [`s${i}`, s ? f(s) : '…'])) };
}

export default function ReturnsTab() {
  const { state, client } = useStore();
  const ids: ScenarioId[] = ['S0', 'S1', 'S2', 'S3'];
  const sel = ids.map((id) => state.results[`${id}-${state.mode}`]);
  const tod = ids.map((id) => state.results[`${id}-tod_block`]);
  const i15 = ids.map((id) => state.results[`${id}-interval_15min`]);
  const [sens, setSens] = useState<{ name: string; ownerNpv: number; spvNpv: number; useful: number }[] | null>(null);
  const [busy, setBusy] = useState(false);
  const useful = (s: ScenarioSummary) => s.bridge.physicalDirect + s.bridge.bankWithdrawn + s.bridge.bessDelivered;
  const existingSav = (s: ScenarioSummary) => s.economics.filter((e) => e.id !== 'NEW132').reduce((a, e) => a + e.broaderVariableSavingRs, 0);
  const cols = [{ key: 'k', label: '' }, ...ids.map((id, i) => ({ key: `s${i}`, label: SCENARIOS[i].label, align: 'right' as const }))];
  const rows = [
    row('Contractual allocation (MWp of 7.5)', (s) => `${s.plant.allocatedMwp.toFixed(2)} (unallocated ${s.plant.unallocatedMwp.toFixed(2)})`, sel),
    row('New customer MWp', (s) => (s.newCustomer ? s.newCustomer.offeredMwp.toFixed(2) : '—'), sel),
    row('BESS', (s) => (s.bess ? `${s.bess.powerKw / 1000} MW / ${s.bess.energyKwh / 1000} MWh` : 'none'), sel),
    row('Plant export', (s) => fmtKwh(s.plant.exportKwh), sel),
    row('Useful solar consumption', (s) => `${fmtKwh(useful(s))} (${fmtPct(useful(s) / s.plant.exportKwh)})`, sel),
    row('Expired / uncompensated', (s) => fmtKwh(s.bridge.expired), sel),
    row('Compensated surplus', (s) => fmtKwh(s.bridge.compensated), sel),
    row('Export outside group (unallocated)', (s) => fmtKwh(s.bridge.unallocatedResidual), sel),
    row('Grid imports (group)', (s) => fmtKwh(s.economics.reduce((a, e) => a + e.gridBilledKwh, 0)), sel),
    row('Existing consumers saving (C)', (s) => fmtInr(existingSav(s)), sel),
    row('New consumer saving (illustrative)', (s) => (s.newCustomer ? fmtInr(s.newCustomer.savingRs) : '—'), sel),
    row('SPV revenue — existing ₹4 (internal)', (s) => fmtInr(s.spv.revenueExistingRs), sel),
    row('SPV revenue — new customer ₹2.50', (s) => fmtInr(s.spv.revenueNewRs), sel),
    row('SPV revenue — battery-delivered', (s) => fmtInr(s.spv.revenueBessRs), sel),
    row('Solar capex (assumed original)', (s) => fmtInr(s.spv.capexFullLifeRs - s.spv.capexIncrementalRs), sel),
    row('BESS capex (incremental)', (s) => fmtInr(s.spv.capexIncrementalRs), sel),
    row('O&M year 1', (s) => fmtInr(s.spv.omRs), sel),
    row('SPV full-life NPV @10% (₹30 Cr y0)', (s) => fmtInr(s.finance.fullLife.npvRs), sel),
    row('SPV full-life IRR (pre-tax, unlevered)', (s) => fmtIrr(s.finance.fullLife.irr, s.finance.fullLife.irrNote), sel),
    row('SPV incremental NPV (forward decision)', (s) => fmtInr(s.finance.incremental.npvRs), sel),
    row('SPV incremental IRR', (s) => fmtIrr(s.finance.incremental.irr, s.finance.incremental.irrNote), sel),
    row('Consolidated owner NPV (internal ₹4 eliminated)', (s) => fmtInr(s.finance.consolidatedOwner.npvRs), sel),
    row('Simple payback (full-life SPV)', (s) => (s.finance.fullLife.simplePaybackYears ? `${s.finance.fullLife.simplePaybackYears.toFixed(1)} y` : 'none within life'), sel),
  ];
  const impactRows = ids.map((id, i) => ({ scenario: SCENARIOS[i].label, usefulTod: tod[i] ? fmtKwh(useful(tod[i]!)) : '…', useful15: i15[i] ? fmtKwh(useful(i15[i]!)) : '…', expTod: tod[i] ? fmtKwh(tod[i]!.bridge.expired) : '…', exp15: i15[i] ? fmtKwh(i15[i]!.bridge.expired) : '…', savTod: tod[i] ? fmtInr(existingSav(tod[i]!)) : '…', sav15: i15[i] ? fmtInr(existingSav(i15[i]!)) : '…', npvTod: tod[i] ? fmtInr(tod[i]!.finance.consolidatedOwner.npvRs) : '…', npv15: i15[i] ? fmtInr(i15[i]!.finance.consolidatedOwner.npvRs) : '…' }));
  const s2 = sel[2], s3 = sel[3], s0 = sel[0], s1 = sel[1];

  async function runSensitivity() {
    setBusy(true);
    try {
      const base = buildInputs(state, state.mode).find((x) => x.input.id === 'S3')!.input;
      const variants: { name: string; mut: (i: ScenarioInput) => ScenarioInput }[] = [
        { name: 'Base (S3)', mut: (i) => i },
        { name: 'Generation −10% (CUF)', mut: (i) => ({ ...i, plant: { ...i.plant, meterFactorOverride: 0.9 } }) },
        { name: 'Generation +10%', mut: (i) => ({ ...i, plant: { ...i.plant, meterFactorOverride: 1.1 } }) },
        { name: 'Recovered availability (Jul-8)', mut: (i) => ({ ...i, plant: { ...i.plant, recoveredAvailability: true } }) },
        { name: 'Existing PPA ₹4.40 (+10%)', mut: (i) => ({ ...i, consumers: i.consumers.map((c) => ({ ...c, ppaTariffRsPerKwh: c.ppaTariffRsPerKwh * 1.1 })) }) },
        { name: 'New tariff ₹2.25 (−10%)', mut: (i) => ({ ...i, newCustomer: { ...i.newCustomer, ppaTariffRsPerKwh: i.newCustomer.ppaTariffRsPerKwh * 0.9 } }) },
        { name: 'Solar capex ₹36 Cr (+20%)', mut: (i) => ({ ...i, finance: { ...i.finance, solarCapexRsCr: i.finance.solarCapexRsCr * 1.2 } }) },
        { name: 'In-kind losses 5%', mut: (i) => ({ ...i, consumers: i.consumers.map((c) => (c.oaCharges ? { ...c, oaCharges: { ...c.oaCharges, inKindLossPct: 5 } } : c)), newCustomer: { ...i.newCustomer, oaCharges: { ...i.newCustomer.oaCharges, inKindLossPct: 5 } } }) },
        { name: 'BESS cost ₹0.75 Cr/MWh (−25%)', mut: (i) => ({ ...i, bess: { ...i.bess, capexRsCrPerMwh: i.bess.capexRsCrPerMwh * 0.75 } }) },
        { name: 'PPA billed on injection (take-or-pay)', mut: (i) => ({ ...i, consumers: i.consumers.map((c) => ({ ...c, ppaBillingBasis: 'injection' as const })), newCustomer: { ...i.newCustomer, ppaBillingBasis: 'injection' } }) },
        { name: 'Cross-band banking (C→D permitted)', mut: (i) => ({ ...i, rules: { ...i.rules, withdrawalMatrix: { ...i.rules.withdrawalMatrix, C: ['C', 'D'] } } }) },
        { name: 'Compensation ₹2.5/kWh on lapsed energy', mut: (i) => ({ ...i, rules: { ...i.rules, expiredCompensationRsPerKwh: 2.5 } }) },
      ];
      const r = await client.request<{ type: 'result'; summaries: ScenarioSummary[] }>({ type: 'run', inputs: variants.map((v, k) => ({ key: `sens-${k}`, input: v.mut(base) })), site, approx: true });
      setSens(r.summaries.map((s, k) => ({ name: variants[k].name, ownerNpv: s.finance.consolidatedOwner.npvRs, spvNpv: s.finance.fullLife.npvRs, useful: useful(s) })));
    } finally { setBusy(false); }
  }

  const exportAll = () => downloadJson('scenario-comparison.json', { mode: state.mode, inputs: { allocS1: state.allocS1, newCustomer: state.newCustomer, bess: state.bess, finance: state.finance, rules: state.rules, plant: { ...state.plant, exportDaily: undefined } }, results: Object.fromEntries(Object.entries(state.results).map(([k, v]) => [k, { ...v, consumers: v.consumers.map((c) => ({ id: c.id, totals: c.totals })) }])) });
  return (
    <>
      {s0 && s1 && s2 && s3 && (
        <Section title="The answers (selected settlement mode)">
          <div className="grid three">
            <div className="answer"><strong>How much of 7.5 MW can existing users economically absorb?</strong>{s1.plant.allocatedMwp.toFixed(2)} MWp in S1 (factory {fmtNum(state.allocS1[state.consumers[0].id] ?? 0, 2)} MWp; stores not OA-eligible). Useful solar {fmtKwh(useful(s1))} = {fmtPct(useful(s1) / s1.plant.exportKwh)} of export.</div>
            <div className="answer"><strong>What should be offered to the new customer?</strong>{s2.newCustomer?.offeredMwp.toFixed(2)} MWp against a {state.newCustomer.avgLoadMw} MW {state.newCustomer.profile === 'dayShift' ? 'day-shift' : state.newCustomer.profile === 'factory24x7' ? '24×7' : 'custom'} profile; billed {fmtKwh(s2.newCustomer?.billedKwh ?? 0)}/yr at ₹{state.newCustomer.ppaTariffRsPerKwh} (landed ₹{(s2.newCustomer?.landedRsPerKwh ?? 0).toFixed(2)}).</div>
            <div className="answer"><strong>How much surplus remains?</strong>S2: {fmtKwh(s2.bridge.expired)} expired + {fmtKwh(s2.bridge.unallocatedResidual)} unallocated (S0: {fmtKwh(s0.bridge.expired + s0.bridge.unallocatedResidual)}).</div>
            <div className="answer"><strong>Does a battery add value?</strong>{state.bess.enabled ? `${state.bess.powerMw} MW / ${state.bess.energyMwh} MWh: incremental owner NPV ${fmtInr(s3.finance.consolidatedOwner.npvRs - s2.finance.consolidatedOwner.npvRs)} — ${s3.finance.consolidatedOwner.npvRs - s2.finance.consolidatedOwner.npvRs > 0 ? 'yes at this size' : 'no, not at this size'}.` : 'BESS off (zero-BESS selected). Run the grid in Tab 4; the default rule pack credits most daytime surplus already, so a battery rarely pays at ₹1 Cr/MWh.'}</div>
            <div className="answer"><strong>How much does each consumer save on energy procurement?</strong>Existing group: S0 {fmtInr(existingSav(s0))} → S2 {fmtInr(existingSav(s2))}/yr (broader variable-bill basis; demand charges unchanged). Factory landed solar ₹{s2.economics[0].landedSolarRsPerKwh.toFixed(2)} vs avoided ₹{s2.economics[0].avoidedGridRsPerKwh.toFixed(2)}/kWh.</div>
            <div className="answer"><strong>What is the SPV's IRR?</strong>Full-life, unlevered, pre-tax project IRR at ₹30 Cr original capex: S0 {fmtIrr(s0.finance.fullLife.irr)} → S2 {fmtIrr(s2.finance.fullLife.irr)}. Forward incremental decision value (no new solar capex): S2 incremental NPV {fmtInr(s2.finance.incremental.npvRs)}; incremental IRR {fmtIrr(s2.finance.incremental.irr, s2.finance.incremental.irrNote)}.</div>
          </div>
          <p className="note">Under 15-minute settlement the same allocations give: useful solar {i15[2] ? fmtKwh(useful(i15[2]!)) : '…'} (S2) vs {tod[2] ? fmtKwh(useful(tod[2]!)) : '…'} under ToD block; existing savings {i15[2] ? fmtInr(existingSav(i15[2]!)) : '…'} vs {tod[2] ? fmtInr(existingSav(tod[2]!)) : '…'}. See the impact view below.</p>
        </Section>
      )}

      <Section title={`Side-by-side S0–S3 (${state.mode === 'tod_block' ? 'ToD block' : '15-minute'} settlement)`} right={<div className="btn-row"><button className="btn" onClick={() => downloadCsv('scenario-comparison.csv', rows)}>CSV</button><button className="btn" onClick={exportAll}>JSON</button><button className="btn" onClick={() => window.print()}>Print</button></div>}>
        <Table dense columns={cols} rows={rows} />
        <p className="note">Three perspectives are kept separate: (1) each consumer's savings, (2) SPV cash flow and returns, (3) consolidated existing-owner economics in which the internal ₹4 payments cancel; new external receipts stay external. Assumptions: 25-y life, 0.5%/y solar degradation, O&M 1.5% of capex escalating 5%/y, zero PPA escalation, 10% nominal discount rate, 30 days receivables — modelling assumptions, not supplied facts. Taxes, depreciation, debt, replacements beyond BESS and residual value are not modelled (no post-tax or equity IRR is shown).</p>
      </Section>

      <Section title="ToD-block vs 15-minute settlement impact (all other inputs constant)" note="Both modes are run on identical demand and solar profiles. ToD price bands stay in force in both; 15-minute matching changes only the settlement granularity and the chronology of banking.">
        <Table dense columns={[{ key: 'scenario', label: 'Scenario' }, { key: 'usefulTod', label: 'Useful solar · ToD', align: 'right' }, { key: 'useful15', label: 'Useful solar · 15-min', align: 'right' }, { key: 'expTod', label: 'Expired · ToD', align: 'right' }, { key: 'exp15', label: 'Expired · 15-min', align: 'right' }, { key: 'savTod', label: 'Existing savings · ToD', align: 'right' }, { key: 'sav15', label: 'Existing savings · 15-min', align: 'right' }, { key: 'npvTod', label: 'Owner NPV · ToD', align: 'right' }, { key: 'npv15', label: 'Owner NPV · 15-min', align: 'right' }]} rows={impactRows} />
      </Section>

      {s2 && (
        <Section title="Consumer savings bridges (S2, annual)" note="A = avoided grid energy charges (EC + ToD on kVAh at billed PF); B = A − PPA − OA charges; C = B + avoided FAC, LT wheeling, ToSE and ED on their correct bases; D context = demand charges, unchanged.">
          <Table dense columns={[{ key: 'name', label: 'Consumer' }, { key: 'loadKwh', label: 'Load', align: 'right', render: (v) => fmtKwh(v as number) }, { key: 'offsetKwh', label: 'Offset', align: 'right', render: (v) => fmtKwh(v as number) }, { key: 'avoidedEnergyChargesRs', label: 'A avoided EC', align: 'right', render: (v) => fmtInr(v as number) }, { key: 'ppaCostRs', label: 'PPA', align: 'right', render: (v) => fmtInr(v as number) }, { key: 'oaCostRs', label: 'OA charges', align: 'right', render: (v) => fmtInr(v as number) }, { key: 'netProcurementSavingRs', label: 'B net', align: 'right', render: (v) => fmtInr(v as number) }, { key: 'avoidedFacRs', label: 'FAC', align: 'right', render: (v) => fmtInr(v as number) }, { key: 'avoidedTaxesRs', label: 'ToSE', align: 'right', render: (v) => fmtInr(v as number) }, { key: 'avoidedEdRs', label: 'ED', align: 'right', render: (v) => fmtInr(v as number) }, { key: 'broaderVariableSavingRs', label: 'C broader', align: 'right', render: (v) => fmtInr(v as number) }, { key: 'demandChargesRs', label: 'D demand (unchanged)', align: 'right', render: (v) => fmtInr(v as number) }, { key: 'savingsLabel', label: '', render: (v) => <Badge tone={v === 'illustrative' ? 'warn' : 'good'}>{String(v)}</Badge> }]} rows={s2.economics as unknown as Record<string, unknown>[]} />
        </Section>
      )}

      {s3 && (
        <Section title="SPV cash flow (S3, ₹ Cr) — full-life view" note="Year 0 = ₹30 Cr solar capex (+ BESS). Revenue = ₹4 × existing billed + ₹2.50 × new billed + battery-delivered + compensation. Working-capital change from 30-day receivables; released in the final year.">
          <BarChart stacked={false} categories={s3.finance.fullLife.years.filter((_, i) => i % 2 === 0).map(String)} series={[{ name: 'Revenue', values: s3.finance.fullLife.revenueRs.filter((_, i) => i % 2 === 0).map((v) => v / 1e7), color: COLORS.direct }, { name: 'O&M + opex', values: s3.finance.fullLife.omRs.filter((_, i) => i % 2 === 0).map((v) => v / 1e7), color: COLORS.grid }, { name: 'Capex', values: s3.finance.fullLife.capexRs.filter((_, i) => i % 2 === 0).map((v) => v / 1e7), color: COLORS.expired }]} format={(v) => `₹${v.toFixed(1)} Cr`} height={200} />
          <div className="grid kpis"><Kpi label="NPV @10%" value={fmtInr(s3.finance.fullLife.npvRs)} /><Kpi label="IRR" value={fmtIrr(s3.finance.fullLife.irr, s3.finance.fullLife.irrNote)} sub="unlevered, pre-tax project" /><Kpi label="Discounted payback" value={s3.finance.fullLife.discountedPaybackYears ? `${s3.finance.fullLife.discountedPaybackYears.toFixed(1)} y` : 'none within life'} /><Kpi label="Year-1 FCF" value={fmtInr(s3.finance.fullLife.fcfRs[1])} /></div>
        </Section>
      )}

      <Section title="Sensitivity (S3 inputs, approximate finance)" right={<button className="btn primary" disabled={busy} onClick={runSensitivity}>{busy ? 'running…' : 'Run sensitivity'}</button>}>
        {sens ? <Table dense columns={[{ key: 'name', label: 'Case' }, { key: 'ownerNpv', label: 'Owner NPV', align: 'right', render: (v) => fmtInr(v as number) }, { key: 'spvNpv', label: 'SPV full-life NPV', align: 'right', render: (v) => fmtInr(v as number) }, { key: 'useful', label: 'Useful solar', align: 'right', render: (v) => fmtKwh(v as number) }]} rows={sens} /> : <p className="muted">Runs twelve one-at-a-time variations (generation, tariffs, capex, losses, BESS cost, billing basis, banking rules).</p>}
      </Section>
    </>
  );
}
