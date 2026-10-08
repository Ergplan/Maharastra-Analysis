import type { BessInput, Calendar } from './types.ts';
import { INTERVALS_PER_DAY } from './calendar.ts';

export interface BessDispatch {
  charged: Float64Array;     // kWh drawn from available surplus (AC side, before charging losses)
  delivered: Float64Array;   // kWh delivered to load (after discharge losses and auxiliaries)
  soc: Float32Array;         // kWh in store at the START of each interval (plus final at index n)
  totals: { charged: number; delivered: number; losses: number; aux: number; cycles: number; socChangeKwh: number; usableKwh: number };
}

/**
 * Chronological 15-minute dispatch.
 *   SOC[t+1] = SOC[t] + charge[t] * etaCharge - discharge[t] / etaDischarge   (energies in kWh per interval)
 * Charging only from physically available surplus; discharging only into permitted bands and real deficits;
 * no simultaneous charge/discharge; MW limits; usable SOC window on degraded capacity; daily cycle cap;
 * no free initial energy (starts at SOC min). The final-vs-initial SOC difference is reported, not hidden.
 */
export function dispatchBess(bess: BessInput, yearIndex: number, surplusAvail: Float64Array, deficit: Float64Array, cal: Calendar, bandIds: string[]): BessDispatch {
  const n = cal.nIntervals;
  const charged = new Float64Array(n), delivered = new Float64Array(n);
  const soc = new Float32Array(n + 1);
  const capKwh = bess.energyMwh * 1000 * Math.pow(1 - bess.degradationPctPerYear / 100, Math.max(0, yearIndex));
  const socMin = bess.usableSocMin * capKwh, socMax = bess.usableSocMax * capKwh;
  const usable = Math.max(0, socMax - socMin);
  const pKwh = bess.powerMw * 1000 * 0.25; // kWh per 15-min at rated power
  const allowDischarge = bandIds.map((b) => bess.dischargeBands.includes(b));
  let s = socMin; soc[0] = s;
  let tc = 0, td = 0, taux = 0;
  let dayThroughput = 0, curDay = -1;
  const auxF = bess.auxPctOfThroughput / 100;
  for (let t = 0; t < n; t++) {
    const d = Math.floor(t / INTERVALS_PER_DAY);
    if (d !== curDay) { curDay = d; dayThroughput = 0; }
    const b = cal.bandOfInterval[t % INTERVALS_PER_DAY];
    const cycleRoom = Math.max(0, bess.maxCyclesPerDay * usable - dayThroughput);
    let c = 0, dis = 0;
    if (surplusAvail[t] > 0 && s < socMax - 1e-9) {
      c = Math.min(surplusAvail[t], pKwh, (socMax - s) / bess.etaCharge, cycleRoom / bess.etaCharge);
      if (c < 0) c = 0;
      s += c * bess.etaCharge; dayThroughput += c * bess.etaCharge;
    } else if (deficit[t] > 0 && allowDischarge[b] && s > socMin + 1e-9) {
      // discharge d (kWh out of the store) delivers d*etaDischarge*(1-aux) to the load
      const outFactor = bess.etaDischarge * (1 - auxF);
      dis = Math.min(deficit[t] / outFactor, pKwh / outFactor, s - socMin, cycleRoom);
      if (dis < 0) dis = 0;
      s -= dis; dayThroughput += dis;
      const gross = dis * bess.etaDischarge; const aux = gross * auxF;
      delivered[t] = gross - aux; taux += aux;
    }
    charged[t] = c; tc += c; td += delivered[t];
    soc[t + 1] = s;
  }
  const socChange = s - socMin;
  const losses = tc - td - taux - socChange;
  return { charged, delivered, soc, totals: { charged: tc, delivered: td, losses, aux: taux, cycles: usable > 0 ? tc * bess.etaCharge / usable : 0, socChangeKwh: socChange, usableKwh: usable } };
}
