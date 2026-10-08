import type { FinanceResult } from './types.ts';

export function npv(rate: number, flows: number[]): number {
  // flows[0] at t=0 (undiscounted), flows[y] at end of year y
  return flows.reduce((acc, f, y) => acc + f / Math.pow(1 + rate, y), 0);
}

/**
 * IRR by bracketing + bisection. Returns null (with a reason) when undefined:
 * no sign change, all-positive / all-negative flows, or multiple roots detected by sign-change count > 1
 * (Descartes bound: we report the lowest root but flag it).
 */
export function irr(flows: number[]): { irr: number | null; note: string } {
  const nonZero = flows.filter((f) => Math.abs(f) > 1e-9);
  if (nonZero.length < 2) return { irr: null, note: 'not defined (fewer than two non-zero cash flows)' };
  let changes = 0;
  for (let i = 1; i < nonZero.length; i++) if (Math.sign(nonZero[i]) !== Math.sign(nonZero[i - 1])) changes++;
  if (changes === 0) return { irr: null, note: nonZero[0] > 0 ? 'not defined (all cash flows positive - no investment outlay)' : 'not defined (all cash flows negative)' };
  let lo = -0.99, hi = 10;
  const f = (r: number) => npv(r, flows);
  let flo = f(lo), fhi = f(hi);
  if (Math.sign(flo) === Math.sign(fhi)) return { irr: null, note: 'not defined (no root in -99%..1000%)' };
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2; const fm = f(mid);
    if (Math.abs(fm) < 1e-6) { lo = hi = mid; break; }
    if (Math.sign(fm) === Math.sign(flo)) { lo = mid; flo = fm; } else { hi = mid; fhi = fm; }
  }
  const r = (lo + hi) / 2;
  return { irr: r, note: changes > 1 ? `multiple sign changes (${changes}) - IRR may not be unique; lowest root reported` : 'unlevered pre-tax project IRR' };
}

export function paybacks(flows: number[], rate: number): { simple: number | null; discounted: number | null } {
  let cum = 0, cumD = 0, simple: number | null = null, disc: number | null = null;
  for (let y = 0; y < flows.length; y++) {
    const prev = cum, prevD = cumD;
    cum += flows[y]; cumD += flows[y] / Math.pow(1 + rate, y);
    if (simple === null && y > 0 && prev < 0 && cum >= 0) simple = y - 1 + (-prev) / (cum - prev);
    if (disc === null && y > 0 && prevD < 0 && cumD >= 0) disc = y - 1 + (-prevD) / (cumD - prevD);
  }
  if (flows[0] >= 0) return { simple: null, discounted: null };
  return { simple, discounted: disc };
}

export interface CashflowInputs {
  lifeYears: number;
  revenueByYear: number[];        // index 0 = year 1
  opexByYear: number[];           // cash operating costs incl. O&M (index 0 = year 1)
  capexYear0: number;
  replacementByYear: number[];    // extra capex in given year (index 0 = year 1)
  receivableDays: number;
  terminalValue: number;          // recovered at end of life (₹)
  discountRate: number;           // fraction
}

export function buildFinance(inp: CashflowInputs): FinanceResult {
  const N = inp.lifeYears;
  const years = Array.from({ length: N + 1 }, (_, i) => i);
  const revenueRs = [0], omRs = [0], capexRs = [inp.capexYear0], workingCapitalRs = [0], fcfRs = [-inp.capexYear0];
  let prevRec = 0;
  for (let y = 1; y <= N; y++) {
    const rev = inp.revenueByYear[y - 1] ?? 0;
    const opex = inp.opexByYear[y - 1] ?? 0;
    const capex = inp.replacementByYear[y - 1] ?? 0;
    const rec = rev * inp.receivableDays / 365;
    let dWC = rec - prevRec; prevRec = rec;
    let terminal = 0;
    if (y === N) { terminal = inp.terminalValue; dWC -= rec; } // release working capital at end of life
    revenueRs.push(rev); omRs.push(opex); capexRs.push(capex); workingCapitalRs.push(-dWC);
    fcfRs.push(rev - opex - capex - dWC + terminal);
  }
  const ir = fcfRs[0] >= 0 ? { irr: null, note: 'not defined (no initial investment outlay - use incremental NPV)' } : irr(fcfRs);
  const { irr: r, note } = ir;
  const pb = paybacks(fcfRs, inp.discountRate);
  return { years, revenueRs, omRs, capexRs, workingCapitalRs, fcfRs, npvRs: npv(inp.discountRate, fcfRs), irr: r, irrNote: note, simplePaybackYears: pb.simple, discountedPaybackYears: pb.discounted };
}
