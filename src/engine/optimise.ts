import type { ScenarioInput, ScenarioResult } from './types.ts';
import { runScenario, type SiteMeta } from './scenario.ts';
import { INTERVALS_PER_DAY } from './calendar.ts';

export type Objective = 'owner_npv' | 'spv_npv' | 'utilisation';

export function objectiveValue(r: ScenarioResult, obj: Objective): number {
  if (obj === 'owner_npv') return r.finance.consolidatedOwner.npvRs;
  if (obj === 'spv_npv') return r.finance.incremental.npvRs;
  return r.bridge.physicalDirect + r.bridge.bankWithdrawn + r.bridge.bessDelivered; // useful solar kWh
}

export interface AllocationSearchSpec { id: string; min: number; max: number; step: number }

export interface BestAllocation {
  allocations: Record<string, number>;
  value: number;
  evaluated: number;
  spec: AllocationSearchSpec[];
  passes: number;
  method: string;
  protectedBaseline: boolean;
  result: ScenarioResult;
}

/**
 * Bounded coordinate-descent grid search ("best evaluated scenario", not a proven global optimum).
 * Protects existing consumers' baseline savings when `baselineSavings` is given (a candidate that lowers any
 * existing consumer's broader variable saving below its baseline is rejected).
 */
export function findBestAllocation(base: ScenarioInput, site: SiteMeta, spec: AllocationSearchSpec[], objective: Objective, baselineSavings?: Record<string, number>, onProgress?: (done: number, total: number) => void): BestAllocation {
  const inp: ScenarioInput = { ...base, financeMethod: 'scaled' };
  let alloc = { ...base.allocationsMwp };
  for (const s of spec) alloc[s.id] = Math.min(s.max, Math.max(s.min, alloc[s.id] ?? s.min));
  const cap = base.plant.dcMwp;
  const feasible = (r: ScenarioResult) => {
    if (!baselineSavings) return true;
    return r.economics.every((e) => e.id === 'NEW132' || !(e.id in baselineSavings) || e.broaderVariableSavingRs >= baselineSavings[e.id] - 1);
  };
  let evaluated = 0;
  const total = spec.reduce((a, s) => a + Math.floor((s.max - s.min) / s.step) + 1, 0) * 3;
  const evalAt = (a: Record<string, number>) => { evaluated++; onProgress?.(Math.min(evaluated, total), total); return runScenario({ ...inp, allocationsMwp: a }, site); };
  let bestR = evalAt(alloc); let best = feasible(bestR) ? objectiveValue(bestR, objective) : -Infinity;
  let passes = 0;
  for (let pass = 0; pass < 3; pass++) {
    passes++; let improved = false;
    for (const s of spec) {
      for (let v = s.min; v <= s.max + 1e-9; v += s.step) {
        const cand = { ...alloc, [s.id]: Math.round(v * 1000) / 1000 };
        const sum = Object.values(cand).reduce((x, y) => x + y, 0);
        if (sum > cap + 1e-9) continue;
        if (Math.abs(cand[s.id] - alloc[s.id]) < 1e-9) continue;
        const r = evalAt(cand);
        if (!feasible(r)) continue;
        const val = objectiveValue(r, objective);
        if (val > best + 1e-6) { best = val; bestR = r; alloc = cand; improved = true; }
      }
    }
    if (!improved) break;
  }
  const finalR = runScenario({ ...base, allocationsMwp: alloc }, site);
  return { allocations: alloc, value: objectiveValue(finalR, objective), evaluated, spec, passes, method: `coordinate descent over a bounded grid (${spec.map((s) => `${s.id}: ${s.min}-${s.max} step ${s.step} MWp`).join('; ')}); ${passes} pass(es); year 2+ finance scaled by degradation during search, final re-run exact`, protectedBaseline: !!baselineSavings, result: finalR };
}

