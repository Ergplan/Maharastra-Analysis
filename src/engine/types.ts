// Core engine types. Units: kW / kWh internally, ₹ as monetary base.
// Conversions to MW / MWh / lakh / crore happen only at UI interfaces.

export type Tag = 'extracted_actual' | 'derived_from_actual' | 'user_assumption' | 'synthetic_estimate' | 'bill_derived_FY27' | 'illustrative' | 'modelling_assumption';

export interface Tagged<T> { value: T; tag: Tag | string; note?: string; status?: string }

export type SettlementMode = 'tod_block' | 'interval_15min';

export interface TodBand { id: string; label: string; startHour: number; endHour: number }

export interface RulePack {
  id: string;
  label: string;
  effectiveFrom: string;
  todBands: TodBand[];
  adjustmentPeriod: 'month';
  bankingAllowed: boolean;
  bankingChargePct: number;             // in-kind % deducted from deposits
  withdrawalMatrix: Record<string, string[]>; // depositBand -> bands where it may be withdrawn
  bankCapPctOfConsumption: number;      // cap on deposits per period as % of period consumption
  expiredCompensationRsPerKwh: number;  // ₹ paid by DISCOM for unused energy (0 = lapses)
  notes?: string[];
  sources?: { title: string; url: string; inspected: string; status: string }[];
}

export interface Tariff {
  tag: string;
  effectiveFrom?: string;
  energyRsPerKvah: number;
  demandRsPerKvaMonth: number;
  todRsPerKvah: number[];        // per band, same order as rulePack.todBands
  wheelingRsPerKvah?: number;    // LT wheeling charge on the grid bill
  facRsPerKvah: number;
  edPct: number;                 // electricity duty % on (demand+wheeling+energy+tod+fac)
  tosePaisePerKwh: number;       // tax on sale of electricity, paise per kWh
  bulkRebatePct?: number;
  pfBillingUnit: 'kVAh' | 'kWh';
  todNote?: string; facNote?: string;
}

export interface OaCharges {
  tag?: string;
  wheelingRsPerKwhInjected: number;
  transmissionRsPerKwhOffset: number;
  operatingRsPerMonth: number;
  tosePaisePerKwhOffset: number;
  cssRsPerKwh?: number;
  additionalSurchargeRsPerKwh?: number;
  inKindLossPct?: Tagged<number> | number;
  applyWheeling?: boolean;
  note?: string;
}

export interface MonthlyObs {
  month: string;      // 'YYYY-MM'
  kwh?: number;       // measured kWh
  kvah?: number;
  kwh_est?: number;   // kWh estimated from kVAh x PF (store history)
  drawal_kwh?: number; // factory total site drawal
  grid_kwh?: number; oa_offset_kwh?: number; oa_injection_kwh?: number; over_injected_kwh?: number; rooftop_kwh?: number;
  grid_zone_kwh?: (number | null)[];
  tag: string;
  [k: string]: unknown;
}

export interface Consumer {
  id: string;
  name: string;
  site: string;
  kind: 'factory' | 'store' | 'new';
  category: string;
  voltageKv: number;
  connection: string;
  contractDemandKva: number;
  sanctionedLoadKw?: number;
  oaCdKva?: number;
  pf: number;
  oaEligible: boolean;
  eligibilityNote?: string;
  profileType: 'factory24x7' | 'store' | 'dayShift' | 'custom';
  todShares: Tagged<number[]>;
  dayNightRatio?: Tagged<number>;
  currentAllocation: { mwp: number; shareOfPlant: number; status: 'confirmed' | 'assumed' | 'unknown'; note?: string };
  monthly: MonthlyObs[];
  tariff: Tariff;
  oaCharges?: OaCharges;
  rooftop?: { kw: number; note?: string } | null;
  ppaTariffRsPerKwh: number;
  ppaBillingBasis: 'offset' | 'injection' | 'delivered';
  // optional synthetic load inputs (new customer)
  avgLoadKw?: number;
  customProfile96?: number[];   // 96 relative weights
  weekendFactor?: number;
}

export interface NewCustomerInput {
  enabled: boolean;
  name: string;
  category: string;
  voltageKv: number;
  ppaTariffRsPerKwh: number;
  avgLoadMw: number;
  profile: 'factory24x7' | 'dayShift' | 'custom';
  customProfile96?: number[];
  weekendFactor: number;
  allocationMwp: number;
  contractDemandKva: number;
  ownershipSharePct: number;      // equity held in SPV (group-captive test: not verified)
  ppaBillingBasis: 'offset' | 'injection' | 'delivered';
  avoidedGridTariff: Tariff;
  oaCharges: OaCharges;
  tariffKnown: boolean;           // false => savings labelled illustrative
}

export interface BessInput {
  enabled: boolean;
  powerMw: number;
  energyMwh: number;
  location: 'plant' | string; // 'plant' or consumer id
  capexRsCrPerMwh: number;
  otherAddersRsCr: number;
  includesPcs: boolean; includesInstallation: boolean; includesConnection: boolean;
  usableSocMin: number; usableSocMax: number;
  etaCharge: number; etaDischarge: number;
  auxPctOfThroughput: number;
  degradationPctPerYear: number;
  maxCyclesPerDay: number;
  lifeYears: number;
  omPctOfCapex: number;
  replacementYear?: number;
  dischargeBands: string[];           // bands where discharge is permitted/valuable
  chargeFromUnallocated: boolean;     // may the plant-side battery charge from the unallocated residual?
}

export interface FinanceAssumptions {
  tag?: string;
  lifeYears: number;
  solarDegradationPct: number;
  omPctOfCapexYear1: number;
  omEscalationPct: number;
  ppaEscalationPct: number;
  discountRatePct: number;
  receivableDays: number;
  solarCapexRsCr: number;
  terminalValueRsCr: number;
  otherOpexRsCrPerYear: number;
}

