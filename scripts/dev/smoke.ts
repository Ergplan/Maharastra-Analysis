import fs from 'node:fs';
import { baseInput, type SeedCase } from '../../src/engine/seed.ts';
import { runScenario } from '../../src/engine/scenario.ts';
const seed = JSON.parse(fs.readFileSync('src/data/seed/seed_case.json', 'utf8')) as SeedCase;
const site = { latitude: seed.plant.latitude, longitude: seed.plant.longitude };
for (const mode of ['tod_block', 'interval_15min'] as const) {
  const inp = baseInput(seed, mode);
  const t0 = Date.now();
  const r = runScenario(inp, site);
  console.log('\n===', mode, 'perf ms', Math.round(r.perfMs), 'wall', Date.now() - t0);
  console.log('export', Math.round(r.plant.exportKwh), 'obs', Math.round(r.plant.observedExportKwh), 'flatAnn', Math.round(r.plant.annualisedFlatKwh), 'acFlags', r.plant.acCeilingFlags);
  console.log('bridge', Object.fromEntries(Object.entries(r.bridge).map(([k, v]) => [k, Math.round(v as number)])));
  for (const e of r.economics) console.log(e.id, 'load', Math.round(e.loadKwh), 'offset', Math.round(e.offsetKwh), 'grid', Math.round(e.gridBilledKwh), 'A', Math.round(e.avoidedEnergyChargesRs / 1e5) / 10, 'L  B', Math.round(e.netProcurementSavingRs / 1e5) / 10, 'L  C', Math.round(e.broaderVariableSavingRs / 1e5) / 10, 'L landed', e.landedSolarRsPerKwh.toFixed(2), 'avoided', e.avoidedGridRsPerKwh.toFixed(2));
  console.log('spv', Object.fromEntries(Object.entries(r.spv).map(([k, v]) => [k, Math.round((v as number) / 1e5) / 10 + 'L'])));
  console.log('fullLife NPV cr', (r.finance.fullLife.npvRs / 1e7).toFixed(2), 'IRR', r.finance.fullLife.irr, r.finance.fullLife.irrNote, '| owner NPV cr', (r.finance.consolidatedOwner.npvRs / 1e7).toFixed(2));
  console.log('monthly', r.monthly.map((m) => `${m.month.slice(2)}: exp ${Math.round(m.export / 1000)}k dir ${Math.round(m.direct / 1000)}k bw ${Math.round(m.bankWithdrawn / 1000)}k exp ${Math.round(m.expired / 1000)}k un ${Math.round(m.unallocated / 1000)}k grid ${Math.round(m.grid / 1000)}k`).join('\n  '));
  console.log('warnings', r.warnings);
  // calibration vs bills for factory
  const fac = seed.consumers[0];
  const s = r.consumers[0];
  console.log('factory month offset engine vs bill:');
  let acc = 0;
  for (let mi = 0; mi < 12; mi++) {
    const m = seed.calendar.months[mi];
    const bill = fac.monthly.find((x) => x.month === m);
    // sum settledOffset for month
    let off = 0, grid = 0, load = 0;
    const days = r.monthly[mi];
    void days;
    // recompute by scanning intervals of this month
    const start = acc; const n = (new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7), 0)).getUTCDate()) * 96;
    for (let t = start; t < start + n; t++) { off += s.settledOffset[t]; grid += s.gridBilled[t]; load += s.load[t]; }
    acc += n;
    console.log(' ', m, 'load', Math.round(load), 'offset', Math.round(off), 'grid', Math.round(grid), '| bill drawal', bill?.drawal_kwh, 'offset', bill?.oa_offset_kwh, 'grid', bill?.grid_kwh);
  }
}