export interface BessGridPoint { powerMw: number; energyMwh: number; incrementalNpvRs: number; incrementalIrr: number | null; ownerNpvRs: number; usefulKwh: number; discharged: number; capexRs: number }

/** Transparent MW/MWh grid (includes zero). Economic default = best incremental owner NPV vs the no-BESS case. */
export function bessGrid(base: ScenarioInput, site: SiteMeta, mwList: number[], mwhList: number[], onProgress?: (done: number, total: number) => void): { points: BessGridPoint[]; bestEconomic: BessGridPoint; maxUtilisation: BessGridPoint; noBess: BessGridPoint; recommendation: string } {
  const inp: ScenarioInput = { ...base, financeMethod: 'scaled' };
  const noBessR = runScenario({ ...inp, bess: { ...inp.bess, enabled: false } }, site);
  const useful = (r: ScenarioResult) => r.bridge.physicalDirect + r.bridge.bankWithdrawn + r.bridge.bessDelivered;
  const noBess: BessGridPoint = { powerMw: 0, energyMwh: 0, incrementalNpvRs: 0, incrementalIrr: null, ownerNpvRs: noBessR.finance.consolidatedOwner.npvRs, usefulKwh: useful(noBessR), discharged: 0, capexRs: 0 };
  const points: BessGridPoint[] = [noBess];
  let done = 0; const total = mwList.length * mwhList.length;
  for (const mw of mwList) for (const mwh of mwhList) {
    if (mw <= 0 || mwh <= 0) continue;
    const r = runScenario({ ...inp, bess: { ...inp.bess, enabled: true, powerMw: mw, energyMwh: mwh } }, site);
    // incremental owner cash flow vs no-BESS, same horizon: difference of consolidated-owner NPVs (capex included in that NPV)
    points.push({ powerMw: mw, energyMwh: mwh, incrementalNpvRs: r.finance.consolidatedOwner.npvRs - noBessR.finance.consolidatedOwner.npvRs, incrementalIrr: r.finance.incremental.irr, ownerNpvRs: r.finance.consolidatedOwner.npvRs, usefulKwh: useful(r), discharged: r.bess?.discharged ?? 0, capexRs: r.bess?.capexRs ?? 0 });
    done++; onProgress?.(done, total);
  }
  const bestEconomic = points.reduce((a, b) => (b.incrementalNpvRs > a.incrementalNpvRs ? b : a), noBess);
  const maxUtilisation = points.reduce((a, b) => (b.usefulKwh > a.usefulKwh ? b : a), noBess);
  const recommendation = bestEconomic.energyMwh === 0 ? 'No BESS recommended: no evaluated size has a positive incremental NPV against the no-battery case.' : `Best evaluated: ${bestEconomic.powerMw} MW / ${bestEconomic.energyMwh} MWh (incremental NPV ${(bestEconomic.incrementalNpvRs / 1e7).toFixed(2)} Cr vs no BESS).`;
  return { points, bestEconomic, maxUtilisation, noBess, recommendation };
}

/** Inverse planning: what daytime load would absorb the residual surplus? Returns an hourly average kW shape of the surplus. */
export function sizeCustomerToAbsorb(r: ScenarioResult, residualPerInterval: Float64Array): { requiredDaytimeMw: number; hourlyAvgKw: number[]; annualKwh: number; daytimeHours: string } {
  const hourly = new Array(24).fill(0); const days = residualPerInterval.length / INTERVALS_PER_DAY;
  let annual = 0;
  for (let t = 0; t < residualPerInterval.length; t++) { const h = Math.floor((t % INTERVALS_PER_DAY) / 4); hourly[h] += residualPerInterval[t]; annual += residualPerInterval[t]; }
  const hourlyAvgKw = hourly.map((v) => v / days); // kWh per hour per day on average = kW
  const req = Math.max(...hourlyAvgKw) / 1000;
  void r;
  return { requiredDaytimeMw: req, hourlyAvgKw, annualKwh: annual, daytimeHours: '09:00-17:00 (solar hours)' };
}