export interface PlantInput {
  dcMwp: number;
  acMw: number;                 // unverified inverter ceiling
  exportDaily: { date: string; kwh: number; hardcoded?: boolean; note?: string | null }[];
  octoberEstimateKwhPerDay?: number; // editable estimate for the missing month
  meterFactorOverride?: number;      // 1 = keep reported kWh; e.g. 1000/90 if readings were really MWh
  profileShape: 'smooth' | 'variable';
  recoveredAvailability: boolean;    // separate scenario: fill the Jul-8 breakdown
}

export interface ScenarioInput {
  id: 'S0' | 'S1' | 'S2' | 'S3' | string;
  label: string;
  mode: SettlementMode;
  rules: RulePack;
  plant: PlantInput;
  consumers: Consumer[];
  allocationsMwp: Record<string, number>; // contractual MWp-equivalent per consumer id
  newCustomer: NewCustomerInput;
  bess: BessInput;
  finance: FinanceAssumptions;
  months: string[];
  financeMethod?: 'recompute' | 'scaled'; // 'scaled' = fast approximation used inside optimisers (year-1 results scaled by degradation)
  loadTrend: 'flat' | 'seasonal';
  loadShift?: { consumerId: string; kwhPerDayToDaytime: number } | null;
}

export interface Calendar {
  months: string[];                 // 12 'YYYY-MM'
  dayDates: string[];               // 365 dates
  dayMonthIdx: Int16Array;          // day -> month index
  intervalsPerDay: number;          // 96
  nIntervals: number;
  bandOfInterval: Int8Array;        // interval-of-day -> band index
  daysInMonth: number[];
  isWeekend: Uint8Array;
}

export interface ConsumerSettlement {
  id: string;
  load: Float64Array;              // kWh per interval (residual demand after rooftop)
  solarDelivered: Float64Array;    // kWh allocated and delivered (after in-kind losses)
  physicalDirect: Float64Array;    // min(load, solar) each interval
  settledOffset: Float64Array;     // physicalDirect + bank withdrawals credited (billing)
  bankWithdrawn: Float64Array;
  bankDeposited: Float64Array;
  gridBilled: Float64Array;        // load - settledOffset - bessDelivered
  gridPhysical: Float64Array;      // load - physicalDirect - bessDelivered
  bessDelivered: Float64Array;
  expired: Float64Array;           // uncompensated surplus (per deposit period, placed at period end interval)
  compensated: Float64Array;       // surplus compensated at a rate
  bankingCharge: Float64Array;
  totals: Record<string, number>;
}

export interface EnergyBridge {
  plantExport: number;
  allocatedDelivered: number;
  inKindLosses: number;
  unallocatedResidual: number;
  physicalDirect: number;
  bankWithdrawn: number;
  bankingCharge: number;
  bessCharged: number;
  bessDelivered: number;
  bessLosses: number;
  bessSocChange: number;
  expired: number;
  compensated: number;
  curtailment: number;
  balanceError: number;
}

export interface ConsumerEconomics {
  id: string; name: string;
  loadKwh: number; offsetKwh: number; bessKwh: number; gridBilledKwh: number;
  gridOnlyEnergyCostRs: number;        // counterfactual A-basis (EC + ToD)
  avoidedEnergyChargesRs: number;      // A
  ppaCostRs: number;
  oaCostRs: number;
  netProcurementSavingRs: number;      // B
  avoidedFacRs: number; avoidedTaxesRs: number; avoidedEdRs: number; ltWheelingRs: number;
  broaderVariableSavingRs: number;     // C
  demandChargesRs: number;             // unchanged (D context)
  landedSolarRsPerKwh: number;         // (PPA + OA) / useful solar credited
  avoidedGridRsPerKwh: number;
  billedPpaKwh: number;
  savingsLabel: 'actual-basis' | 'illustrative';
}

export interface FinanceResult {
  years: number[];
  revenueRs: number[]; omRs: number[]; capexRs: number[]; workingCapitalRs: number[]; fcfRs: number[];
  npvRs: number; irr: number | null; irrNote: string; simplePaybackYears: number | null; discountedPaybackYears: number | null;
}

export interface ScenarioResult {
  id: string; label: string; mode: SettlementMode;
  calendar: { months: string[]; observedDays: number; estimatedDays: number };
  plant: { exportKwh: number; observedExportKwh: number; annualisedFlatKwh: number; acCeilingFlags: number; dcMwp: number; acMw: number; allocatedMwp: number; unallocatedMwp: number };
  consumers: ConsumerSettlement[];
  economics: ConsumerEconomics[];
  bridge: EnergyBridge;
  monthly: { month: string; export: number; direct: number; bankWithdrawn: number; bess: number; compensated: number; expired: number; losses: number; unallocated: number; grid: number; load: number }[];
  bandTotals: { band: string; load: number; solar: number; grid: number }[];
  bess: { enabled: boolean; powerKw: number; energyKwh: number; charged: number; discharged: number; losses: number; cycles: number; socSeries?: Float32Array; capexRs: number; recommendation?: string } | null;
  spv: { revenueExistingRs: number; revenueNewRs: number; revenueBessRs: number; compensationRs: number; omRs: number; capexFullLifeRs: number; capexIncrementalRs: number };
  finance: { fullLife: FinanceResult; incremental: FinanceResult; consolidatedOwner: FinanceResult };
  newCustomer: { offeredMwp: number; billedKwh: number; offsetKwh: number; savingRs: number; landedRsPerKwh: number; label: string } | null;
  perfMs: number;
  warnings: string[];
}
