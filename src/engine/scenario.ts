import type { Calendar, Consumer, ConsumerEconomics, ConsumerSettlement, EnergyBridge, FinanceResult, ScenarioInput, ScenarioResult } from './types.ts';
import { buildCalendar, INTERVALS_PER_DAY } from './calendar.ts';
import { buildSolar, type SolarSeries } from './solar.ts';
import { buildConsumerLoad, buildNewCustomerLoad, applyLoadShift, type LoadSeries } from './profiles.ts';
import { settleConsumer } from './settlement.ts';
import { dispatchBess, type BessDispatch } from './bess.ts';
import { consumerEconomics, lossPct } from './costs.ts';
import { buildFinance } from './finance.ts';

export interface SiteMeta { latitude: number; longitude: number }

const RS_CR = 1e7;

function newCustomerAsConsumer(inp: ScenarioInput): Consumer | null {
  const nc = inp.newCustomer;
  if (!nc.enabled || nc.allocationMwp <= 0) return null;
  return {
    id: 'NEW132', name: nc.name, site: '132 kV drawal point (path: 33 kV injection -> MSEDCL network)', kind: 'new', category: nc.category, voltageKv: nc.voltageKv,
    connection: 'proposed group-captive OA', contractDemandKva: nc.contractDemandKva, pf: 0.99, oaEligible: true,
    eligibilityNote: 'Group-captive ownership (>=26%) and >=51% consumption-proportionality tests: NOT verified - illustrative only.',
    profileType: nc.profile, todShares: { value: [], tag: 'synthetic_estimate' },
    currentAllocation: { mwp: 0, shareOfPlant: 0, status: 'assumed' }, monthly: [], tariff: nc.avoidedGridTariff, oaCharges: nc.oaCharges,
    ppaTariffRsPerKwh: nc.ppaTariffRsPerKwh, ppaBillingBasis: nc.ppaBillingBasis, avgLoadKw: nc.avgLoadMw * 1000, customProfile96: nc.customProfile96, weekendFactor: nc.weekendFactor,
  };
}

interface YearRun {
  settlements: ConsumerSettlement[];
  economics: ConsumerEconomics[];
  injected: number[];
  bess: BessDispatch | null;
  unallocatedKwh: number;      // residual export not allocated to anyone (after any battery charging from it)
  inKindLossKwh: number;       // injected - delivered (network losses in kind)
  bessFromResidualKwh: number;
  exportKwh: number;
}

