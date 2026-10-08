import type { BessInput, Consumer, FinanceAssumptions, NewCustomerInput, PlantInput, RulePack, ScenarioInput, SettlementMode } from './types.ts';

/** Shape of src/data/seed/seed_case.json (built by scripts/extract/build_seed_case.py). */
export interface SeedCase {
  version: number; builtOn: string;
  calendar: { months: string[]; timezone: string; observedThrough: string; estimatedMonths: string[]; intervalsPerDay: number };
  plant: {
    name: string; dcMwp: number; acMwInverter: { value: number; tag: string; status: string; note: string }; capexRsCrPerMw: number; capexRsCr: number; latitude: number; longitude: number;
    export: { seriesType: string; meterFactor: { value: number; status: string; note: string }; days: { date: string; kwh: number; hardcoded: boolean; note: string | null; source: unknown }[]; monthlyKwh: Record<string, number>; totalKwh: number; nDays: number; flatAnnualisationKwh: number; zeroDays: string[]; issues: unknown[] };
    costSheetIllustration: Record<string, unknown>;
  };
  consumers: Consumer[];
  newCustomerDefaults: { name: string; category: string; voltageKv: number; ppaTariffRsPerKwh: number; avgLoadMw: number; profile: 'factory24x7' | 'dayShift' | 'custom'; allocationMwp: number; contractDemandKva: number; avoidedGridTariff: { energyRsPerKvah: number; todRsPerKvah: number[]; facRsPerKvah: number; tag: string; note: string }; oaCharges: { wheelingRsPerKwhInjected: number; transmissionRsPerKwhOffset: number; operatingRsPerMonth: number; tosePaisePerKwhOffset: number; applyWheeling: boolean; note: string } };
  rulePack: RulePack;
  finance: { tag: string; lifeYears: number; solarDegradationPct: number; omPctOfCapexYear1: number; omEscalationPct: number; ppaEscalationPct: number; discountRatePct: number; receivableDays: number; bess: { capexRsCrPerMwh: number; includesPcs: boolean; includesInstallation: boolean; includesConnection: boolean; otherAddersRsCr: number; lifeYears: number; omPctOfCapex: number; usableSocMin: number; usableSocMax: number; etaCharge: number; etaDischarge: number; auxPctOfThroughput: number; degradationPctPerYear: number; maxCyclesPerDay: number } };
}

export function defaultPlant(seed: SeedCase): PlantInput {
  return {
    dcMwp: seed.plant.dcMwp, acMw: seed.plant.acMwInverter.value,
    exportDaily: seed.plant.export.days.map((d) => ({ date: d.date, kwh: d.kwh, hardcoded: d.hardcoded, note: d.note })),
    octoberEstimateKwhPerDay: undefined, meterFactorOverride: 1, profileShape: 'smooth', recoveredAvailability: false,
  };
}

export function defaultNewCustomer(seed: SeedCase, enabled: boolean): NewCustomerInput {
  const d = seed.newCustomerDefaults;
  return {
    enabled, name: d.name, category: d.category, voltageKv: d.voltageKv, ppaTariffRsPerKwh: d.ppaTariffRsPerKwh, avgLoadMw: d.avgLoadMw, profile: d.profile,
    weekendFactor: 1, allocationMwp: d.allocationMwp, contractDemandKva: d.contractDemandKva, ownershipSharePct: 26, ppaBillingBasis: 'offset',
    avoidedGridTariff: { tag: d.avoidedGridTariff.tag, energyRsPerKvah: d.avoidedGridTariff.energyRsPerKvah, demandRsPerKvaMonth: 650, todRsPerKvah: d.avoidedGridTariff.todRsPerKvah, facRsPerKvah: d.avoidedGridTariff.facRsPerKvah, edPct: 0, tosePaisePerKwh: 27.9, pfBillingUnit: 'kVAh' },
    oaCharges: { ...d.oaCharges, inKindLossPct: 0 }, tariffKnown: false,
  };
}

export function defaultBess(seed: SeedCase, enabled: boolean): BessInput {
  const b = seed.finance.bess;
  return {
    enabled, powerMw: 2, energyMwh: 4, location: 'plant', capexRsCrPerMwh: b.capexRsCrPerMwh, otherAddersRsCr: b.otherAddersRsCr,
    includesPcs: b.includesPcs, includesInstallation: b.includesInstallation, includesConnection: b.includesConnection,
    usableSocMin: b.usableSocMin, usableSocMax: b.usableSocMax, etaCharge: b.etaCharge, etaDischarge: b.etaDischarge, auxPctOfThroughput: b.auxPctOfThroughput,
    degradationPctPerYear: b.degradationPctPerYear, maxCyclesPerDay: b.maxCyclesPerDay, lifeYears: b.lifeYears, omPctOfCapex: b.omPctOfCapex,
    dischargeBands: ['D', 'A'], chargeFromUnallocated: true,
  };
}

export function defaultFinance(seed: SeedCase): FinanceAssumptions {
  const f = seed.finance;
  return { tag: f.tag, lifeYears: f.lifeYears, solarDegradationPct: f.solarDegradationPct, omPctOfCapexYear1: f.omPctOfCapexYear1, omEscalationPct: f.omEscalationPct, ppaEscalationPct: f.ppaEscalationPct, discountRatePct: f.discountRatePct, receivableDays: f.receivableDays, solarCapexRsCr: seed.plant.capexRsCr, terminalValueRsCr: 0, otherOpexRsCrPerYear: 0 };
}

export function currentAllocations(seed: SeedCase): Record<string, number> {
  const a: Record<string, number> = {};
  for (const c of seed.consumers) a[c.id] = c.currentAllocation.mwp;
  return a;
}

/** Baseline scenario input (S0) from the seed. */
export function baseInput(seed: SeedCase, mode: SettlementMode): ScenarioInput {
  return {
    id: 'S0', label: 'S0 - Current allocation', mode, rules: seed.rulePack, plant: defaultPlant(seed), consumers: seed.consumers,
    allocationsMwp: currentAllocations(seed), newCustomer: defaultNewCustomer(seed, false), bess: defaultBess(seed, false), finance: defaultFinance(seed),
    months: seed.calendar.months, loadTrend: 'flat', loadShift: null,
  };
}
