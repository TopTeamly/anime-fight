// Dev helper: node tools/shot.mjs <outDir> '<js expr>' [more exprs...]
// Loads the app in headless Chromium (software WebGL), evaluates each expression and saves a screenshot per expression.
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import { serve } from '../scripts/serve.mjs';
const require = createRequire(import.meta.url);
let pw;
try { pw = require('playwright'); } catch { console.error('playwright is not installed (npm i -D playwright)'); process.exit(2); }
const out = process.argv[2]; fs.mkdirSync(out, { recursive: true });
const exprs = process.argv.slice(3);
const server = await serve('public', 0);
const port = server.address().port;
const browser = await pw.chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: Number(process.env.VW || 1400), height: Number(process.env.VH || 800) } });
const logs = [];
page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) logs.push(m.type() + ': ' + m.text().slice(0, 600)); });
page.on('pageerror', (e) => logs.push('PAGEERROR: ' + e.message.slice(0, 900)));
await page.goto(`http://localhost:${port}/${process.env.QS || ''}`);
await page.waitForTimeout(1500);
let i = 0;
for (const e of exprs) {
  const t0 = Date.now();
  try { const r = await page.evaluate(e); if (r !== undefined) console.log('eval', i, '->', JSON.stringify(r).slice(0, 400)); } catch (err) { console.log('eval error', err.message.slice(0, 600)); }
  await page.waitForTimeout(150);
  const el = process.env.FULL ? null : await page.$('canvas');
  await (el || page).screenshot({ path: path.join(out, `s${i}.png`) });
  console.log(`shot ${i} (${Date.now() - t0}ms)`);
  i++;
}
console.log(logs.length ? 'LOGS:\n' + [...new Set(logs)].join('\n') : 'no console errors');
await browser.close(); server.close();
