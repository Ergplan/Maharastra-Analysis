/// <reference lib="webworker" />
import { runScenario, type SiteMeta } from '../engine/scenario.ts';
import { findBestAllocation, bessGrid, sizeCustomerToAbsorb, type AllocationSearchSpec, type Objective } from '../engine/optimise.ts';
import { summarise, dayDetail, type ScenarioSummary } from '../engine/summary.ts';
import { buildCalendar } from '../engine/calendar.ts';
import { buildSolar } from '../engine/solar.ts';
import type { ScenarioInput, ScenarioResult } from '../engine/types.ts';

export type WorkerRequest =
  | { type: 'run'; reqId: number; inputs: { key: string; input: ScenarioInput }[]; site: SiteMeta; approx: boolean }
  | { type: 'day'; reqId: number; key: string; day: number }
  | { type: 'optimise'; reqId: number; input: ScenarioInput; site: SiteMeta; spec: AllocationSearchSpec[]; objective: Objective; baseline?: Record<string, number> }
  | { type: 'bessGrid'; reqId: number; input: ScenarioInput; site: SiteMeta; mwList: number[]; mwhList: number[] }
  | { type: 'sizeCustomer'; reqId: number; key: string };

export type WorkerResponse =
  | { type: 'result'; reqId: number; summaries: ScenarioSummary[]; ms: number }
  | { type: 'day'; reqId: number; detail: ReturnType<typeof dayDetail> | null }
  | { type: 'progress'; reqId: number; done: number; total: number }
  | { type: 'optimise'; reqId: number; allocations: Record<string, number>; value: number; evaluated: number; method: string; passes: number; protectedBaseline: boolean; summary: ScenarioSummary }
  | { type: 'bessGrid'; reqId: number; grid: ReturnType<typeof bessGrid> }
  | { type: 'sizeCustomer'; reqId: number; sizing: ReturnType<typeof sizeCustomerToAbsorb> | null }
  | { type: 'error'; reqId: number; message: string };

const results = new Map<string, { r: ScenarioResult; plantExport: Float64Array; dates: string[] }>();

function fullRun(key: string, input: ScenarioInput, site: SiteMeta, approx: boolean): ScenarioSummary {
  const r = runScenario({ ...input, financeMethod: approx ? 'scaled' : 'recompute' }, site);
  const cal = buildCalendar(input.months, input.rules.todBands);
  const solar = buildSolar(input.plant, cal, site.latitude, site.longitude);
  results.set(key, { r, plantExport: solar.kwh, dates: cal.dayDates });
  return summarise(r, key, approx, cal.dayDates, Array.from(solar.dailyKwh));
}

self.onmessage = (ev: MessageEvent<WorkerRequest>) => {
  const msg = ev.data;
  const post = (m: WorkerResponse) => (self as unknown as Worker).postMessage(m);
  try {
    if (msg.type === 'run') {
      const t0 = performance.now();
      const summaries = msg.inputs.map(({ key, input }) => fullRun(key, input, msg.site, msg.approx));
      post({ type: 'result', reqId: msg.reqId, summaries, ms: performance.now() - t0 });
    } else if (msg.type === 'day') {
      const e = results.get(msg.key);
      post({ type: 'day', reqId: msg.reqId, detail: e ? dayDetail(e.r, e.plantExport, msg.day, e.dates[msg.day]) : null });
    } else if (msg.type === 'optimise') {
      const best = findBestAllocation(msg.input, msg.site, msg.spec, msg.objective, msg.baseline, (done, total) => post({ type: 'progress', reqId: msg.reqId, done, total }));
      const cal = buildCalendar(msg.input.months, msg.input.rules.todBands);
      const solar = buildSolar(msg.input.plant, cal, msg.site.latitude, msg.site.longitude);
      const summary = summarise(best.result, 'opt', false, cal.dayDates, Array.from(solar.dailyKwh));
      post({ type: 'optimise', reqId: msg.reqId, allocations: best.allocations, value: best.value, evaluated: best.evaluated, method: best.method, passes: best.passes, protectedBaseline: best.protectedBaseline, summary });
    } else if (msg.type === 'bessGrid') {
      const grid = bessGrid(msg.input, msg.site, msg.mwList, msg.mwhList, (done, total) => post({ type: 'progress', reqId: msg.reqId, done, total }));
      post({ type: 'bessGrid', reqId: msg.reqId, grid });
    } else if (msg.type === 'sizeCustomer') {
      const e = results.get(msg.key);
      if (!e) { post({ type: 'sizeCustomer', reqId: msg.reqId, sizing: null }); return; }
      // residual = unallocated plant export + expired surplus of all consumers, per interval
      const n = e.plantExport.length; const residual = new Float64Array(n);
      const usedShare = e.r.plant.dcMwp > 0 ? e.r.plant.allocatedMwp / e.r.plant.dcMwp : 0;
      for (let t = 0; t < n; t++) { let s = e.plantExport[t] * (1 - usedShare); for (const c of e.r.consumers) s += Math.max(0, c.solarDelivered[t] - c.physicalDirect[t]) - c.bankWithdrawn[t] * 0; residual[t] = s; }
      post({ type: 'sizeCustomer', reqId: msg.reqId, sizing: sizeCustomerToAbsorb(e.r, residual) });
    }
  } catch (err) {
    post({ type: 'error', reqId: msg.reqId, message: (err as Error).message });
  }
};
