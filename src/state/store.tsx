import React, { createContext, useContext, useEffect, useMemo, useReducer, useRef } from 'react';
import type { BessInput, Consumer, FinanceAssumptions, NewCustomerInput, PlantInput, RulePack, ScenarioInput, SettlementMode } from '../engine/types.ts';
import { baseInput, defaultBess, defaultFinance, defaultNewCustomer, defaultPlant, currentAllocations, type SeedCase } from '../engine/seed.ts';
import type { ScenarioSummary } from '../engine/summary.ts';
import { EngineClient } from '../lib/workerClient.ts';
import seedJson from '../data/seed/seed_case.json';

export const seed = seedJson as unknown as SeedCase;
export const site = { latitude: seed.plant.latitude, longitude: seed.plant.longitude };

export type ScenarioId = 'S0' | 'S1' | 'S2' | 'S3';
export const SCENARIOS: { id: ScenarioId; label: string; desc: string }[] = [
  { id: 'S0', label: 'S0 Current', desc: 'Current allocation, no new customer, no BESS' },
  { id: 'S1', label: 'S1 Optimised existing', desc: 'Re-allocated to eligible existing consumers, no BESS' },
  { id: 'S2', label: 'S2 + 132 kV customer', desc: 'S1 plus new group-captive consumer at ₹2.50/kWh' },
  { id: 'S3', label: 'S3 + optional BESS', desc: 'S2 plus battery (zero-BESS is a valid choice)' },
];

export interface AppState {
  mode: SettlementMode;
  view: 'observed' | 'annualised';
  selectedMonth: string;
  selectedDay: number;           // index into calendar days
  consumers: Consumer[];
  rules: RulePack;
  plant: PlantInput;
  finance: FinanceAssumptions;
  allocS1: Record<string, number>;
  newCustomer: NewCustomerInput;
  bess: BessInput;
  loadTrend: 'flat' | 'seasonal';
  loadShift: { consumerId: string; kwhPerDayToDaytime: number } | null;
  results: Record<string, ScenarioSummary>;
  status: { running: boolean; approx: boolean; ms: number; error?: string; version: number };
  inputVersion: number;
  activeTab: number;
}

export type Action =
  | { type: 'set'; patch: Partial<AppState> }
  | { type: 'setAlloc'; id: string; mwp: number }
  | { type: 'setAllocs'; allocs: Record<string, number> }
  | { type: 'patchNew'; patch: Partial<NewCustomerInput> }
  | { type: 'patchBess'; patch: Partial<BessInput> }
  | { type: 'patchFinance'; patch: Partial<FinanceAssumptions> }
  | { type: 'patchPlant'; patch: Partial<PlantInput> }
  | { type: 'patchRules'; patch: Partial<RulePack> }
  | { type: 'patchConsumer'; id: string; patch: Partial<Consumer> }
  | { type: 'results'; results: Record<string, ScenarioSummary>; approx: boolean; ms: number; version: number }
  | { type: 'running'; version: number }
  | { type: 'error'; message: string }
  | { type: 'reset' }
  | { type: 'load'; state: Partial<AppState> };

const INPUT_KEYS: (keyof AppState)[] = ['mode', 'consumers', 'rules', 'plant', 'finance', 'allocS1', 'newCustomer', 'bess', 'loadTrend', 'loadShift'];

export function initialState(): AppState {
  return {
    mode: 'tod_block', view: 'annualised', selectedMonth: seed.calendar.months[7], selectedDay: 230,
    consumers: seed.consumers, rules: seed.rulePack, plant: defaultPlant(seed), finance: defaultFinance(seed),
    allocS1: currentAllocations(seed), newCustomer: defaultNewCustomer(seed, true), bess: defaultBess(seed, false),
    loadTrend: 'flat', loadShift: null, results: {}, status: { running: false, approx: true, ms: 0, version: 0 }, inputVersion: 0, activeTab: 0,
  };
}

