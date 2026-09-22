// End-to-end smoke test (optional dev tool; needs `npm i -D playwright` and a Chromium install).
//   node tools/visual-test.mjs           -> runs checks, writes screenshots to tools/out/
// It runs the real app in headless Chromium with software WebGL2, so it is slow but needs no GPU.
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import { serve } from '../scripts/serve.mjs';
import { root } from '../scripts/util.mjs';

const require = createRequire(import.meta.url);
let pw;
try { pw = require('playwright'); } catch { console.error('playwright is not installed: npm i -D playwright && npx playwright install chromium'); process.exit(2); }
const out = path.join(root, 'tools', 'out'); fs.mkdirSync(out, { recursive: true });
const server = await serve('public', 0);
const browser = await pw.chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1500, height: 860 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
await page.goto(`http://localhost:${server.address().port}/?msaa=0&shadow=1024&scale=0.4`);
await page.waitForFunction(() => window.__afe, null, { timeout: 60000 });
const results = [];
const check = (name, ok, extra = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${extra}`); };

const info = await page.evaluate(() => ({ dur: __afe.duration, real: __afe.warp.realDuration, clips: __afe.timeline.data.clips.length }));
check('scene is at least 3 minutes of continuous timeline', info.dur >= 180 && info.real >= 180, JSON.stringify(info));
check('numeric sweep: no NaN in any pose over the whole scene', (await page.evaluate(() => __sweep(1 / 12))).length === 0);

for (const t of [4, 15, 24, 57.7, 72, 99.5, 119.3, 134, 167, 176.5, 206.6, 212.3, 224.5, 250.35, 256, 268]) {
  await page.evaluate((tt) => __seek(tt), t);
  await page.waitForTimeout(120);
  await (await page.$('canvas')).screenshot({ path: path.join(out, `frame_${String(t).replace('.', '_')}.png`) });
}
check('rendered 16 key frames', true);

const play = await page.evaluate(async () => {
  const e = __afe; e.seek(40); await e.play();
  const t0 = e.tau; let now = performance.now();
  for (let i = 0; i < 30; i++) { now += 1000 / 30; e.tick(now); }   // synthetic 30 fps ticks (software GL is too slow for real-time here)
  const r = { advanced: e.tau - t0, audio: e.audio.running, scheduled: e.audio.stats.scheduled };
  e.pause(); return r;
});
check('playback advances the scene clock (1 s of ticks)', play.advanced > 0.85 && play.advanced < 1.3, JSON.stringify(play));
check('audio engine is running and scheduling', play.audio && play.scheduled >= 1, JSON.stringify(play));

const edit = await page.evaluate(() => {
  const tl = __afe.timeline, n0 = tl.data.clips.length;
  const c = tl.add({ track: 'vfx', type: 'flash', start: 10, dur: 0.2, params: { intensity: 1, color: '#ffffff' } });
  const d = tl.duplicate([c.id])[0];
  tl.update(d.id, { start: 12, dur: 0.4 });
  const moved = tl.get(d.id).start === 12;
  tl.remove([c.id, d.id]); const removed = tl.data.clips.length === n0;
  tl.undo(); const undone = tl.data.clips.length === n0 + 2; tl.redo();
  return { moved, removed, undone };
});
check('timeline: add / duplicate / move / delete / undo', edit.moved && edit.removed && edit.undone, JSON.stringify(edit));

const cpu = await page.evaluate(() => { const e = __afe, r = e.renderer, orig = r.render.bind(r); r.render = () => {}; const t0 = performance.now(); for (let i = 0; i < 90; i++) e.renderFrame(100 + i / 30); const ms = (performance.now() - t0) / 90; r.render = orig; return ms; });
check('CPU cost per frame (animation + VFX + camera) under 12 ms', cpu < 12, cpu.toFixed(2) + ' ms');
const wav = await page.evaluate(async () => { const b = await __afe.audio.renderOffline(8); let peak = 0; const d = b.getChannelData(0); for (let i = 0; i < d.length; i += 97) peak = Math.max(peak, Math.abs(d[i])); return { len: b.length, peak }; });
check('offline audio render produces sound', wav.len > 0 && wav.peak > 0.001, JSON.stringify(wav));

const rig = await page.evaluate(() => { const e = __afe; e.manual.A.enabled = true; e.manual.A.pose = JSON.parse(JSON.stringify(e.evals.A.frame.pose)); e.manual.A.pose.handL = [0.3, 1.8, 0.3]; e.renderFrame(); const y = e.A.rig.world('handL')[1]; e.manual.A.enabled = false; return y; });
check('manual rig override drives IK (hand raised)', rig > 1.5, String(rig));
await page.screenshot({ path: path.join(out, 'ui.png') });
check('no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close(); server.close();
process.exit(results.every((r) => r.ok) ? 0 : 1);