function runYear(inp: ScenarioInput, cal: Calendar, solar: SolarSeries, loads: Map<string, LoadSeries>, consumers: Consumer[], yearIdx: number, keepArrays: boolean): YearRun {
  const n = cal.nIntervals;
  const degr = Math.pow(1 - inp.finance.solarDegradationPct / 100, yearIdx);
  const dc = inp.plant.dcMwp;
  const shares = consumers.map((c) => Math.max(0, (inp.allocationsMwp[c.id] ?? 0)) / dc);
  const sumShare = shares.reduce((a, b) => a + b, 0);
  const scale = sumShare > 1 ? 1 / sumShare : 1; // never allocate more than the plant
  const nc = consumers.length;
  const solarC: Float64Array[] = []; const injected: number[] = [];
  const residual = new Float64Array(n);
  let exportKwh = 0;
  for (let t = 0; t < n; t++) exportKwh += solar.kwh[t] * degr;
  for (let ci = 0; ci < nc; ci++) {
    const f = shares[ci] * scale; const loss = lossPct(consumers[ci].oaCharges) / 100;
    const arr = new Float64Array(n); let inj = 0;
    for (let t = 0; t < n; t++) { const e = solar.kwh[t] * degr * f; inj += e; arr[t] = e * (1 - loss); }
    solarC.push(arr); injected.push(inj);
  }
  const used = sumShare * scale;
  for (let t = 0; t < n; t++) residual[t] = solar.kwh[t] * degr * (1 - used);
  let inKindLoss = 0; for (let ci = 0; ci < nc; ci++) { let d = 0; for (let t = 0; t < n; t++) d += solarC[ci][t]; inKindLoss += injected[ci] - d; }
  let bessFromResidual = 0;

  // physical surplus / deficit per consumer
  const surplus: Float64Array[] = [], deficit: Float64Array[] = [];
  for (let ci = 0; ci < nc; ci++) {
    const L = loads.get(consumers[ci].id)!.kwh, S = solarC[ci];
    const su = new Float64Array(n), de = new Float64Array(n);
    for (let t = 0; t < n; t++) { const d = Math.min(L[t], S[t]); su[t] = S[t] - d; de[t] = L[t] - d; }
    surplus.push(su); deficit.push(de);
  }
  // BESS dispatch (plant-side pools all consumers; consumer-side restricted to one consumer)
  let bess: BessDispatch | null = null;
  const bessDeliveredC: (Float64Array | null)[] = consumers.map(() => null);
  if (inp.bess.enabled && inp.bess.energyMwh > 0 && inp.bess.powerMw > 0) {
    const atPlant = inp.bess.location === 'plant';
    const idx = atPlant ? consumers.map((_, i) => i) : consumers.map((c, i) => (c.id === inp.bess.location ? i : -1)).filter((i) => i >= 0);
    const avail = new Float64Array(n), need = new Float64Array(n);
    for (let t = 0; t < n; t++) {
      let a = 0, d = 0; for (const i of idx) { a += surplus[i][t]; d += deficit[i][t]; }
      if (atPlant && inp.bess.chargeFromUnallocated) a += residual[t];
      avail[t] = a; need[t] = d;
    }
    bess = dispatchBess(inp.bess, yearIdx, avail, need, cal, inp.rules.todBands.map((b) => b.id));
    for (const i of idx) bessDeliveredC[i] = new Float64Array(n);
    for (let t = 0; t < n; t++) {
      const c = bess.charged[t], dlv = bess.delivered[t];
      if (c > 0 && avail[t] > 0) {
        // value-aware sourcing: the unallocated residual has no settlement value, so it is used first;
        // consumer surplus (which might otherwise be banked / block-netted) only covers the remainder
        let remaining = c;
        if (atPlant && inp.bess.chargeFromUnallocated && residual[t] > 0) { const r = Math.min(residual[t], remaining); residual[t] -= r; bessFromResidual += r; remaining -= r; }
        if (remaining > 1e-12) {
          let consSur = 0; for (const i of idx) consSur += surplus[i][t];
          if (consSur > 0) { const frac = Math.min(1, remaining / consSur); for (const i of idx) { const take = surplus[i][t] * frac; solarC[i][t] -= take; surplus[i][t] -= take; } }
        }
      }
      if (dlv > 0 && need[t] > 0) { const frac = dlv / need[t]; for (const i of idx) bessDeliveredC[i]![t] = deficit[i][t] * frac; }
    }
  }
  const settlements: ConsumerSettlement[] = []; const economics: ConsumerEconomics[] = [];
  for (let ci = 0; ci < nc; ci++) {
    const c = consumers[ci];
    const s = settleConsumer(c.id, loads.get(c.id)!.kwh, solarC[ci], bessDeliveredC[ci], inp.mode, inp.rules, cal);
    const label = c.kind === 'new' && !inp.newCustomer.tariffKnown ? 'illustrative' : 'actual-basis';
    economics.push(consumerEconomics(c, s, cal, inp.allocationsMwp[c.id] ?? 0, injected[ci], label));
    if (!keepArrays) { // drop heavy arrays for out-years
      const t = s.totals; settlements.push({ ...s, load: new Float64Array(0), solarDelivered: new Float64Array(0), physicalDirect: new Float64Array(0), settledOffset: new Float64Array(0), bankWithdrawn: new Float64Array(0), bankDeposited: new Float64Array(0), gridBilled: new Float64Array(0), gridPhysical: new Float64Array(0), bessDelivered: new Float64Array(0), expired: new Float64Array(0), compensated: new Float64Array(0), bankingCharge: new Float64Array(0), totals: t });
    } else settlements.push(s);
  }
  let unallocated = 0; for (let t = 0; t < n; t++) unallocated += residual[t];
  return { settlements, economics, injected, bess, unallocatedKwh: unallocated, inKindLossKwh: inKindLoss, bessFromResidualKwh: bessFromResidual, exportKwh };
}

