import type { Calendar, Consumer, ConsumerEconomics, ConsumerSettlement, OaCharges, Tariff } from './types.ts';
import { INTERVALS_PER_DAY } from './calendar.ts';

export function bandTotals(a: Float64Array, cal: Calendar, nb: number): number[] {
  const out = new Array(nb).fill(0);
  for (let t = 0; t < a.length; t++) out[cal.bandOfInterval[t % INTERVALS_PER_DAY]] += a[t];
  return out;
}

export function lossPct(oa?: OaCharges): number {
  if (!oa || oa.inKindLossPct === undefined) return 0;
  return typeof oa.inKindLossPct === 'number' ? oa.inKindLossPct : oa.inKindLossPct.value;
}

/** Energy-charge-first savings bridge for one consumer (annual, same load / PF / category as the counterfactual). */
export function consumerEconomics(
  c: Pick<Consumer, 'id' | 'name' | 'pf' | 'tariff' | 'oaCharges' | 'ppaTariffRsPerKwh' | 'ppaBillingBasis' | 'contractDemandKva' | 'kind'>,
  s: ConsumerSettlement, cal: Calendar, allocatedMwp: number, injectedKwh: number, savingsLabel: ConsumerEconomics['savingsLabel'] = 'actual-basis',
): ConsumerEconomics {
  const T: Tariff = c.tariff;
  const nb = T.todRsPerKvah.length;
  const pf = T.pfBillingUnit === 'kVAh' ? Math.max(0.5, c.pf) : 1;
  const loadB = bandTotals(s.load, cal, nb);
  const gridB = bandTotals(s.gridBilled, cal, nb);
  let gridOnlyEC = 0, withSolarEC = 0;
  for (let b = 0; b < nb; b++) {
    gridOnlyEC += loadB[b] / pf * (T.energyRsPerKvah + T.todRsPerKvah[b]);
    withSolarEC += gridB[b] / pf * (T.energyRsPerKvah + T.todRsPerKvah[b]);
  }
  const avoidedEC = gridOnlyEC - withSolarEC;                       // A
  const offsetKwh = s.totals.settledOffset;
  const bessKwh = s.totals.bess;
  const usefulKwh = offsetKwh + bessKwh;
  const avoidedKwh = s.totals.load - s.totals.gridBilled;          // = usefulKwh when load fully accounted
  let billed = usefulKwh;
  if (c.ppaBillingBasis === 'injection') billed = injectedKwh + bessKwh;
  else if (c.ppaBillingBasis === 'delivered') billed = s.totals.solar + bessKwh;
  const ppaCost = billed * c.ppaTariffRsPerKwh;
  const oa = c.oaCharges;
  let oaCost = 0;
  if (oa && allocatedMwp > 0) {
    const wheelOn = oa.applyWheeling ?? true;
    oaCost += (wheelOn ? oa.wheelingRsPerKwhInjected : 0) * injectedKwh;
    oaCost += oa.transmissionRsPerKwhOffset * offsetKwh;
    oaCost += oa.operatingRsPerMonth * cal.months.length;
    oaCost += (oa.tosePaisePerKwhOffset / 100) * offsetKwh;
    oaCost += ((oa.cssRsPerKwh ?? 0) + (oa.additionalSurchargeRsPerKwh ?? 0)) * offsetKwh;
  }
  const netB = avoidedEC - ppaCost - oaCost;                        // B
  const avoidedFac = avoidedKwh / pf * T.facRsPerKvah;
  const ltWheeling = avoidedKwh / pf * (T.wheelingRsPerKvah ?? 0);
  const avoidedTaxes = avoidedKwh * (T.tosePaisePerKwh / 100);       // ToSE on grid units avoided (ToSE on OA units is inside oaCost)
  const avoidedEd = (T.edPct / 100) * (avoidedEC + avoidedFac + ltWheeling);
  const broaderC = netB + avoidedFac + ltWheeling + avoidedTaxes + avoidedEd; // C
  const demandFloor = c.kind === 'factory' || c.kind === 'new' ? 0.75 : 0.4;
  const demandCharges = c.contractDemandKva * demandFloor * T.demandRsPerKvaMonth * cal.months.length; // unchanged (D)
  return {
    id: c.id, name: c.name, loadKwh: s.totals.load, offsetKwh, bessKwh, gridBilledKwh: s.totals.gridBilled,
    gridOnlyEnergyCostRs: gridOnlyEC, avoidedEnergyChargesRs: avoidedEC, ppaCostRs: ppaCost, oaCostRs: oaCost, netProcurementSavingRs: netB,
    avoidedFacRs: avoidedFac, avoidedTaxesRs: avoidedTaxes, avoidedEdRs: avoidedEd, ltWheelingRs: ltWheeling, broaderVariableSavingRs: broaderC,
    demandChargesRs: demandCharges,
    landedSolarRsPerKwh: usefulKwh > 0 ? (ppaCost + oaCost) / usefulKwh : 0,
    avoidedGridRsPerKwh: usefulKwh > 0 ? (avoidedEC + avoidedFac + ltWheeling + avoidedTaxes + avoidedEd) / usefulKwh : 0,
    billedPpaKwh: billed, savingsLabel,
  };
}
