import fs from 'node:fs';
import { baseInput, type SeedCase } from '../../src/engine/seed.ts';
import { runScenario } from '../../src/engine/scenario.ts';
const seed = JSON.parse(fs.readFileSync('src/data/seed/seed_case.json', 'utf8')) as SeedCase;
const site = { latitude: seed.plant.latitude, longitude: seed.plant.longitude };
const fac = seed.consumers[0];
for (const r of [1.0, 1.3, 1.6, 2.0]) {
  // weights per hour: day (06-18) = r, night = 1
  const bandH = [[0,6],[6,9],[9,17],[17,24]];
  const w = bandH.map(([a,b]) => { let s=0; for (let h=a;h<b;h++) s += (h>=6 && h<18) ? r : 1; return s; });
  const tot = w.reduce((x,y)=>x+y,0); const shares = w.map(x=>x/tot);
  const inp = baseInput(seed, 'tod_block'); inp.financeMethod='scaled';
  inp.consumers = [{...fac, todShares:{value:shares, tag:'synthetic_estimate'}}, ...seed.consumers.slice(1)];
  const res = runScenario(inp, site);
  const s = res.consumers[0]; let acc=0; const out:string[]=[];
  for (let mi=0; mi<9; mi++){ const m=seed.calendar.months[mi]; const n=(new Date(Date.UTC(+m.slice(0,4),+m.slice(5,7),0)).getUTCDate())*96; let off=0; for(let t=acc;t<acc+n;t++) off+=s.settledOffset[t]; acc+=n; const bill=fac.monthly.find(x=>x.month===m)!; out.push(`${m.slice(5)}:${Math.round(off/1000)}/${Math.round((bill.oa_offset_kwh as number)/1000)}`); }
  console.log('ratio', r, shares.map(x=>x.toFixed(3)).join(','), out.join(' '));
}