function reducer(s: AppState, a: Action): AppState {
  const bump = (n: AppState): AppState => ({ ...n, inputVersion: s.inputVersion + 1 });
  switch (a.type) {
    case 'set': { const touches = Object.keys(a.patch).some((k) => INPUT_KEYS.includes(k as keyof AppState)); const n = { ...s, ...a.patch }; return touches ? bump(n) : n; }
    case 'setAlloc': return bump({ ...s, allocS1: { ...s.allocS1, [a.id]: a.mwp } });
    case 'setAllocs': return bump({ ...s, allocS1: { ...s.allocS1, ...a.allocs } });
    case 'patchNew': return bump({ ...s, newCustomer: { ...s.newCustomer, ...a.patch } });
    case 'patchBess': return bump({ ...s, bess: { ...s.bess, ...a.patch } });
    case 'patchFinance': return bump({ ...s, finance: { ...s.finance, ...a.patch } });
    case 'patchPlant': return bump({ ...s, plant: { ...s.plant, ...a.patch } });
    case 'patchRules': return bump({ ...s, rules: { ...s.rules, ...a.patch } });
    case 'patchConsumer': return bump({ ...s, consumers: s.consumers.map((c) => (c.id === a.id ? { ...c, ...a.patch } : c)) });
    case 'results': return a.version < s.status.version && !a.approx ? s : { ...s, results: { ...s.results, ...a.results }, status: { running: false, approx: a.approx, ms: a.ms, version: a.version } };
    case 'running': return { ...s, status: { ...s.status, running: true, version: a.version, error: undefined } };
    case 'error': return { ...s, status: { ...s.status, running: false, error: a.message } };
    case 'reset': return { ...initialState(), activeTab: s.activeTab, inputVersion: s.inputVersion + 1 };
    case 'load': return bump({ ...s, ...a.state, results: {}, inputVersion: s.inputVersion + 1 });
    default: return s;
  }
}

/** Build the four scenario inputs for a settlement mode from the current state. */
export function buildInputs(s: AppState, mode: SettlementMode): { key: string; input: ScenarioInput }[] {
  const base: ScenarioInput = { ...baseInput(seed, mode), consumers: s.consumers, rules: s.rules, plant: s.plant, finance: s.finance, loadTrend: s.loadTrend, loadShift: null, newCustomer: { ...s.newCustomer, enabled: false }, bess: { ...s.bess, enabled: false } };
  const s0: ScenarioInput = { ...base, id: 'S0', label: 'S0 Current allocation', allocationsMwp: currentAllocations(seed) };
  const s1: ScenarioInput = { ...base, id: 'S1', label: 'S1 Optimised existing', allocationsMwp: { ...s.allocS1 }, loadShift: s.loadShift };
  const s2: ScenarioInput = { ...s1, id: 'S2', label: 'S2 + new 132 kV customer', allocationsMwp: { ...s.allocS1, NEW132: s.newCustomer.allocationMwp }, newCustomer: { ...s.newCustomer, enabled: true } };
  const s3: ScenarioInput = { ...s2, id: 'S3', label: 'S3 + optional BESS', bess: { ...s.bess } };
  return [s0, s1, s2, s3].map((input) => ({ key: `${input.id}-${mode}`, input }));
}

export function scenarioInput(s: AppState, id: ScenarioId, mode: SettlementMode): ScenarioInput {
  return buildInputs(s, mode).find((x) => x.input.id === id)!.input;
}

const Ctx = createContext<{ state: AppState; dispatch: React.Dispatch<Action>; client: EngineClient } | null>(null);

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, initialState);
  const client = useMemo(() => new EngineClient(), []);
  const stateRef = useRef(state); stateRef.current = state;

  // Recompute: fast approximate pass for both settlement modes, then an exact pass for the selected mode.
  useEffect(() => {
    const version = state.inputVersion;
    let cancelled = false;
    dispatch({ type: 'running', version });
    const t = setTimeout(async () => {
      try {
        const s = stateRef.current;
        const inputs = [...buildInputs(s, 'tod_block'), ...buildInputs(s, 'interval_15min')];
        const approx = await client.request<{ type: 'result'; summaries: ScenarioSummary[]; ms: number }>({ type: 'run', inputs, site, approx: true });
        if (cancelled || stateRef.current.inputVersion !== version) return;
        dispatch({ type: 'results', results: Object.fromEntries(approx.summaries.map((x) => [x.key, x])), approx: true, ms: approx.ms, version });
        const exact = await client.request<{ type: 'result'; summaries: ScenarioSummary[]; ms: number }>({ type: 'run', inputs: buildInputs(s, s.mode), site, approx: false });
        if (cancelled || stateRef.current.inputVersion !== version) return;
        dispatch({ type: 'results', results: Object.fromEntries(exact.summaries.map((x) => [x.key, x])), approx: false, ms: exact.ms, version });
      } catch (e) { if (!cancelled) dispatch({ type: 'error', message: (e as Error).message }); }
    }, 150);
    return () => { cancelled = true; clearTimeout(t); };
  }, [state.inputVersion, client]);

  return <Ctx.Provider value={{ state, dispatch, client }}>{children}</Ctx.Provider>;
}

export function useStore() { const c = useContext(Ctx); if (!c) throw new Error('store'); return c; }
export function useResult(id: ScenarioId, mode?: SettlementMode): ScenarioSummary | undefined { const { state } = useStore(); return state.results[`${id}-${mode ?? state.mode}`]; }
