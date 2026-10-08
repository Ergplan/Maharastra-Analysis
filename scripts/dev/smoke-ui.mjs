import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
const out = process.argv[2];
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' }).catch(async () => chromium.launch());
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
await page.goto('http://localhost:8765/index.html');
await page.waitForSelector('.kpi', { timeout: 60000 });
await page.waitForFunction(() => document.body.innerText.includes('exact ·'), null, { timeout: 90000 }).catch(() => errors.push('exact badge not reached'));
const tabs = await page.$$('.tabs button');
for (let i = 0; i < tabs.length; i++) {
  await tabs[i].click(); await page.waitForTimeout(1500);
  await page.screenshot({ path: `${out}/tab${i + 1}.png`, fullPage: true });
}
// exercise: find best allocation
await tabs[1].click(); await page.getByRole('button', { name: 'Find best allocation' }).click(); await page.waitForFunction(() => document.body.innerText.includes('Best evaluated'), null, { timeout: 120000 }).catch(() => errors.push('optimise did not finish'));
await page.screenshot({ path: `${out}/tab2-after-opt.png`, fullPage: true });
await tabs[3].click(); await page.getByRole('button', { name: 'Evaluate grid' }).click(); await page.waitForFunction(() => document.body.innerText.includes('Max-utilisation case'), null, { timeout: 180000 }).catch(() => errors.push('bess grid did not finish'));
await page.screenshot({ path: `${out}/tab4-grid.png`, fullPage: true });
await tabs[4].click(); await page.getByRole('button', { name: 'Run sensitivity' }).click(); await page.waitForFunction(() => document.body.innerText.includes('Generation −10%'), null, { timeout: 120000 }).catch(() => errors.push('sensitivity did not finish'));
await page.screenshot({ path: `${out}/tab5-sens.png`, fullPage: true });
const text = await page.innerText('body');
console.log(text.slice(0, 1500));
console.log('ERRORS', errors);
await browser.close();
