// Render docs/term-sheet.html to PDF with the local Playwright/Chromium: node scripts/dev/term-sheet-pdf.mjs <abs html> <abs pdf>
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
const [,, src, out] = process.argv;
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' }).catch(async () => chromium.launch());
const page = await browser.newPage();
await page.goto('file://' + src); await page.waitForTimeout(300);
await page.pdf({ path: out, format: 'A4', printBackground: true, preferCSSPageSize: true });
await page.setViewportSize({ width: 820, height: 1160 }); await page.screenshot({ path: out.replace('.pdf', '.png'), fullPage: true });
await browser.close(); console.log('ok');
