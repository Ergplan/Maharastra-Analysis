import React from 'react';
import { StoreProvider, useStore, seed } from './state/store.tsx';
import { Badge } from './components/charts.tsx';
import OnePageTab from './tabs/OnePage.tsx';
import DayViewTab from './tabs/DayView.tsx';
import YearSizingTab from './tabs/YearSizing.tsx';
import CurrentTab from './tabs/Current.tsx';
import OptimiseTab from './tabs/Optimise.tsx';
import NewCustomerTab from './tabs/NewCustomer.tsx';
import BessTab from './tabs/Bess.tsx';
import ReturnsTab from './tabs/Returns.tsx';
import DataTab from './tabs/Data.tsx';
import { monthLabel } from './lib/format.ts';

const TABS = ['One page', 'Day view (simple)', 'Year & sizing', '1 · Current situation', '2 · Optimise existing users', '3 · Add 132 kV customer', '4 · Optional BESS', '5 · Returns & comparison', '6 · Data, assumptions & rules'];

function Shell() {
  const { state, dispatch } = useStore();
  const st = state.status;
  return (
    <>
      <header className="app-header">
        <div className="brand">
          <strong>Captive Solar Optimisation Studio</strong>
          <small>{seed.plant.name} · {seed.plant.dcMwp} MWp DC · jouleWise energy planning · seeded case built {seed.builtOn}</small>
        </div>
        <div className="controls">
          <label>Settlement
            <select value={state.mode} onChange={(e) => dispatch({ type: 'set', patch: { mode: e.target.value as 'tod_block' | 'interval_15min' } })}>
              <option value="tod_block">ToD block settlement</option>
              <option value="interval_15min">15-minute settlement</option>
            </select>
          </label>
          <label>Rule pack<span style={{ fontSize: 12 }}>{state.rules.id} · w.e.f. {state.rules.effectiveFrom}</span></label>
          <label>View
            <select value={state.view} onChange={(e) => dispatch({ type: 'set', patch: { view: e.target.value as 'observed' | 'annualised' } })}>
              <option value="annualised">Annualised (12 months)</option>
              <option value="observed">Observed period (Nov-25 → Sep-26)</option>
            </select>
          </label>
          <label>Month
            <select value={state.selectedMonth} onChange={(e) => { const m = e.target.value; const idx = seed.calendar.months.indexOf(m); let day = 0; for (let i = 0; i < idx; i++) day += new Date(Date.UTC(+seed.calendar.months[i].slice(0, 4), +seed.calendar.months[i].slice(5, 7), 0)).getUTCDate(); dispatch({ type: 'set', patch: { selectedMonth: m, selectedDay: day + 14 } }); }}>
              {seed.calendar.months.map((m) => <option key={m} value={m}>{monthLabel(m)}{seed.calendar.estimatedMonths.includes(m) ? ' (est.)' : ''}</option>)}
            </select>
          </label>
          <button onClick={() => dispatch({ type: 'reset' })} title="Reset every input to the seeded baseline">Reset to baseline</button>
          <div className="status">
            {st.error ? <Badge tone="bad">error: {st.error}</Badge> : st.running ? <Badge tone="info">computing…</Badge> : <Badge tone={st.approx ? 'warn' : 'good'}>{st.approx ? 'preview (year 2+ scaled)' : 'exact'} · {Math.round(st.ms)} ms</Badge>}
            <div><Badge tone="warn" title="Rates read from FY27 bills; MERC/MSEDCL rules not independently verified">Bill-calibrated · regulatory verification pending</Badge></div>
          </div>
        </div>
      </header>
      <nav className="tabs">{TABS.map((t, i) => <button key={t} className={state.activeTab === i ? 'active' : ''} onClick={() => dispatch({ type: 'set', patch: { activeTab: i } })}>{t}</button>)}</nav>
      <main>
        {state.activeTab === 0 && <OnePageTab />}
        {state.activeTab === 1 && <DayViewTab />}
        {state.activeTab === 2 && <YearSizingTab />}
        {state.activeTab === 3 && <CurrentTab />}
        {state.activeTab === 4 && <OptimiseTab />}
        {state.activeTab === 5 && <NewCustomerTab />}
        {state.activeTab === 6 && <BessTab />}
        {state.activeTab === 7 && <ReturnsTab />}
        {state.activeTab === 8 && <DataTab />}
      </main>
    </>
  );
}

export default function App() { return <StoreProvider><Shell /></StoreProvider>; }
