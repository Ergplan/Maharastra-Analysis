import React, { useMemo, useState } from 'react';
import { useStore, seed, site } from '../state/store.tsx';
import { Kpi, Badge, Section, Table, Details, NumberInput, Toggle, Select } from '../components/charts.tsx';
import { TodStepChart, TodTimelineChart, DAY_COLORS } from '../components/TodDayChart.tsx';
import { runDayView, type DayViewResult } from '../engine/dayview.ts';
import { fmtInr, fmtKwh, fmtNum, monthLabel } from '../lib/format.ts';
import chettinadJson from '../data/seed/chettinad_profile.json';

interface ChettinadProfile { name: string; annualKwh: number; monthlyKwh: Record<string, number>; annualAvgDayKw: number[]; monthlyAvgDayKw: Record<string, number[]>; nRows: number; source: { file: string; sheet: string; unitAssumption: string } }
const chettinad = chettinadJson as unknown as ChettinadProfile;

const mwh = (kwh: number) => fmtKwh(kwh, 1);

export default function DayViewTab() {
  const { state } = useStore();
  const [period, setPeriod] = useState<'annual' | string>('annual');
  const [chart, setChart] = useState<'tod' | 'timeline'>('tod');
  const [lossPct, setLossPct] = useState(0);
  const [addNew, setAddNew] = useState(false);
  const [newScale, setNewScale] = useState(100);
  const [newTariff, setNewTariff] = useState(2.5);
  const [newAvoided, setNewAvoided] = useState(8.44);
  const [ppa, setPpa] = useState(4.0);
  const [eligible, setEligible] = useState<Record<string, boolean>>(() => Object.fromEntries(state.consumers.map((c) => [c.id, true])));

  const newDayKw = useMemo(() => {
    const src = period === 'annual' ? chettinad.annualAvgDayKw : (chettinad.monthlyAvgDayKw[period.slice(5)] ?? chettinad.annualAvgDayKw);
    return src.map((v) => (v * newScale) / 100);
  }, [period, newScale]);

  const run = (withNew: boolean): DayViewResult => runDayView({
    plant: state.plant, consumers: state.consumers, rules: state.rules, months: seed.calendar.months, site, period, mode: state.mode, networkLossPct: lossPct,
    eligibleIds: state.consumers.filter((c) => eligible[c.id]).map((c) => c.id),
    newConsumer: withNew ? { enabled: true, name: chettinad.name, dayKw: newDayKw, tariffRsPerKwh: newTariff, avoidedRsPerKwh: newAvoided } : null, existingPpaRsPerKwh: ppa,
  });
  const base = useMemo(() => run(false), [state.plant, state.consumers, state.rules, state.mode, period, lossPct, eligible, ppa]); // eslint-disable-line react-hooks/exhaustive-deps
  const withNew = useMemo(() => (addNew ? run(true) : null), [addNew, base, newDayKw, newTariff, newAvoided]); // eslint-disable-line react-hooks/exhaustive-deps
  const r = withNew ?? base;
  const t = r.totals, m = r.money;

  const bandRows = r.bands.map((b) => ({ zone: `${b.id} · ${b.label} h`, hours: b.hours, load: b.loadKwh, solar: b.solarKwh, direct: b.solarDirectKwh, credit: b.blockCreditKwh, grid: b.gridKwh, surplus: b.surplusAfterGroupKwh, newUsed: b.newUsedKwh + b.newBlockCreditKwh, expired: b.expiredKwh, loss: b.lossKwh }));
  bandRows.push({ zone: 'Day total', hours: 24, load: t.loadKwh, solar: t.solarKwh, direct: t.directKwh, credit: t.blockCreditKwh, grid: t.gridKwh, surplus: t.surplusAfterGroupKwh, newUsed: t.newUsedKwh + t.newBlockCreditKwh, expired: t.expiredKwh, loss: t.lossKwh });
  const kwhCol = (key: string, label: string) => ({ key, label, align: 'right' as const, render: (v: unknown) => mwh(v as number) });

  const consumerRows = state.consumers.map((c) => {
    const day = r.perConsumerLoadKw[c.id] ?? []; const kwh = day.reduce((a, v) => a + v * 0.25, 0); const peak = Math.max(0, ...day);
    return { name: c.name, kind: c.kind === 'factory' ? 'Factory · HT-I(A) 33 kV' : 'Store · LT-II(C)', kwh, peak, eligible: !!eligible[c.id], id: c.id };
  });

  const gain = withNew ? { useful: withNew.totals.usefulKwh - base.totals.usefulKwh, expired: base.totals.expiredKwh - withNew.totals.expiredKwh, spv: withNew.money.spvNewRs, newSaving: withNew.money.newNetSavingRs } : null;
  const periodOptions = [{ value: 'annual', label: 'Annual average day' }, ...seed.calendar.months.map((mo) => ({ value: mo, label: `${monthLabel(mo)} average day${seed.calendar.estimatedMonths.includes(mo) ? ' (est.)' : ''}` }))];

  return (
    <>
      <p className="note">One representative day for the whole 7.5 MWp plant. <b>All factories and stores are treated as eligible</b> and solar is pooled across them; what the group cannot use is surplus. Settlement follows the header toggle (<b>{state.mode === 'tod_block' ? 'ToD block' : '15-minute'}</b>). Intraday shapes are reconstructions <Badge tone="warn">estimated</Badge>; daily energy and ToD totals come from the generation sheets and bills.</p>

      <div className="fields">
        <Select label="Representative day" value={period} options={periodOptions} onChange={setPeriod} />
        <NumberInput label="Network losses in kind" value={lossPct} onChange={setLossPct} step={0.5} min={0} max={15} unit="% of injection" note="Bills imply a 3–6% gap between injection and credited units; MSEDCL also bills losses in ₹ — set 0 to avoid double counting." />
        <NumberInput label="Existing PPA tariff" value={ppa} onChange={setPpa} step={0.1} min={0} unit="₹/kWh" />
        <Toggle label={`Add new consumer: ${chettinad.name}`} checked={addNew} onChange={setAddNew} />
        {addNew && <NumberInput label="Chettinad load scale" value={newScale} onChange={setNewScale} step={10} min={10} max={300} unit="% of profile" note="100% = the 15-min profile as supplied (14.0 GWh/yr, 1.3–2.05 MW)" />}
        {addNew && <NumberInput label="New consumer tariff" value={newTariff} onChange={setNewTariff} step={0.1} min={0} unit="₹/kWh" />}
        {addNew && <NumberInput label="Its avoided grid rate" value={newAvoided} onChange={setNewAvoided} step={0.1} min={0} unit="₹/kWh" note="Illustrative — Chettinad's tariff category is not confirmed" />}
      </div>

      <div className="grid kpis">
        <Kpi label="Plant export (day)" value={mwh(t.solarKwh)} sub={`${r.daysAveraged}-day average · peak ${(Math.max(...r.solarKw) / 1000).toFixed(2)} MW`} />
        <Kpi label="Group demand (day)" value={mwh(t.loadKwh)} sub={`${consumerRows.filter((c) => c.eligible).length} consumers · peak ${(Math.max(...r.loadKw) / 1000).toFixed(2)} MW`} />
        <Kpi label="Solar used by group" value={mwh(t.directKwh + t.blockCreditKwh)} sub={`${t.groupSolarSharePct.toFixed(0)}% of group demand · ${((t.directKwh + t.blockCreditKwh) / Math.max(1, t.solarKwh) * 100).toFixed(0)}% of export`} tone="good" />
        <Kpi label="Grid supply to group" value={mwh(t.gridKwh)} sub={state.mode === 'tod_block' ? `physical ${mwh(t.gridPhysicalKwh)} before in-band credit` : 'physical = billed under 15-min'} />
        {withNew && <Kpi label={`Surplus sold to ${chettinad.name.split(' ')[0]}`} value={mwh(t.newUsedKwh + t.newBlockCreditKwh)} sub={`of its ${mwh(t.newLoadKwh)} demand · @ ₹${newTariff.toFixed(2)}`} tone="good" />}
        <Kpi label="Surplus lapsing (loss)" value={mwh(t.expiredKwh)} sub={`${(t.expiredKwh / Math.max(1, t.solarKwh) * 100).toFixed(0)}% of export · worth ${fmtInr(m.expiredValueAtNewTariffRs)}/day at ₹${newTariff.toFixed(2)}`} tone={t.expiredKwh > 0.2 * t.solarKwh ? 'bad' : 'warn'} />
        {lossPct > 0 && <Kpi label="Network losses in kind" value={mwh(t.lossKwh)} sub={`${lossPct}% of injection · ${fmtInr(m.lossValueAtPpaRs)}/day at PPA`} tone="warn" />}
        <Kpi label="Useful solar" value={`${t.utilisationPct.toFixed(0)}%`} sub={`${mwh(t.usefulKwh)} of ${mwh(t.solarKwh)} export`} tone={t.utilisationPct > 70 ? 'good' : 'warn'} />
      </div>

      <Section title={chart === 'tod' ? `Energy supply by ToD zone — ${period === 'annual' ? 'annual average day' : monthLabel(period) + ' average day'}` : `15-minute timeline — ${period === 'annual' ? 'annual average day' : monthLabel(period) + ' average day'}`}
        right={<div className="seg"><button className={chart === 'tod' ? 'active' : ''} onClick={() => setChart('tod')}>ToD</button><button className={chart === 'timeline' ? 'active' : ''} onClick={() => setChart('timeline')}>Timeline</button></div>}
        note="Bar height = average kW in the zone; the dashed line is total group demand. Below the line: how the demand is met (solar directly, solar credited within the band, grid). Above the line: solar surplus — sold to the new consumer (purple) or lapsing (hatched).">
        {chart === 'tod' ? <TodStepChart r={r} showNew={!!withNew} /> : <TodTimelineChart r={r} showNew={!!withNew} />}
      </Section>

      {withNew && gain && (
        <Section title={`Gain from adding ${chettinad.name}`} note="Same day, same solar, same existing group. Chettinad only takes what is left after the existing consumers; their supply and savings are unchanged.">
          <div className="grid kpis">
            <Kpi label="Extra solar used" value={mwh(gain.useful)} sub={`per day · ${fmtKwh(gain.useful * r.annualised.factor, 2)} per year`} tone="good" />
            <Kpi label="Lapsing surplus cut" value={`${mwh(base.totals.expiredKwh)} → ${mwh(withNew.totals.expiredKwh)}`} sub={`−${(gain.expired / Math.max(1, base.totals.expiredKwh) * 100).toFixed(0)}%`} tone="good" />
            <Kpi label="SPV revenue from Chettinad" value={fmtInr(gain.spv * r.annualised.factor)} sub={`per year · ${fmtInr(gain.spv)}/day at ₹${newTariff.toFixed(2)}`} tone="good" />
            <Kpi label="Chettinad's own saving" value={fmtInr(gain.newSaving * r.annualised.factor)} sub={`per year vs ₹${newAvoided.toFixed(2)} grid (illustrative)`} />
            <Kpi label="Useful solar" value={`${base.totals.utilisationPct.toFixed(0)}% → ${withNew.totals.utilisationPct.toFixed(0)}%`} sub="share of plant export that earns something" tone="good" />
            <Kpi label="Still lapsing" value={fmtInr(withNew.money.expiredValueAtNewTariffRs * r.annualised.factor)} sub={`per year at ₹${newTariff.toFixed(2)} · ${fmtKwh(withNew.annualised.expiredKwh, 2)}`} tone="warn" />
          </div>
          <p className="note">Chettinad's profile (Maharashtra 15-min sheet) is night-heavy: ~2.05 MW 00–06 h, 1.9 MW 06–09 h, but only ~1.4 MW in the 09–17 h solar window and 1.3 MW in the evening. That daytime 1.4 MW is what absorbs surplus; scaling the profile up (or finding a day-shift load) absorbs more.</p>
        </Section>
      )}

      <Section title="Where the day's solar goes" note="Energy balance for the representative day. Lapsing surplus is the settlement loss; network losses are physical.">
        <Table dense columns={[{ key: 'item', label: 'Item' }, { key: 'kwh', label: 'kWh/day', align: 'right', render: (v) => mwh(v as number) }, { key: 'pct', label: '% of export', align: 'right', render: (v) => `${(v as number).toFixed(1)}%` }, { key: 'rs', label: '₹/day', align: 'right', render: (v) => (v === null ? '—' : fmtInr(v as number)) }, { key: 'note', label: '' }]}
          rows={[
            { item: 'Plant export (ABT meter)', kwh: t.solarKwh, pct: 100, rs: null, note: 'reported daily export, averaged' },
            { item: 'Network losses in kind', kwh: -t.lossKwh, pct: -t.lossKwh / t.solarKwh * 100, rs: -m.lossValueAtPpaRs, note: lossPct ? `${lossPct}% assumption` : 'set to 0 (MSEDCL bills losses in ₹ separately)' },
            { item: 'Used directly by existing group (15-min coincident)', kwh: t.directKwh, pct: t.directKwh / t.solarKwh * 100, rs: t.directKwh * ppa, note: 'SPV revenue at PPA' },
            { item: 'Credited to existing group within the same ToD band', kwh: t.blockCreditKwh, pct: t.blockCreditKwh / t.solarKwh * 100, rs: t.blockCreditKwh * ppa, note: state.mode === 'tod_block' ? 'block settlement only' : 'not available under 15-min' },
            ...(withNew ? [{ item: `Sold to ${chettinad.name}`, kwh: t.newUsedKwh + t.newBlockCreditKwh, pct: (t.newUsedKwh + t.newBlockCreditKwh) / t.solarKwh * 100, rs: m.spvNewRs, note: `at ₹${newTariff.toFixed(2)}` }] : []),
            { item: 'Surplus lapsing (no credit, no payment)', kwh: t.expiredKwh, pct: t.expiredKwh / t.solarKwh * 100, rs: -m.expiredValueAtNewTariffRs, note: `foregone at ₹${newTariff.toFixed(2)} (what a new buyer would pay)` },
            { item: 'Existing group: avoided grid energy charges', kwh: t.directKwh + t.blockCreditKwh, pct: 0, rs: m.existingAvoidedRs, note: 'approx. load-weighted EC + ToD + FAC' },
            { item: 'Existing group: net saving after PPA', kwh: 0, pct: 0, rs: m.existingNetSavingRs, note: `${fmtInr(r.annualised.existingNetSavingRs)}/yr` },
          ]} />
      </Section>

      <Section title="By ToD zone" note="MSEDCL FY27 zones: A 00–06 (no surcharge), B 06–09, C 09–17 (solar-hour rebate), D 17–24 (evening surcharge). Columns are kWh for the representative day.">
        <Table dense columns={[{ key: 'zone', label: 'Zone' }, { key: 'hours', label: 'h', align: 'right' }, kwhCol('load', 'Group load'), kwhCol('solar', 'Solar export'), kwhCol('direct', 'Solar direct'), kwhCol('credit', 'In-band credit'), kwhCol('grid', 'Grid'), kwhCol('surplus', 'Surplus after group'), ...(withNew ? [kwhCol('newUsed', 'To Chettinad')] : []), kwhCol('expired', 'Lapsing'), ...(lossPct ? [kwhCol('loss', 'Losses')] : [])]} rows={bandRows} />
      </Section>

      <Section title="Consumers on this day" note="Tick/untick to change who is eligible to take captive solar. Loads are bill-calibrated averages; the factory's is total site drawal (grid + open access), rooftop excluded.">
        <Table dense columns={[
          { key: 'eligible', label: 'Eligible', render: (v, row) => <input type="checkbox" checked={!!v} onChange={(e) => setEligible({ ...eligible, [row.id as string]: e.target.checked })} /> },
          { key: 'name', label: 'Consumer' }, { key: 'kind', label: 'Type' },
          { key: 'kwh', label: 'kWh/day', align: 'right', render: (v) => mwh(v as number) }, { key: 'peak', label: 'Peak kW (avg block)', align: 'right', render: (v) => fmtNum(v as number) },
        ]} rows={consumerRows} />
        {withNew && <p className="note" style={{ marginTop: 8 }}>+ {chettinad.name}: {mwh(t.newLoadKwh)}/day · {chettinad.nRows.toLocaleString()} rows from <code>{chettinad.source.sheet}</code> · {chettinad.source.unitAssumption}.</p>}
      </Section>

      <Details summary="How this day is built, and what is approximate">
        <ul>{r.notes.map((n, i) => <li key={i}>{n}</li>)}
          <li>Pooling: the group is treated as one buyer. In practice each consumer needs its own OA permission and allocation; the pooled result is the upper bound a well-designed allocation can reach on this day.</li>
          <li>Colours: <span style={{ color: DAY_COLORS.solar }}>■</span> solar, <span style={{ color: DAY_COLORS.grid }}>■</span> grid, <span style={{ color: DAY_COLORS.newUsed }}>■</span> new consumer, hatched = lapsing surplus.</li>
        </ul>
      </Details>
    </>
  );
}
