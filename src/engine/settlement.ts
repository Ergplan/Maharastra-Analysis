import type { Calendar, ConsumerSettlement, RulePack, SettlementMode } from './types.ts';
import { INTERVALS_PER_DAY } from './calendar.ts';

/**
 * Settle one consumer's allocated solar against its load.
 *
 * Physical layer (always 15-minute): physicalDirect = min(load, solar); surplus/deficit per interval.
 * Settlement layer (billing credit):
 *   - 'interval_15min': chronological bank ledger inside the adjustment period (month); deposits of band b may be
 *     withdrawn in bands listed in rules.withdrawalMatrix[b]; withdrawals can never borrow from future deposits.
 *   - 'tod_block': within each (month, band) block, solar and load are netted (permissive block netting), then the
 *     remaining block surpluses may be withdrawn by other bands of the same month per the matrix (no chronology).
 * Unused deposits at period end are 'expired' (uncompensated) or 'compensated' at rules.expiredCompensationRsPerKwh.
 * Banking charge is taken in kind on deposits. Deposits are capped at bankCapPctOfConsumption of the period's load.
 *
 * `bessDelivered` (physical energy from a battery) reduces the deficit before any settlement credit; energy used to
 * charge a battery must already have been removed from `solar` by the caller (it is physical, not accounting surplus).
 */
