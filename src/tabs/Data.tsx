import React, { useEffect, useState } from 'react';
import { useStore, seed, initialState, type AppState } from '../state/store.tsx';
import { Section, NumberInput, Toggle, Select, Table, Badge, Details } from '../components/charts.tsx';
import { idbSet, idbGet, idbKeys, idbDel } from '../lib/persist.ts';
import { downloadCsv, downloadJson } from '../lib/export.ts';
import { fmtKwh, fmtNum } from '../lib/format.ts';

const SAVE_KEYS: (keyof AppState)[] = ['mode', 'consumers', 'rules', 'plant', 'finance', 'allocS1', 'newCustomer', 'bess', 'loadTrend', 'loadShift'];

export default function DataTab() {
  const { state, dispatch } = useStore();
  const [saved, setSaved] = useState<string[]>([]);
  const [name, setName] = useState('my-scenario');
  const refresh = () => idbKeys().then(setSaved).catch(() => setSaved([]));
  useEffect(() => { refresh(); }, []);
  const snapshot = () => { const o: Partial<AppState> = {}; for (const k of SAVE_KEYS) (o as Record<string, unknown>)[k] = state[k]; return { ...o, plant: { ...state.plant, exportDaily: undefined } } as Partial<AppState>; };
  const restore = (o: Partial<AppState>) => { const p = { ...o, plant: { ...initialState().plant, ...(o.plant ?? {}), exportDaily: initialState().plant.exportDaily } }; dispatch({ type: 'load', state: p }); };
  const fac = state.consumers[0];
  const r = state.rules;
  return (
    <>
      <Section title="Scenario save / load, import & export" note="Saved in this browser (IndexedDB); JSON export/import moves scenarios between machines. Daily generation is not re-saved — it is the seeded evidence.">
        <div className="btn-row">
          <label className="field"><span>Scenario name</span><input type="text" value={name} onChange={(e) => setName(e.target.value)} /></label>
          <button className="btn primary" onClick={async () => { await idbSet(name, snapshot()); refresh(); }}>Save</button>
          <button className="btn" onClick={() => downloadJson(`${name}.json`, snapshot())}>Export JSON</button>
          <label className="btn">Import JSON<input type="file" accept="application/json" style={{ display: 'none' }} onChange={async (e) => { const f = e.target.files?.[0]; if (!f) return; restore(JSON.parse(await f.text())); }} /></label>
          <button className="btn" onClick={() => downloadCsv('generation_daily.csv', seed.plant.export.days.map((d) => ({ date: d.date, kwh_reported: d.kwh, hardcoded: d.hardcoded, note: d.note ?? '' })))}>Daily export CSV</button>
          <button className="btn" onClick={() => downloadCsv('consumers_monthly.csv', state.consumers.flatMap((c) => c.monthly.map((m) => ({ consumer: c.id, name: c.name, ...m }))))}>Consumer months CSV</button>
          <button className="btn" onClick={() => downloadJson('seed_case.json', seed)}>Full seed JSON</button>
        </div>
        {saved.length > 0 && <Table dense columns={[{ key: 'k', label: 'Saved scenario' }, { key: 'a', label: '', render: (_v, row) => <span className="btn-row"><button className="btn" onClick={async () => { const o = await idbGet<Partial<AppState>>(String(row.k)); if (o) restore(o); }}>Load</button><button className="btn" onClick={async () => { await idbDel(String(row.k)); refresh(); }}>Delete</button></span> }]} rows={saved.map((k) => ({ k }))} />}
      </Section>

      <div className="grid two">
        <Section title="Plant & generation" note={`${seed.plant.export.seriesType}. Observed ${seed.plant.export.nDays} days, ${fmtKwh(seed.plant.export.totalKwh, 4)}; flat annualisation ${fmtKwh(seed.plant.export.flatAnnualisationKwh, 4)} (not an independently validated yield).`}>
          <div className="fields">
            <NumberInput label="DC capacity" unit="MWp" value={state.plant.dcMwp} step={0.1} onChange={(v) => dispatch({ type: 'patchPlant', patch: { dcMwp: v } })} />
            <NumberInput label="Inverter / export ceiling (unverified)" unit="MWac" value={state.plant.acMw} step={0.1} onChange={(v) => dispatch({ type: 'patchPlant', patch: { acMw: v } })} note={seed.plant.acMwInverter.note} />
            <NumberInput label="October estimate" unit="kWh/day" value={state.plant.octoberEstimateKwhPerDay ?? Math.round(seed.plant.export.totalKwh / seed.plant.export.nDays)} step={500} onChange={(v) => dispatch({ type: 'patchPlant', patch: { octoberEstimateKwhPerDay: v } })} note="Default = observed daily average (flat extrapolation)" />
            <NumberInput label="Meter-factor override (×)" value={state.plant.meterFactorOverride ?? 1} step={0.01} onChange={(v) => dispatch({ type: 'patchPlant', patch: { meterFactorOverride: v } })} note="1 = keep reported kWh. Sensitivity only; the ×90 in the workbook is corroborated by the OA bill's meter MF 90 but not by a metering certificate." />
            <Select label="Intraday shape" value={state.plant.profileShape} options={[{ value: 'smooth', label: 'Smooth clear-sky' }, { value: 'variable', label: 'Variable (deterministic cloudiness)' }]} onChange={(v) => dispatch({ type: 'patchPlant', patch: { profileShape: v } })} />
            <Toggle label="Recovered-availability case (fill Jul-8 breakdown)" checked={state.plant.recoveredAvailability} onChange={(v) => dispatch({ type: 'patchPlant', patch: { recoveredAvailability: v } })} />
            <Select label="Consumption trend for missing months" value={state.loadTrend} options={[{ value: 'flat', label: 'Flat (observed daily average)' }, { value: 'seasonal', label: 'Seasonal (same month prior year, re-levelled)' }]} onChange={(v) => dispatch({ type: 'set', patch: { loadTrend: v } })} />
          </div>
          <p className="note">Meter factor: <Badge tone="warn">{seed.plant.export.meterFactor.status}</Badge> {seed.plant.export.meterFactor.note}</p>
          <p className="note">Cost-sheet illustration (Landed_Cost_Sheet_MH_2.xlsx / Maharashtra): 4 MWac, AC CUF {(seed.plant.costSheetIllustration.cufAc as number * 100).toFixed(2)}%, ₹3.50 tariff, transmission ₹1.04 + 3.28% loss, wheeling ₹0.62 + 7.5% loss, banking 8% (30%×8% = 2.4% effective) — NOT used as inputs; the Summary sheet's grid-tariff cell is #DIV/0!.</p>
        </Section>

        <Section title={`Rule pack — ${r.label}`} note={`id ${r.id} · effective ${r.effectiveFrom}. ToD price bands and settlement interval are independent; switching to 15-minute does not alter prices or banking rules by itself.`}>
          <div className="fields">
            <Toggle label="Banking allowed" checked={r.bankingAllowed} onChange={(v) => dispatch({ type: 'patchRules', patch: { bankingAllowed: v } })} />
            <NumberInput label="Banking charge (in kind)" unit="%" value={r.bankingChargePct} step={1} min={0} onChange={(v) => dispatch({ type: 'patchRules', patch: { bankingChargePct: v } })} />
            <NumberInput label="Deposit cap" unit="% of period consumption" value={r.bankCapPctOfConsumption} step={5} min={0} onChange={(v) => dispatch({ type: 'patchRules', patch: { bankCapPctOfConsumption: v } })} />
            <NumberInput label="Compensation for unused energy" unit="₹/kWh" value={r.expiredCompensationRsPerKwh} step={0.25} min={0} onChange={(v) => dispatch({ type: 'patchRules', patch: { expiredCompensationRsPerKwh: v } })} note="0 = lapses (bills show no compensation line)" />
          </div>
          <h4 className="small">Permitted withdrawal matrix (deposit band → withdrawal bands), adjustment period = month</h4>
          <Table dense columns={[{ key: 'dep', label: 'Deposit ↓ / withdraw →' }, ...r.todBands.map((b) => ({ key: b.id, label: b.label, align: 'right' as const, render: (_v: unknown, row: Record<string, unknown>) => { const dep = String(row.dep).slice(0, 1); const on = (r.withdrawalMatrix[dep] ?? []).includes(b.id); return <input type="checkbox" checked={on} onChange={(e) => { const cur = new Set(r.withdrawalMatrix[dep] ?? []); if (e.target.checked) cur.add(b.id); else cur.delete(b.id); dispatch({ type: 'patchRules', patch: { withdrawalMatrix: { ...r.withdrawalMatrix, [dep]: [...cur] } } }); }} />; } }))]} rows={r.todBands.map((b) => ({ dep: `${b.id} ${b.label}` }))} />
          <ul className="tight small">{r.notes?.map((n, i) => <li key={i}>{n}</li>)}</ul>
          <h4 className="small">Regulatory sources (inspected 8 Oct 2026)</h4>
          <Table dense columns={[{ key: 'title', label: 'Source' }, { key: 'url', label: 'URL', render: (v) => <a href={String(v)} target="_blank" rel="noreferrer">{String(v)}</a> }, { key: 'status', label: 'Status' }]} rows={(r.sources ?? []) as unknown as Record<string, unknown>[]} />
          <p className="note">Unresolved: applicability/transition date of MERC Distribution OA Regulations 2026 and BESS Regulations 2026 (drafts); whether ToSE applies to captive OA energy; compensation (if any) for over-injection; group-captive qualification of the new consumer; MSEDCL's settlement granularity (block vs 15-min) going forward. Nothing here is certified compliant.</p>
        </Section>
      </div>

      <Section title="Consumers — editable source-backed inputs" note="Tariff rates are those printed on FY27 bills (01-04-2026). Monthly kWh: factory = total site drawal at the 33 kV meter (grid + OA, rooftop excluded); stores = import at the LT meter (rooftop self-consumed first); history months are kVAh × PF.">
        <Table dense columns={[
          { key: 'name', label: 'Consumer' }, { key: 'category', label: 'Category' },
          { key: 'pf', label: 'PF', align: 'right', render: (v, row) => <input type="number" step={0.001} value={v as number} style={{ width: 70 }} onChange={(e) => dispatch({ type: 'patchConsumer', id: String(row.id), patch: { pf: Number(e.target.value) } })} /> },
          { key: 'ec', label: 'EC ₹/kVAh', align: 'right', render: (_v, row) => { const c = state.consumers.find((x) => x.id === row.id)!; return <input type="number" step={0.01} value={c.tariff.energyRsPerKvah} style={{ width: 70 }} onChange={(e) => dispatch({ type: 'patchConsumer', id: c.id, patch: { tariff: { ...c.tariff, energyRsPerKvah: Number(e.target.value) } } })} />; } },
          { key: 'tod', label: 'ToD ₹/kVAh (A,B,C,D)', align: 'right', render: (_v, row) => state.consumers.find((x) => x.id === row.id)!.tariff.todRsPerKvah.join(', ') },
          { key: 'ppa', label: 'PPA ₹/kWh', align: 'right', render: (_v, row) => { const c = state.consumers.find((x) => x.id === row.id)!; return <input type="number" step={0.05} value={c.ppaTariffRsPerKwh} style={{ width: 70 }} onChange={(e) => dispatch({ type: 'patchConsumer', id: c.id, patch: { ppaTariffRsPerKwh: Number(e.target.value) } })} />; } },
          { key: 'basis', label: 'PPA basis', render: (_v, row) => { const c = state.consumers.find((x) => x.id === row.id)!; return <select value={c.ppaBillingBasis} onChange={(e) => dispatch({ type: 'patchConsumer', id: c.id, patch: { ppaBillingBasis: e.target.value as 'offset' | 'injection' | 'delivered' } })}><option value="offset">offset</option><option value="delivered">delivered</option><option value="injection">injection</option></select>; } },
          { key: 'months', label: 'Months (measured)', align: 'right', render: (_v, row) => String(state.consumers.find((x) => x.id === row.id)!.monthly.length) },
          { key: 'shares', label: 'ToD shares', render: (_v, row) => { const c = state.consumers.find((x) => x.id === row.id)!; return <span title={c.todShares.note}>{c.todShares.value.map((s) => (s * 100).toFixed(0) + '%').join(' / ')} <Badge tone={c.todShares.tag === 'derived_from_actual' ? 'good' : 'warn'}>{c.todShares.tag}</Badge></span>; } },
          { key: 'elig', label: 'OA eligible', render: (_v, row) => { const c = state.consumers.find((x) => x.id === row.id)!; return <Badge tone={c.oaEligible ? 'good' : 'bad'} title={c.eligibilityNote}>{c.oaEligible ? 'yes' : 'no'}</Badge>; } },
        ]} rows={state.consumers.map((c) => ({ id: c.id, name: c.name, category: c.category, pf: c.pf }))} />
        <h4 className="small">Factory OA charges (from the bills' Open Access section)</h4>
        <div className="fields">
          <NumberInput label="Wheeling" unit="₹/kWh injected" value={fac.oaCharges!.wheelingRsPerKwhInjected} step={0.01} onChange={(v) => dispatch({ type: 'patchConsumer', id: fac.id, patch: { oaCharges: { ...fac.oaCharges!, wheelingRsPerKwhInjected: v } } })} />
          <NumberInput label="Transmission" unit="₹/kWh offset" value={fac.oaCharges!.transmissionRsPerKwhOffset} step={0.01} onChange={(v) => dispatch({ type: 'patchConsumer', id: fac.id, patch: { oaCharges: { ...fac.oaCharges!, transmissionRsPerKwhOffset: v } } })} />
          <NumberInput label="Operating" unit="₹/month" value={fac.oaCharges!.operatingRsPerMonth} step={500} onChange={(v) => dispatch({ type: 'patchConsumer', id: fac.id, patch: { oaCharges: { ...fac.oaCharges!, operatingRsPerMonth: v } } })} />
          <NumberInput label="ToSE on OA units" unit="paise/kWh" value={fac.oaCharges!.tosePaisePerKwhOffset} step={0.1} onChange={(v) => dispatch({ type: 'patchConsumer', id: fac.id, patch: { oaCharges: { ...fac.oaCharges!, tosePaisePerKwhOffset: v } } })} />
          <NumberInput label="In-kind network losses" unit="%" value={typeof fac.oaCharges!.inKindLossPct === 'number' ? fac.oaCharges!.inKindLossPct : (fac.oaCharges!.inKindLossPct?.value ?? 0)} step={0.5} onChange={(v) => dispatch({ type: 'patchConsumer', id: fac.id, patch: { oaCharges: { ...fac.oaCharges!, inKindLossPct: v } } })} />
          <NumberInput label="CSS (sensitivity)" unit="₹/kWh" value={fac.oaCharges!.cssRsPerKwh ?? 0} step={0.1} onChange={(v) => dispatch({ type: 'patchConsumer', id: fac.id, patch: { oaCharges: { ...fac.oaCharges!, cssRsPerKwh: v } } })} />
        </div>
      </Section>

      <Section title="Financial assumptions (modelling assumptions, not supplied facts)">
        <div className="fields">
          <NumberInput label="Solar capex (original)" unit="₹ Cr" value={state.finance.solarCapexRsCr} step={1} onChange={(v) => dispatch({ type: 'patchFinance', patch: { solarCapexRsCr: v } })} />
          <NumberInput label="Life" unit="years" value={state.finance.lifeYears} step={1} min={1} max={40} onChange={(v) => dispatch({ type: 'patchFinance', patch: { lifeYears: v } })} />
          <NumberInput label="Solar degradation" unit="%/yr" value={state.finance.solarDegradationPct} step={0.1} onChange={(v) => dispatch({ type: 'patchFinance', patch: { solarDegradationPct: v } })} />
          <NumberInput label="O&M year 1" unit="% capex" value={state.finance.omPctOfCapexYear1} step={0.1} onChange={(v) => dispatch({ type: 'patchFinance', patch: { omPctOfCapexYear1: v } })} />
          <NumberInput label="O&M escalation" unit="%/yr" value={state.finance.omEscalationPct} step={0.5} onChange={(v) => dispatch({ type: 'patchFinance', patch: { omEscalationPct: v } })} />
          <NumberInput label="PPA escalation" unit="%/yr" value={state.finance.ppaEscalationPct} step={0.5} onChange={(v) => dispatch({ type: 'patchFinance', patch: { ppaEscalationPct: v } })} />
          <NumberInput label="Discount rate (nominal)" unit="%" value={state.finance.discountRatePct} step={0.5} onChange={(v) => dispatch({ type: 'patchFinance', patch: { discountRatePct: v } })} />
          <NumberInput label="Receivables" unit="days" value={state.finance.receivableDays} step={5} onChange={(v) => dispatch({ type: 'patchFinance', patch: { receivableDays: v } })} />
          <NumberInput label="Other opex" unit="₹ Cr/yr" value={state.finance.otherOpexRsCrPerYear} step={0.1} onChange={(v) => dispatch({ type: 'patchFinance', patch: { otherOpexRsCrPerYear: v } })} note="Insurance, land, admin - not known, default 0" />
          <NumberInput label="Terminal recovery" unit="₹ Cr" value={state.finance.terminalValueRsCr} step={0.5} onChange={(v) => dispatch({ type: 'patchFinance', patch: { terminalValueRsCr: v } })} />
        </div>
      </Section>

      <Details summary="Methodology">
        <ul className="tight small">
          <li><b>Calendar:</b> Nov-25 → Oct-26, 96 intervals/day, Asia/Kolkata wall clock. October export is estimated; all other days are the reported ABT export.</li>
          <li><b>Solar:</b> each day's reported kWh is spread over a clear-sky-shaped curve (solar geometry for 20.65°N, 78.48°E). Days whose reconstructed peak exceeds the MWac placeholder are flagged, never clipped.</li>
          <li><b>Load:</b> monthly totals from bills (factory total drawal; store imports), projected flat or seasonally for missing months; within-day shape from ToD band shares (stores: billed ToD kVAh split; factory: synthetic 24×7 with 1.3× daytime weight calibrated to Apr–Jul 2026 billed offsets). Rooftop self-consumption has first claim and is excluded from both the 7.5 MWp plant and the loads.</li>
          <li><b>Allocation:</b> each consumer receives a fixed contractual share (MWp/7.5) of every interval's export; Σ ≤ 7.5 MWp; in-kind losses configurable; the unallocated residual is reported, never silently treated as waste.</li>
          <li><b>Settlement:</b> physical layer always 15-minute (direct use = min(load, solar)). ToD-block mode nets within (month, band) then applies the withdrawal matrix; 15-minute mode runs a chronological in-month bank ledger (no credit from future deposits). Unused deposits expire or are compensated at the configured rate; banking charge in kind; deposit cap as % of period consumption.</li>
          <li><b>BESS:</b> sequential dispatch, plant-side pools all consumers (unallocated residual charged first), consumer-side restricted to one site; value-aware discharge bands; capex, O&M, replacement at battery life; compared against S2.</li>
          <li><b>Economics:</b> grid-only counterfactual on the same load/PF/category; kVAh = kWh/PF; bridges A–D; landed solar = (PPA + applicable OA charges)/useful kWh; OA charges configured per charge with its own basis (injected / offset / per month); no blanket loss factor.</li>
          <li><b>Finance:</b> 25 annual re-dispatches with degraded solar and battery (exact mode) or year-1 scaled by degradation (preview/optimiser); unlevered pre-tax project IRR with ₹30 Cr y0; incremental NPV where the decision has no outlay; IRR reported "not defined" rather than fabricated.</li>
          <li><b>Optimiser:</b> bounded coordinate-descent grid; labelled "best evaluated"; protects baseline savings by default.</li>
        </ul>
      </Details>

      <Details summary="Source files & bill inventory">
        <p className="small">Generation: {seed.plant.export.days.length} daily rows from Daily_Generation_June-26.xlsx (Nov-25…Jun-26 sheets), July-26, Aug-26, Sep-26. Bills: Harrshiv_OA_Bills.zip (9 HT bills Nov-25…Jul-26, consumer 411639023090) and Elec._Bills-_Stores.zip (7 LT consumers, 21 unique bills Mar/Apr/May-26 (+Jun-26 for 413894361291), 12 duplicate files). Extraction scripts: scripts/extract/*.py; seed JSON: src/data/seed/.</p>
        <Table dense columns={[{ key: 'month', label: 'Factory month' }, { key: 'drawal', label: 'Drawal', align: 'right' }, { key: 'inj', label: 'Injection', align: 'right' }, { key: 'off', label: 'Offset', align: 'right' }, { key: 'grid', label: 'Grid', align: 'right' }, { key: 'over', label: 'Over-injected', align: 'right' }, { key: 'roof', label: 'Rooftop', align: 'right' }, { key: 'bill', label: 'Current bill ₹', align: 'right' }, { key: 'debit', label: 'Debit adj ₹', align: 'right' }, { key: 'src', label: 'Source' }]} rows={seed.consumers[0].monthly.map((m) => ({ month: m.month, drawal: fmtNum(m.drawal_kwh as number), inj: fmtNum(m.oa_injection_kwh as number), off: fmtNum(m.oa_offset_kwh as number), grid: fmtNum(m.grid_kwh as number), over: fmtNum(m.over_injected_kwh as number), roof: fmtNum(m.rooftop_kwh as number), bill: fmtNum(m.total_current_bill_rs as number), debit: fmtNum(m.debit_adjustment_rs as number), src: (m.source as { file: string }).file }))} />
        <p className="note">Retrospective adjustments, arrears, deposits and late fees (e.g. ₹9.04 L recurring debit, ₹80.5 L wheeling-loss supplementary, SD interest) are excluded from the recurring savings model.</p>
      </Details>
    </>
  );
}