export function runScenario(inp: ScenarioInput, site: SiteMeta): ScenarioResult {
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const warnings: string[] = [];
  const cal = buildCalendar(inp.months, inp.rules.todBands);
  const solar = buildSolar(inp.plant, cal, site.latitude, site.longitude);
  if (solar.acCeilingFlags.length) warnings.push(`${solar.acCeilingFlags.length} day(s) where the synthetic intraday peak exceeds the assumed ${inp.plant.acMw} MWac ceiling - capacity/profile inconsistency flagged, energy NOT dropped.`);
  const consumers: Consumer[] = [...inp.consumers];
  const ncC = newCustomerAsConsumer(inp); if (ncC) consumers.push(ncC);
  const loads = new Map<string, LoadSeries>();
  for (const c of consumers) {
    let ls = c.kind === 'new' ? buildNewCustomerLoad(inp.newCustomer, cal) : buildConsumerLoad(c, cal, inp.rules.todBands, inp.loadTrend, true);
    if (inp.loadShift && inp.loadShift.consumerId === c.id && inp.loadShift.kwhPerDayToDaytime > 0) {
      const { shifted, movedKwh } = applyLoadShift(ls.kwh, cal, inp.loadShift.kwhPerDayToDaytime);
      ls = { ...ls, kwh: shifted, note: ls.note + `; explicit load-shift scenario moved ${Math.round(movedKwh)} kWh/yr into 09-17` };
    }
    loads.set(c.id, ls);
  }
  const totalAlloc = consumers.reduce((a, c) => a + Math.max(0, inp.allocationsMwp[c.id] ?? 0), 0);
  if (totalAlloc > inp.plant.dcMwp + 1e-9) warnings.push(`Requested allocations ${totalAlloc.toFixed(2)} MWp exceed the ${inp.plant.dcMwp} MWp plant; shares scaled down pro-rata.`);
  for (const c of consumers) if ((inp.allocationsMwp[c.id] ?? 0) > 0 && !c.oaEligible) warnings.push(`${c.name}: allocation requested but open-access eligibility is not established (${c.connection}).`);

  const y1 = runYear(inp, cal, solar, loads, consumers, 0, true);

  // ---- bridge (physical) for year 1
  const sum = (a: Float64Array) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i]; return s; };
  let delivered = 0, direct = 0, withdrawn = 0, fee = 0, expired = 0, compensated = 0, bessDel = 0;
  for (const s of y1.settlements) { delivered += s.totals.solar; direct += s.totals.physicalDirect; withdrawn += s.totals.bankWithdrawn; fee += s.totals.bankingCharge; expired += s.totals.expired; compensated += s.totals.compensated; bessDel += s.totals.bess; }
  const injectedTot = y1.injected.reduce((a, b) => a + b, 0);
  const bessCharged = y1.bess?.totals.charged ?? 0;
  const inKind = y1.inKindLossKwh;
  const bridge: EnergyBridge = {
    plantExport: y1.exportKwh, allocatedDelivered: injectedTot - inKind, inKindLosses: inKind, unallocatedResidual: y1.unallocatedKwh,
    physicalDirect: direct, bankWithdrawn: withdrawn, bankingCharge: fee, bessCharged, bessDelivered: bessDel,
    bessLosses: (y1.bess?.totals.losses ?? 0) + (y1.bess?.totals.aux ?? 0), bessSocChange: y1.bess?.totals.socChangeKwh ?? 0,
    expired, compensated, curtailment: 0, balanceError: 0,
  };
  // export = inKind losses + unallocated residual (after battery) + [direct + bank withdrawn + banking charge + expired + compensated + battery charged]
  bridge.balanceError = bridge.plantExport - bridge.inKindLosses - bridge.unallocatedResidual - (direct + withdrawn + fee + expired + compensated + bessCharged);
  void delivered; void sum;

  // ---- monthly disposition
  const monthly = cal.months.map((m) => ({ month: m, export: 0, direct: 0, bankWithdrawn: 0, bess: 0, compensated: 0, expired: 0, losses: 0, unallocated: 0, grid: 0, load: 0 }));
  for (let d = 0; d < cal.dayDates.length; d++) {
    const mi = cal.dayMonthIdx[d];
    for (let i = 0; i < INTERVALS_PER_DAY; i++) {
      const t = d * INTERVALS_PER_DAY + i;
      monthly[mi].export += solar.kwh[t];
      for (const s of y1.settlements) {
        monthly[mi].direct += s.physicalDirect[t]; monthly[mi].bankWithdrawn += s.bankWithdrawn[t]; monthly[mi].bess += s.bessDelivered[t];
        monthly[mi].compensated += s.compensated[t]; monthly[mi].expired += s.expired[t]; monthly[mi].losses += s.bankingCharge[t];
        monthly[mi].grid += s.gridBilled[t]; monthly[mi].load += s.load[t];
      }
    }
  }
  const lossShare = injectedTot > 0 ? inKind / injectedTot : 0, unShare = y1.exportKwh > 0 ? bridge.unallocatedResidual / y1.exportKwh : 0;
  for (const r of monthly) { r.losses += r.export * (1 - unShare) * lossShare; r.unallocated = r.export * unShare; }

  const nb = inp.rules.todBands.length;
  const bandTotals = inp.rules.todBands.map((b) => ({ band: b.label, load: 0, solar: 0, grid: 0 }));
  for (let t = 0; t < cal.nIntervals; t++) {
    const b = cal.bandOfInterval[t % INTERVALS_PER_DAY];
    bandTotals[b].solar += solar.kwh[t];
    for (const s of y1.settlements) { bandTotals[b].load += s.load[t]; bandTotals[b].grid += s.gridBilled[t]; }
  }
  void nb;

  // ---- SPV & finance over life (re-dispatch each year with degraded solar / battery)
  const F = inp.finance; const N = F.lifeYears;
  const bessCapex = inp.bess.enabled ? (inp.bess.energyMwh * inp.bess.capexRsCrPerMwh + inp.bess.otherAddersRsCr) * RS_CR : 0;
  const revExisting: number[] = [], revNew: number[] = [], revBess: number[] = [], revComp: number[] = [], opex: number[] = [], ownerCash: number[] = [], repl: number[] = [];
  for (let y = 0; y < N; y++) {
    let yr: YearRun;
    if (y === 0) yr = y1;
    else if (inp.financeMethod === 'scaled') {
      // documented approximation: scale year-1 solar-linked quantities by the degradation factor
      const g = Math.pow(1 - F.solarDegradationPct / 100, y);
      yr = { ...y1, economics: y1.economics.map((e) => ({ ...e, billedPpaKwh: e.billedPpaKwh * g, bessKwh: e.bessKwh * g, ppaCostRs: e.ppaCostRs * g, broaderVariableSavingRs: e.broaderVariableSavingRs * g })),
             settlements: y1.settlements.map((s) => ({ ...s, totals: { ...s.totals, compensated: s.totals.compensated * g } })) };
    } else yr = runYear(inp, cal, solar, loads, consumers, y, false);
    const esc = Math.pow(1 + F.ppaEscalationPct / 100, y);
    let rE = 0, rN = 0, rB = 0, rC = 0, own = 0;
    yr.economics.forEach((e, i) => {
      const c = consumers[i];
      const ppaUnits = e.billedPpaKwh - e.bessKwh;
      const bessRs = e.bessKwh * c.ppaTariffRsPerKwh * esc;
      if (c.kind === 'new') rN += ppaUnits * c.ppaTariffRsPerKwh * esc + bessRs;
      else { rE += ppaUnits * c.ppaTariffRsPerKwh * esc; rB += bessRs; own += (e.broaderVariableSavingRs + e.ppaCostRs * esc) ; }
      rC += yr.settlements[i].totals.compensated * inp.rules.expiredCompensationRsPerKwh;
    });
    // consolidated owner: internal PPA cancels -> add back ppaCost already deducted in the consumer bridge
    const om = F.omPctOfCapexYear1 / 100 * F.solarCapexRsCr * RS_CR * Math.pow(1 + F.omEscalationPct / 100, y) + (inp.bess.enabled ? inp.bess.omPctOfCapex / 100 * bessCapex : 0) + F.otherOpexRsCrPerYear * RS_CR;
    revExisting.push(rE); revNew.push(rN); revBess.push(rB); revComp.push(rC); opex.push(om);
    ownerCash.push(own + rN + rC - om);
    repl.push(inp.bess.enabled && inp.bess.lifeYears > 0 && (y + 1) % inp.bess.lifeYears === 0 && y + 1 < N ? bessCapex : 0);
  }
  const revenueSpv = revExisting.map((v, i) => v + revNew[i] + revBess[i] + revComp[i]);
  const fullLife: FinanceResult = buildFinance({ lifeYears: N, revenueByYear: revenueSpv, opexByYear: opex, capexYear0: F.solarCapexRsCr * RS_CR + bessCapex, replacementByYear: repl, receivableDays: F.receivableDays, terminalValue: F.terminalValueRsCr * RS_CR, discountRate: F.discountRatePct / 100 });
  const incremental: FinanceResult = buildFinance({ lifeYears: N, revenueByYear: revenueSpv, opexByYear: opex, capexYear0: bessCapex, replacementByYear: repl, receivableDays: F.receivableDays, terminalValue: 0, discountRate: F.discountRatePct / 100 });
  const consolidatedOwner: FinanceResult = buildFinance({ lifeYears: N, revenueByYear: ownerCash.map((v, i) => v + opex[i]), opexByYear: opex, capexYear0: bessCapex, replacementByYear: repl, receivableDays: 0, terminalValue: 0, discountRate: F.discountRatePct / 100 });

  const newIdx = consumers.findIndex((c) => c.kind === 'new');
  const newEco = newIdx >= 0 ? y1.economics[newIdx] : null;
  const perfMs = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0;
  return {
    id: inp.id, label: inp.label, mode: inp.mode,
    calendar: { months: cal.months, observedDays: solar.observedDays, estimatedDays: solar.estimatedDays },
    plant: { exportKwh: y1.exportKwh, observedExportKwh: solar.observedKwh, annualisedFlatKwh: solar.observedDays ? solar.observedKwh / solar.observedDays * 365 : 0, acCeilingFlags: solar.acCeilingFlags.length, dcMwp: inp.plant.dcMwp, acMw: inp.plant.acMw, allocatedMwp: Math.min(totalAlloc, inp.plant.dcMwp), unallocatedMwp: Math.max(0, inp.plant.dcMwp - totalAlloc) },
    consumers: y1.settlements, economics: y1.economics, bridge, monthly, bandTotals,
    bess: y1.bess ? { enabled: true, powerKw: inp.bess.powerMw * 1000, energyKwh: inp.bess.energyMwh * 1000, charged: y1.bess.totals.charged, discharged: y1.bess.totals.delivered, losses: y1.bess.totals.losses + y1.bess.totals.aux, cycles: y1.bess.totals.cycles, socSeries: y1.bess.soc, capexRs: bessCapex } : null,
    spv: { revenueExistingRs: revExisting[0], revenueNewRs: revNew[0], revenueBessRs: revBess[0], compensationRs: revComp[0], omRs: opex[0], capexFullLifeRs: F.solarCapexRsCr * RS_CR + bessCapex, capexIncrementalRs: bessCapex },
    finance: { fullLife, incremental, consolidatedOwner },
    newCustomer: newEco ? { offeredMwp: inp.allocationsMwp['NEW132'] ?? 0, billedKwh: newEco.billedPpaKwh, offsetKwh: newEco.offsetKwh, savingRs: newEco.broaderVariableSavingRs, landedRsPerKwh: newEco.landedSolarRsPerKwh, label: inp.newCustomer.tariffKnown ? 'customer tariff supplied' : 'illustrative tariff - savings not confirmed' } : null,
    perfMs, warnings,
  };
}
