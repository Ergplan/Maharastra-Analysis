import React, { useState } from 'react';
import { useStore, useResult, seed } from '../state/store.tsx';
import { Kpi, Badge, Table, Section, Select, NumberInput, Toggle, LineChart, COLORS } from '../components/charts.tsx';
import { fmtInr, fmtKwh, fmtNum, fmtPct } from '../lib/format.ts';
import { useSizing } from './Optimise.tsx';
import { useDayDetail } from './Current.tsx';

export default function NewCustomerTab() {
  const { state, dispatch } = useStore();
  const nc = state.newCustomer;
  const s1 = useResult('S1'); const s2 = useResult('S2');
  const sizing = useSizing(s1?.key, state.status.version);
  const detail = useDayDetail(s2?.key, state.selectedDay, state.status.version);
  const [csv, setCsv] = useState('');
  const e2new = s2?.economics.find((e) => e.id === 'NEW132');
  const existingS1 = s1?.economics.reduce((a, e) => a + e.broaderVariableSavingRs, 0) ?? 0;
  const existingS2 = s2?.economics.filter((e) => e.id !== 'NEW132').reduce((a, e) => a + e.broaderVariableSavingRs, 0) ?? 0;
  const cap = seed.plant.dcMwp;
  const existingAlloc = Object.values(state.allocS1).reduce((a, b) => a + b, 0);
  const landedParts = e2new ? { ppa: nc.ppaTariffRsPerKwh, oa: e2new.offsetKwh > 0 ? e2new.oaCostRs / e2new.offsetKwh : 0 } : null;
  const newDay = detail?.perConsumer.find((c) => c.id === 'NEW132');
  return (
    <>
      <p className="note">The new consumer is modelled as a <Badge tone="warn">synthetic, editable assumption</Badge> — its demand, category and tariff are unknown. Base solar tariff defaults to ₹2.50/kWh ex-bus; delivered landed cost and avoided grid tariff are kept separate. Its savings are labelled <b>illustrative</b> until a tariff category is confirmed.</p>
      <div className="grid kpis">
        <Kpi label="Feasible MW offered" value={`${nc.allocationMwp.toFixed(2)} MWp`} sub={`existing allocations ${existingAlloc.toFixed(2)} MWp · headroom ${(cap - existingAlloc).toFixed(2)} MWp`} tone={existingAlloc + nc.allocationMwp > cap ? 'bad' : 'neutral'} />
        <Kpi label="Billed kWh (PPA basis: offset)" value={fmtKwh(e2new?.billedPpaKwh ?? 0)} sub={`actually offset ${fmtKwh(e2new?.offsetKwh ?? 0)}`} />
        <Kpi label="Remaining surplus (S2)" value={fmtKwh((s2?.bridge.expired ?? 0) + (s2?.bridge.unallocatedResidual ?? 0))} sub={`was ${fmtKwh((s1?.bridge.expired ?? 0) + (s1?.bridge.unallocatedResidual ?? 0))} in S1`} tone="warn" />
        <Kpi label="New consumer saving" value={nc.tariffKnown ? fmtInr(e2new?.broaderVariableSavingRs ?? 0) : `${fmtInr(e2new?.broaderVariableSavingRs ?? 0)} (illustrative)`} sub={`landed ₹${(e2new?.landedSolarRsPerKwh ?? 0).toFixed(2)} vs avoided ₹${(e2new?.avoidedGridRsPerKwh ?? 0).toFixed(2)}/kWh`} tone="neutral" />
        <Kpi label="SPV incremental revenue" value={fmtInr(s2?.spv.revenueNewRs ?? 0)} sub="external receipts at the new-customer tariff" tone="good" />
        <Kpi label="Impact on existing consumers" value={fmtInr(existingS2 - existingS1)} sub="change in existing savings S2 vs S1 (should be ≈0 unless allocations were cut)" tone={existingS2 - existingS1 < -1 ? 'bad' : 'neutral'} />
      </div>

      <Section title="New 132 kV consumer — inputs">
        <div className="fields">
          <label className="field"><span>Name</span><input type="text" value={nc.name} onChange={(e) => dispatch({ type: 'patchNew', patch: { name: e.target.value } })} /></label>
          <label className="field"><span>Tariff category (unknown)</span><input type="text" value={nc.category} onChange={(e) => dispatch({ type: 'patchNew', patch: { category: e.target.value } })} /></label>
          <NumberInput label="Contract demand" unit="kVA" value={nc.contractDemandKva} step={100} onChange={(v) => dispatch({ type: 'patchNew', patch: { contractDemandKva: v } })} />
          <NumberInput label="Average load" unit="MW" value={nc.avgLoadMw} step={0.25} min={0} onChange={(v) => dispatch({ type: 'patchNew', patch: { avgLoadMw: v } })} />
          <Select label="Profile" value={nc.profile} options={[{ value: 'factory24x7', label: '24×7 factory (flat)' }, { value: 'dayShift', label: 'Day shift 08-18 (20% at night)' }, { value: 'custom', label: 'Custom 96-value CSV' }]} onChange={(v) => dispatch({ type: 'patchNew', patch: { profile: v } })} />
          <NumberInput label="Weekend factor" value={nc.weekendFactor} step={0.1} min={0} max={1.5} onChange={(v) => dispatch({ type: 'patchNew', patch: { weekendFactor: v } })} />
          <NumberInput label="Solar allocation" unit="MWp" value={nc.allocationMwp} step={0.25} min={0} max={cap} onChange={(v) => dispatch({ type: 'patchNew', patch: { allocationMwp: v } })} />
          <NumberInput label="Base PPA tariff" unit="₹/kWh" value={nc.ppaTariffRsPerKwh} step={0.05} onChange={(v) => dispatch({ type: 'patchNew', patch: { ppaTariffRsPerKwh: v } })} />
          <Select label="PPA billing basis" value={nc.ppaBillingBasis} options={[{ value: 'offset', label: 'Adjusted / offset energy' }, { value: 'delivered', label: 'Delivered energy (incl. unabsorbed)' }, { value: 'injection', label: 'Injected energy (take-or-pay)' }]} onChange={(v) => dispatch({ type: 'patchNew', patch: { ppaBillingBasis: v } })} />
          <NumberInput label="Ownership share in SPV" unit="%" value={nc.ownershipSharePct} step={1} min={0} max={100} note="Group-captive requires >=26% - not verified" onChange={(v) => dispatch({ type: 'patchNew', patch: { ownershipSharePct: v } })} />
          <Toggle label="Customer tariff confirmed (removes 'illustrative' label)" checked={nc.tariffKnown} onChange={(v) => dispatch({ type: 'patchNew', patch: { tariffKnown: v } })} />
        </div>
        <h4 className="small">Avoided grid tariff assumptions (illustrative HT-I(A) FY27 rates copied from the factory bill)</h4>
        <div className="fields">
          <NumberInput label="Energy charge" unit="₹/kVAh" value={nc.avoidedGridTariff.energyRsPerKvah} step={0.01} onChange={(v) => dispatch({ type: 'patchNew', patch: { avoidedGridTariff: { ...nc.avoidedGridTariff, energyRsPerKvah: v } } })} />
          {nc.avoidedGridTariff.todRsPerKvah.map((t, i) => <NumberInput key={i} label={`ToD ${state.rules.todBands[i].label}`} unit="₹/kVAh" value={t} step={0.01} onChange={(v) => { const tod = [...nc.avoidedGridTariff.todRsPerKvah]; tod[i] = v; dispatch({ type: 'patchNew', patch: { avoidedGridTariff: { ...nc.avoidedGridTariff, todRsPerKvah: tod } } }); }} />)}
          <NumberInput label="FAC" unit="₹/kVAh" value={nc.avoidedGridTariff.facRsPerKvah} step={0.05} onChange={(v) => dispatch({ type: 'patchNew', patch: { avoidedGridTariff: { ...nc.avoidedGridTariff, facRsPerKvah: v } } })} />
        </div>
        <h4 className="small">Network path & OA charges (33 kV injection → MSEDCL network → 132 kV drawal)</h4>
        <div className="fields">
          <Toggle label="Apply 33 kV wheeling on injected units" checked={nc.oaCharges.applyWheeling ?? true} onChange={(v) => dispatch({ type: 'patchNew', patch: { oaCharges: { ...nc.oaCharges, applyWheeling: v } } })} note={nc.oaCharges.note} />
          <NumberInput label="Wheeling" unit="₹/kWh inj." value={nc.oaCharges.wheelingRsPerKwhInjected} step={0.01} onChange={(v) => dispatch({ type: 'patchNew', patch: { oaCharges: { ...nc.oaCharges, wheelingRsPerKwhInjected: v } } })} />
          <NumberInput label="Transmission" unit="₹/kWh offset" value={nc.oaCharges.transmissionRsPerKwhOffset} step={0.01} onChange={(v) => dispatch({ type: 'patchNew', patch: { oaCharges: { ...nc.oaCharges, transmissionRsPerKwhOffset: v } } })} />
          <NumberInput label="Operating charge" unit="₹/month" value={nc.oaCharges.operatingRsPerMonth} step={500} onChange={(v) => dispatch({ type: 'patchNew', patch: { oaCharges: { ...nc.oaCharges, operatingRsPerMonth: v } } })} />
          <NumberInput label="ToSE on OA units" unit="paise/kWh" value={nc.oaCharges.tosePaisePerKwhOffset} step={0.1} onChange={(v) => dispatch({ type: 'patchNew', patch: { oaCharges: { ...nc.oaCharges, tosePaisePerKwhOffset: v } } })} />
          <NumberInput label="In-kind losses" unit="%" value={typeof nc.oaCharges.inKindLossPct === 'number' ? nc.oaCharges.inKindLossPct : (nc.oaCharges.inKindLossPct?.value ?? 0)} step={0.5} onChange={(v) => dispatch({ type: 'patchNew', patch: { oaCharges: { ...nc.oaCharges, inKindLossPct: v } } })} />
          <NumberInput label="CSS (if group-captive test fails)" unit="₹/kWh" value={nc.oaCharges.cssRsPerKwh ?? 0} step={0.1} onChange={(v) => dispatch({ type: 'patchNew', patch: { oaCharges: { ...nc.oaCharges, cssRsPerKwh: v } } })} note="Sensitivity only - not declared applicable" />
          <NumberInput label="Additional surcharge" unit="₹/kWh" value={nc.oaCharges.additionalSurchargeRsPerKwh ?? 0} step={0.1} onChange={(v) => dispatch({ type: 'patchNew', patch: { oaCharges: { ...nc.oaCharges, additionalSurchargeRsPerKwh: v } } })} />
        </div>
        {nc.profile === 'custom' && (<div><label className="field"><span>Custom profile: 96 comma-separated relative weights (00:00 → 23:45)</span><input type="text" value={csv} onChange={(e) => setCsv(e.target.value)} onBlur={() => { const arr = csv.split(/[,\s]+/).map(Number).filter((x) => Number.isFinite(x)); if (arr.length === 96) dispatch({ type: 'patchNew', patch: { customProfile96: arr } }); }} /></label></div>)}
        {landedParts && <p className="note">Delivered landed cost = base PPA ₹{landedParts.ppa.toFixed(2)} + OA charges ₹{landedParts.oa.toFixed(2)} per useful kWh = <b>₹{(e2new?.landedSolarRsPerKwh ?? 0).toFixed(2)}/kWh</b>. Material sensitivity: billing on injection rather than offset would charge the customer for energy it does not absorb.</p>}
      </Section>

      <div className="grid two">
        <Section title="Size a customer to absorb the S1 surplus (inverse planning)" note="Requirement derived from the residual surplus profile — NOT a confirmed customer's demand.">
          {sizing ? (<>
            <div className="grid kpis"><Kpi label="Required daytime load" value={`${sizing.requiredDaytimeMw.toFixed(2)} MW`} sub={`average over ${sizing.daytimeHours}`} /><Kpi label="Annual surplus to absorb" value={fmtKwh(sizing.annualKwh)} sub="expired + unallocated export in S1" /></div>
            <LineChart x={sizing.hourlyAvgKw.map((_, h) => h)} xFormat={(h) => `${String(h).padStart(2, '0')}:00`} format={(v) => `${fmtNum(v / 1000, 2)} MW`} area={['Surplus to absorb']} series={[{ name: 'Surplus to absorb', values: sizing.hourlyAvgKw, color: COLORS.expired }]} height={200} />
            <div className="btn-row"><button className="btn" onClick={() => dispatch({ type: 'patchNew', patch: { profile: 'dayShift', avgLoadMw: Math.round(sizing.requiredDaytimeMw * 0.7 * 4) / 4, allocationMwp: Math.min(cap - existingAlloc, Math.round(((s1?.bridge.unallocatedResidual ?? 0) + (s1?.bridge.expired ?? 0)) / ((s1?.plant.exportKwh ?? 1) / cap) * 4) / 4) } })}>Use as starting point</button></div>
          </>) : <p className="muted">…</p>}
        </Section>
        <Section title={`New consumer — ${detail?.date ?? ''} (kW)`} note="Synthetic profile vs its allocated solar.">
          {newDay ? <LineChart x={detail!.hours} xFormat={(h) => `${String(Math.floor(h)).padStart(2, '0')}:00`} format={(v) => `${fmtNum(v / 1000, 1)} MW`} area={['Allocated solar']} series={[{ name: 'Load', values: newDay.load, color: COLORS.new }, { name: 'Allocated solar', values: newDay.solar, color: COLORS.solar }, { name: 'Used directly', values: newDay.direct, color: COLORS.direct }]} height={200} /> : <p className="muted">enable an allocation to see the new consumer's day.</p>}
        </Section>
      </div>

      <Section title="Trade-off: existing savings vs SPV revenue" note="The new customer is used to absorb residual value after protecting existing allocations. Cutting an existing allocation to sell more at ₹2.50 is shown here explicitly, never hidden in the optimiser.">
        <Table dense columns={[{ key: 'k', label: '' }, { key: 's1', label: 'S1', align: 'right' }, { key: 's2', label: 'S2', align: 'right' }, { key: 'd', label: 'Δ', align: 'right' }]} rows={[
          { k: 'Existing consumers saving (C)', s1: fmtInr(existingS1), s2: fmtInr(existingS2), d: fmtInr(existingS2 - existingS1) },
          { k: 'SPV revenue — existing (₹4 internal)', s1: fmtInr(s1?.spv.revenueExistingRs ?? 0), s2: fmtInr(s2?.spv.revenueExistingRs ?? 0), d: fmtInr((s2?.spv.revenueExistingRs ?? 0) - (s1?.spv.revenueExistingRs ?? 0)) },
          { k: 'SPV revenue — new customer (external)', s1: '—', s2: fmtInr(s2?.spv.revenueNewRs ?? 0), d: fmtInr(s2?.spv.revenueNewRs ?? 0) },
          { k: 'Consolidated owner NPV', s1: fmtInr(s1?.finance.consolidatedOwner.npvRs ?? 0), s2: fmtInr(s2?.finance.consolidatedOwner.npvRs ?? 0), d: fmtInr((s2?.finance.consolidatedOwner.npvRs ?? 0) - (s1?.finance.consolidatedOwner.npvRs ?? 0)) },
          { k: 'Expired + unallocated export', s1: fmtKwh((s1?.bridge.expired ?? 0) + (s1?.bridge.unallocatedResidual ?? 0)), s2: fmtKwh((s2?.bridge.expired ?? 0) + (s2?.bridge.unallocatedResidual ?? 0)), d: fmtPct(((s2?.bridge.expired ?? 0) + (s2?.bridge.unallocatedResidual ?? 0)) / Math.max(1, (s1?.bridge.expired ?? 0) + (s1?.bridge.unallocatedResidual ?? 0)) - 1) },
        ]} />
      </Section>
    </>
  );
}