export function settleConsumer(
  id: string, load: Float64Array, solar: Float64Array, bessDelivered: Float64Array | null,
  mode: SettlementMode, rules: RulePack, cal: Calendar,
): ConsumerSettlement {
  const n = cal.nIntervals;
  const nb = rules.todBands.length;
  const z = () => new Float64Array(n);
  const physicalDirect = z(), settledOffset = z(), bankWithdrawn = z(), bankDeposited = z(), gridBilled = z(), gridPhysical = z(), expired = z(), compensated = z(), bankingCharge = z();
  const bess = bessDelivered ?? z();
  const charge = rules.bankingAllowed ? rules.bankingChargePct / 100 : 0;
  const compRate = rules.expiredCompensationRsPerKwh;
  const permitted: boolean[][] = Array.from({ length: nb }, (_, dep) => Array.from({ length: nb }, (_, wd) =>
    rules.bankingAllowed && (rules.withdrawalMatrix[rules.todBands[dep].id] ?? []).includes(rules.todBands[wd].id)));

  // month boundaries in intervals
  const monthStart: number[] = []; const monthEnd: number[] = [];
  let cur = -1;
  for (let d = 0; d < cal.dayDates.length; d++) {
    const mi = cal.dayMonthIdx[d];
    if (mi !== cur) { if (cur >= 0) monthEnd.push(d * INTERVALS_PER_DAY); monthStart.push(d * INTERVALS_PER_DAY); cur = mi; }
  }
  monthEnd.push(n);

  for (let m = 0; m < monthStart.length; m++) {
    const s0 = monthStart[m], s1 = monthEnd[m];
    let monthLoad = 0; for (let t = s0; t < s1; t++) monthLoad += load[t];
    const cap = rules.bankCapPctOfConsumption / 100 * monthLoad;
    let depositedSoFar = 0;
    const bal = new Float64Array(nb); // bank balance by deposit band (this period)

    if (mode === 'interval_15min') {
      for (let t = s0; t < s1; t++) {
        const b = cal.bandOfInterval[t % INTERVALS_PER_DAY];
        const direct = Math.min(load[t], solar[t]);
        physicalDirect[t] = direct;
        let surplus = solar[t] - direct;
        let deficit = Math.max(0, load[t] - direct - bess[t]);
        gridPhysical[t] = deficit;
        // withdraw from permitted deposit bands (earliest band index first; all deposits are earlier in time)
        let wd = 0;
        if (deficit > 0) for (let dep = 0; dep < nb && deficit > 0; dep++) {
          if (!permitted[dep][b] || bal[dep] <= 0) continue;
          const take = Math.min(bal[dep], deficit); bal[dep] -= take; deficit -= take; wd += take;
        }
        bankWithdrawn[t] = wd;
        if (surplus > 0) {
          const fee = surplus * charge; bankingCharge[t] = fee; surplus -= fee;
          const room = Math.max(0, cap - depositedSoFar);
          const dep = rules.bankingAllowed ? Math.min(surplus, room) : 0;
          bal[b] += dep; depositedSoFar += dep; bankDeposited[t] = dep;
          const over = surplus - dep;
          if (compRate > 0) compensated[t] += over; else expired[t] += over;
        }
        settledOffset[t] = direct + wd;
        gridBilled[t] = Math.max(0, load[t] - settledOffset[t] - bess[t]);
      }
    } else {
      // tod_block: block totals first
      const S = new Float64Array(nb), L = new Float64Array(nb), D = new Float64Array(nb);
      for (let t = s0; t < s1; t++) {
        const b = cal.bandOfInterval[t % INTERVALS_PER_DAY];
        const direct = Math.min(load[t], solar[t]);
        physicalDirect[t] = direct; gridPhysical[t] = Math.max(0, load[t] - direct - bess[t]);
        S[b] += solar[t]; L[b] += Math.max(0, load[t] - bess[t]); D[b] += direct;
      }
      const blockOffset = new Float64Array(nb), surplusB = new Float64Array(nb), deficitB = new Float64Array(nb), feeB = new Float64Array(nb);
      for (let b = 0; b < nb; b++) {
        blockOffset[b] = Math.min(S[b], L[b]);
        surplusB[b] = S[b] - blockOffset[b]; deficitB[b] = L[b] - blockOffset[b];
        // banking charge applies to energy that leaves the block as a deposit
        feeB[b] = surplusB[b] * charge; surplusB[b] -= feeB[b];
      }
      // cross-band withdrawals per matrix (cap applies to deposits leaving their own block)
      const crossCredit = new Float64Array(nb), crossOut = new Float64Array(nb);
      for (let dep = 0; dep < nb; dep++) {
        let avail = Math.min(surplusB[dep], Math.max(0, cap - depositedSoFar));
        const unbankable = surplusB[dep] - avail;
        for (let wd = 0; wd < nb && avail > 0; wd++) {
          if (wd === dep || !permitted[dep][wd] || deficitB[wd] <= 0) continue;
          const take = Math.min(avail, deficitB[wd]); avail -= take; deficitB[wd] -= take; crossCredit[wd] += take; crossOut[dep] += take; depositedSoFar += take;
        }
        surplusB[dep] = avail + unbankable; // leftover expires
      }
      // distribute block results back onto intervals (proportional to each interval's deficit / surplus)
      const defSum = new Float64Array(nb), surSum = new Float64Array(nb);
      for (let t = s0; t < s1; t++) { const b = cal.bandOfInterval[t % INTERVALS_PER_DAY]; defSum[b] += Math.max(0, load[t] - physicalDirect[t] - bess[t]); surSum[b] += solar[t] - physicalDirect[t]; }
      for (let t = s0; t < s1; t++) {
        const b = cal.bandOfInterval[t % INTERVALS_PER_DAY];
        const def = Math.max(0, load[t] - physicalDirect[t] - bess[t]);
        const sur = solar[t] - physicalDirect[t];
        const withinBlockCredit = blockOffset[b] - D[b]; // netting credit beyond physical simultaneity
        const credit = defSum[b] > 0 ? (withinBlockCredit + crossCredit[b]) * def / defSum[b] : 0;
        bankWithdrawn[t] = credit;
        settledOffset[t] = physicalDirect[t] + credit;
        gridBilled[t] = Math.max(0, load[t] - settledOffset[t] - bess[t]);
        if (surSum[b] > 0) {
          const share = sur / surSum[b];
          bankDeposited[t] = (withinBlockCredit + crossOut[b]) * share;
          bankingCharge[t] = feeB[b] * share;
          const over = surplusB[b] * share;
          if (compRate > 0) compensated[t] += over; else expired[t] += over;
        }
      }
      for (let b = 0; b < nb; b++) bal[b] = 0;
    }
    // period end: remaining balances lapse / are compensated (booked at the last interval of the month)
    let rem = 0; for (let b = 0; b < nb; b++) rem += bal[b];
    if (rem > 0) { if (compRate > 0) compensated[s1 - 1] += rem; else expired[s1 - 1] += rem; }
  }

  const sum = (a: Float64Array) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i]; return s; };
  const totals = {
    load: sum(load), solar: sum(solar), physicalDirect: sum(physicalDirect), settledOffset: sum(settledOffset), bankWithdrawn: sum(bankWithdrawn),
    bankDeposited: sum(bankDeposited), gridBilled: sum(gridBilled), gridPhysical: sum(gridPhysical), bess: sum(bess), expired: sum(expired), compensated: sum(compensated), bankingCharge: sum(bankingCharge),
  };
  return { id, load, solarDelivered: solar, physicalDirect, settledOffset, bankWithdrawn, bankDeposited, gridBilled, gridPhysical, bessDelivered: bess, expired, compensated, bankingCharge, totals };
}
