import React, { useEffect, useState } from 'react';
import { useStore, useResult, seed } from '../state/store.tsx';
import { BarChart, LineChart, Kpi, Badge, Table, Section, Details, COLORS } from '../components/charts.tsx';
import { fmtInr, fmtKwh, fmtPct, fmtNum, monthLabel } from '../lib/format.ts';
import { monthRows, sumRows, viewLabel } from '../lib/view.ts';
import type { DayDetail } from '../engine/summary.ts';

export function useDayDetail(key: string | undefined, day: number, version: number): DayDetail | null {
  const { client } = useStore();
  const [d, setD] = useState<DayDetail | null>(null);
  useEffect(() => {
    if (!key) return;
    let alive = true;
    client.request<{ type: 'day'; detail: DayDetail | null }>({ type: 'day', key, day }).then((r) => { if (alive) setD(r.detail); }).catch(() => {});
    return () => { alive = false; };
  }, [key, day, version, client]);
  return d;
}

export default function CurrentTab() {
  const { state, dispatch } = useStore();
  const r = useResult('S0');
  const detail = useDayDetail(r?.key, state.selectedDay, state.status.version);
  if (!r) return <p className="muted">Computing the seeded baseline…</p>;
  const rows = monthRows(r, state.view);
  const exp = sumRows(rows, 'export'), direct = sumRows(rows, 'direct'), bank = sumRows(rows, 'bankWithdrawn'), bess = sumRows(rows, 'bess'), expired = sumRows(rows, 'expired'), comp = sumRows(rows, 'compensated'), unalloc = sumRows(rows, 'unallocated'), grid = sumRows(rows, 'grid'), load = sumRows(rows, 'load');
  const useful = direct + bank + bess;
  const savings = r.economics.reduce((a, e) => a + e.broaderVariableSavingRs, 0);
  const fac = r.economics[0];
  const cons = state.consumers;
  const portfolio = r.economics.map((e) => {
    const c = cons.find((x) => x.id === e.id)!;
    const alloc = c.currentAllocation;
    return { consumer: c.name, site: c.site, category: c.category, voltage: `${c.voltageKv} kV`, cd: `${fmtNum(c.contractDemandKva)} kVA`, load: e.loadKwh, mwp: alloc.mwp, offset: e.offsetKwh, grid: e.gridBilledKwh, landed: e.landedSolarRsPerKwh, saving: e.broaderVariableSavingRs, status: alloc.status, conf: c.monthly.filter((m) => String(m.tag).startsWith('extracted')).length };
  });
  const bands = r.bandTotals;
  const months = rows.map((m) => monthLabel(m.month));
  return (
    <>
      <p className="note">Lead figures for S0 (current allocation) under <b>{state.mode === 'tod_block' ? 'ToD block' : '15-minute'}</b> settlement · {viewLabel(state.view)}. Factory allocation ({(seed.consumers[0].currentAllocation.shareOfPlant * 100).toFixed(1)}% of plant export) is <Badge tone="good">confirmed from bills</Badge>; the remaining {fmtPct(1 - seed.consumers[0].currentAllocation.shareOfPlant)} of export is allocated to parties outside this dataset <Badge tone="warn">unknown — not assumed wasted</Badge>.</p>
      <div className="grid kpis">
        <Kpi label="Plant export (ABT meter)" value={fmtKwh(exp)} sub={state.view === 'annualised' ? `flat annualisation of ${fmtKwh(r.plant.observedExportKwh)} over ${r.calendar.observedDays} days` : 'reported, ×90 meter factor unverified'} />
        <Kpi label="Useful solar delivered to group" value={fmtKwh(useful)} sub={`${fmtPct(exp ? useful / exp : 0)} of export · direct ${fmtKwh(direct)} + settled credit ${fmtKwh(bank)}`} tone="good" />
        <Kpi label="Expired / uncompensated" value={fmtKwh(expired)} sub="allocated energy with no settlement credit (over-injection)" tone={expired > 0 ? 'bad' : 'neutral'} />
        <Kpi label="Compensated export" value={fmtKwh(comp)} sub={`at ₹${state.rules.expiredCompensationRsPerKwh}/kWh (unverified)`} />
        <Kpi label="Export outside this group" value={fmtKwh(unalloc)} sub="not allocated to the 8 consumers; disposition unknown" tone="warn" />
        <Kpi label="Grid purchases (group)" value={fmtKwh(grid)} sub={`of ${fmtKwh(load)} residual demand`} />
        <Kpi label="Existing consumer savings (C)" value={fmtInr(savings)} sub="annualised broader variable-bill saving vs grid-only" tone="good" />
        <Kpi label="Factory landed solar" value={`₹${fac.landedSolarRsPerKwh.toFixed(2)}/kWh`} sub={`vs avoided grid ₹${fac.avoidedGridRsPerKwh.toFixed(2)}/kWh (PPA ₹${state.consumers[0].ppaTariffRsPerKwh} + OA charges)`} />
      </div>

      <Section title="Why energy is not being monetised" note="Plain-English reading of the S0 result.">
        <ul className="tight">
          <li><b>Timing mismatch:</b> the factory's night load (00-06 band, ~{fmtPct(state.consumers[0].todShares.value[0])} of its drawal) cannot be met by solar; under the default rule pack solar surplus in 09-17 is only creditable inside the same ToD band and month, so {fmtKwh(expired)} of allocated energy lapses.</li>
          <li><b>Allocation mismatch:</b> {fmtKwh(unalloc)} of export is allocated outside the group ({fmtPct(r.plant.unallocatedMwp / r.plant.dcMwp)} of 7.5 MWp) — no saving accrues to the owner group for it.</li>
          <li><b>Banking restrictions:</b> bills show "last month banked = 0" every month; there is no carry-over, and the default withdrawal matrix allows same-band credit only (editable in Tab 6).</li>
          <li><b>Eligibility:</b> all seven stores are LT-II(C) connections without open-access permission; they currently take no captive solar (allocation status "unknown").</li>
          <li><b>Network / metering:</b> inverter MWac and approved export capacity are undocumented; {r.plant.acCeilingFlags} day(s) have reconstructed peaks above the {r.plant.acMw} MWac placeholder (flag only).</li>
        </ul>
      </Section>

      <Section title="Portfolio" note="Current MW allocation is the contractual MWp-equivalent share of the 7.5 MWp plant. Data confidence = number of extracted bill months.">
        <Table dense columns={[
          { key: 'consumer', label: 'Consumer' }, { key: 'category', label: 'Category' }, { key: 'voltage', label: 'Voltage' }, { key: 'cd', label: 'Contract demand', align: 'right' },
          { key: 'load', label: 'Residual demand /yr', align: 'right', render: (v) => fmtKwh(v as number) },
          { key: 'mwp', label: 'Current MWp', align: 'right', render: (v, row) => <>{(v as number).toFixed(2)} <Badge tone={row.status === 'confirmed' ? 'good' : row.status === 'assumed' ? 'warn' : 'neutral'}>{String(row.status)}</Badge></> },
          { key: 'offset', label: 'Solar offset', align: 'right', render: (v) => fmtKwh(v as number) }, { key: 'grid', label: 'Grid energy', align: 'right', render: (v) => fmtKwh(v as number) },
          { key: 'landed', label: 'Landed solar ₹/kWh', align: 'right', render: (v) => ((v as number) > 0 ? (v as number).toFixed(2) : '—') },
          { key: 'saving', label: 'Variable-bill saving', align: 'right', render: (v) => fmtInr(v as number) },
          { key: 'conf', label: 'Confidence', align: 'right', render: (v) => <Badge tone={(v as number) >= 9 ? 'good' : 'warn'}>{String(v)} bill-months</Badge> },
        ]} rows={portfolio} />
      </Section>

      <div className="grid two">
        <Section title="Consumption vs solar by ToD block (annual)" note="Group residual demand, allocated solar delivered and remaining grid energy per band.">
          <BarChart stacked={false} categories={bands.map((b) => b.band)} series={[{ name: 'Load', values: bands.map((b) => b.load / 1e6), color: COLORS.load }, { name: 'Plant export', values: bands.map((b) => b.solar / 1e6), color: COLORS.solar }, { name: 'Grid', values: bands.map((b) => b.grid / 1e6), color: COLORS.grid }]} format={(v) => `${v.toFixed(1)} GWh`} />
        </Section>
        <Section title="Monthly energy disposition (plant export)" note="Where each month's export goes. Bank deposits are not shown separately (they become withdrawals, expiry or compensation) to avoid double counting.">
          <BarChart categories={months} series={[
            { name: 'Direct use', values: rows.map((m) => m.direct / 1e3), color: COLORS.direct },
            { name: 'Bank / block credit', values: rows.map((m) => m.bankWithdrawn / 1e3), color: COLORS.bank },
            { name: 'Battery-delivered', values: rows.map((m) => m.bess / 1e3), color: COLORS.bess },
            { name: 'Compensated surplus', values: rows.map((m) => m.compensated / 1e3), color: COLORS.compensated },
            { name: 'Expired surplus', values: rows.map((m) => m.expired / 1e3), color: COLORS.expired },
            { name: 'Losses / banking charge', values: rows.map((m) => m.losses / 1e3), color: COLORS.losses },
            { name: 'Outside group', values: rows.map((m) => m.unallocated / 1e3), color: COLORS.unallocated },
          ]} format={(v) => (v >= 1000 ? `${(v / 1000).toFixed(1)} GWh` : `${fmtNum(v)} MWh`)} />
        </Section>
      </div>

      <Section title={`Representative day — ${detail?.date ?? '…'} (15-minute, kW)`} note="Intraday solar and load curves are ESTIMATED reconstructions normalised to reported daily export and monthly ToD totals." right={
        <div className="btn-row"><button className="btn" onClick={() => dispatch({ type: 'set', patch: { selectedDay: Math.max(0, state.selectedDay - 1) } })}>◀ day</button><span className="small mono">{detail?.date}</span><button className="btn" onClick={() => dispatch({ type: 'set', patch: { selectedDay: Math.min(364, state.selectedDay + 1) } })}>day ▶</button></div>}>
        {detail ? <LineChart x={detail.hours} xFormat={(h) => `${String(Math.floor(h)).padStart(2, '0')}:00`} format={(v) => `${fmtNum(v / 1000, 1)} MW`} area={['Plant export', 'Group load']} series={[
          { name: 'Plant export', values: detail.plantExport, color: COLORS.solar },
          { name: 'Group load', values: detail.portfolio.load, color: COLORS.load },
          { name: 'Solar used directly', values: detail.portfolio.direct, color: COLORS.direct },
          { name: 'Grid (physical)', values: detail.portfolio.grid, color: COLORS.grid },
        ]} /> : <p className="muted">loading…</p>}
      </Section>

      <Details summary="Bill reconciliation and data-quality panel">
        <h4>Factory 411639023090 — engine vs billed monthly offset (S0)</h4>
        <Table dense columns={[{ key: 'month', label: 'Month' }, { key: 'drawal', label: 'Bill drawal', align: 'right' }, { key: 'eload', label: 'Engine load', align: 'right' }, { key: 'boff', label: 'Bill OA offset', align: 'right' }, { key: 'eoff', label: 'Engine offset', align: 'right' }, { key: 'gap', label: 'Gap', align: 'right' }, { key: 'binj', label: 'Bill injection', align: 'right' }, { key: 'plant', label: 'Plant export', align: 'right' }, { key: 'over', label: 'Bill over-injected', align: 'right' }]}
          rows={r.consumers[0].months.map((m) => { const b = seed.consumers[0].monthly.find((x) => x.month === m.month); const boff = (b?.oa_offset_kwh as number) ?? null; return { month: monthLabel(m.month), drawal: b ? fmtNum(b.drawal_kwh as number) : '— (projected)', eload: fmtNum(m.load), boff: boff !== null ? fmtNum(boff) : '—', eoff: fmtNum(m.offset), gap: boff !== null ? fmtPct((m.offset - boff) / boff) : '—', binj: b ? fmtNum(b.oa_injection_kwh as number) : '—', plant: fmtNum(seed.plant.export.monthlyKwh[m.month] ?? 0), over: b ? fmtNum(b.over_injected_kwh as number) : '—' }; })} />
        <p className="note">Dec-25 → Feb-26 bills credited markedly more offset than any band-wise netting of a 24×7 profile allows (those bills booked all residual units in zone D); from Mar-26 the bills reconcile within roughly ±10%. The factory's injection is ~59% of plant export each month (Nov-25 excepted: commissioning month) — this ratio is the basis of the "confirmed" allocation.</p>
        <h4>Generation workbook checks</h4>
        <ul className="tight">
          <li>{seed.plant.export.nDays} dated daily records, {fmtKwh(seed.plant.export.totalKwh, 4)} reported export; {seed.plant.export.zeroDays.length} zero day(s): {seed.plant.export.zeroDays.join(', ')} (Jul-8 marked "Breakdown" — preserved as an outage, see Tab 6 to run a recovered-availability case).</li>
          <li>Meter factor: {seed.plant.export.meterFactor.note}</li>
          <li>{seed.plant.export.days.filter((d) => d.hardcoded).length} daily rows are hard-coded values instead of the (FMR−IMR)×90 formula (Jun 17/18/20/23, Sep 28) — rounding discontinuities &lt; 1 kWh.</li>
          {seed.plant.export.issues.map((i, k) => <li key={k}>{JSON.stringify(i)}</li>)}
        </ul>
        <h4>Store bills</h4>
        <ul className="tight">
          {seed.consumers.slice(1).map((c) => <li key={c.id}><b>{c.id}</b> {c.name}: {c.todShares.note} · PF {c.pf} · rooftop {c.rooftop ? `${c.rooftop.kw} kW` : 'none'} · {c.eligibilityNote}</li>)}
        </ul>
      </Details>
    </>
  );
}
