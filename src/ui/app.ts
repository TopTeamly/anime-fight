import { h, fmtTime, download } from './dom.js';
import { Engine } from '../scene/engine.js';
import { Timeline } from '../timeline/model.js';
import { buildFight } from '../timeline/fight.js';
import { TimelineUI } from './timelineUI.js';
import { Inspector } from './inspector.js';
import { LeftPanel } from './leftPanel.js';
import { snapshotPNG, recordWebM, exportFrames, exportWAV, saveTimeline, loadLocal, exportModels } from '../export/exporters.js';
import { deg } from '../utils/math.js';

/** Application shell: layout, transport, viewport HUD, keyboard shortcuts, render/save/load menus. */
export function startApp(root: HTMLElement) {
  const params = new URLSearchParams(location.search);
  const canvas = h('canvas', { class: 'vp-canvas' });
  const timeline = new Timeline(buildFight());
  const engine = new Engine(canvas, timeline, { msaa: Number(params.get('msaa') ?? 4), shadow: Number(params.get('shadow') ?? 2048), scale: Number(params.get('scale') ?? 1) });
  (window as any).__afe = engine;
  // developer / test hooks (used by tools/visual-test.mjs)
  (window as any).__seek = (t: number) => { engine.pause(); engine.seek(t); engine.renderFrame(t); return { state: [engine.evals.A.meters.state, engine.evals.B.meters.state], cam: engine.camera.shotAt(t)?.clip.params.shot, sub: engine.subtitle?.text, phase: engine.phase }; };
  (window as any).__sweep = (step = 1 / 20) => {
    const bad: string[] = [];
    const chk = (o: any): boolean => (typeof o === 'number' ? Number.isFinite(o) : Array.isArray(o) ? o.every(chk) : o && typeof o === 'object' ? Object.values(o).every(chk) : true);
    for (let t = 0; t < engine.duration; t += step) for (const w of ['A', 'B'] as const) { const e = engine.tracks[w].evaluate(t, 1); if (!chk(e.frame.pose) || !chk(e.frame.rootPos) || !Number.isFinite(e.frame.yaw)) bad.push(`${w}@${t.toFixed(2)}`); }
    return bad;
  };

  const tlui = new TimelineUI(engine);
  const inspector = new Inspector(engine, tlui);
  const left = new LeftPanel(engine);
  left.onNode = (n) => { tlui.select([]); inspector.showNode(n); };
  tlui.onSelect = (ids) => inspector.showClips(ids);

  // ---------------- top bar
  const timecode = h('span', { class: 'timecode' }, '00:00.00');
  const total = h('span', { class: 'timecode dim' }, '/ 00:00');
  const status = h('span', { class: 'status' }, '');
  const playBtn = h('button', { class: 'tp play', title: 'Play / Pause (Space)', onClick: () => toggle() }, '▶');
  const stopBtn = h('button', { class: 'tp', title: 'Stop (return to start)', onClick: () => { engine.stop(); } }, '■');
  const pauseBtn = h('button', { class: 'tp', title: 'Pause', onClick: () => engine.pause() }, '❚❚');
  const camSel = h('select', { title: 'Camera mode', onChange: (e: Event) => { engine.freeCam.enabled = (e.target as HTMLSelectElement).value === 'free'; } }, h('option', { value: 'director' }, 'Camera: Director'), h('option', { value: 'free' }, 'Camera: Free orbit'));
  const loopChk = h('input', { type: 'checkbox', onChange: (e: Event) => { engine.loop = (e.target as HTMLInputElement).checked; } });
  const lang = h('select', { title: 'Subtitle / speech language', onChange: (e: Event) => { engine.lang = (e.target as HTMLSelectElement).value as 'en' | 'ar'; engine.audio.lang = engine.lang; } }, h('option', { value: 'en' }, 'EN'), h('option', { value: 'ar' }, 'AR'));
  const vol = h('input', { type: 'range', min: 0, max: 1.2, step: 0.05, value: 0.8, class: 'volr', title: 'Master volume', onInput: (e: Event) => { engine.audio.volume.master = parseFloat((e.target as HTMLInputElement).value); engine.audio.applyVolumes(); } });
  const menu = renderMenu();
  const top = h('div', { class: 'topbar' },
    h('div', { class: 'brand' }, h('span', { class: 'logo' }, '斬'), h('b', {}, 'Anime Fight Engine'), h('span', { class: 'muted' }, ' prototype')),
    h('div', { class: 'transport' }, playBtn, pauseBtn, stopBtn, timecode, total),
    camSel, h('label', { class: 'chk' }, loopChk, 'Loop'), lang, vol,
    h('div', { class: 'spacer' }), status,
    h('button', { class: 'btn', title: 'Save timeline as JSON', onClick: () => { saveTimeline(engine); setStatus('Saved (downloaded + local storage)'); } }, 'Save'),
    h('button', { class: 'btn', title: 'Load a timeline JSON', onClick: () => fileIn.click() }, 'Load'),
    menu.button, h('button', { class: 'btn ghost', title: 'Help', onClick: () => help.classList.toggle('open') }, '?'));
  const fileIn = h('input', { type: 'file', accept: '.json', style: { display: 'none' }, onChange: async (e: Event) => { const f = (e.target as HTMLInputElement).files?.[0]; if (f) { try { load(JSON.parse(await f.text())); } catch (err) { setStatus('Load failed: ' + err); } } } });
  function load(d: any) { engine.pause(); timeline.load(d); engine.resolve(); engine.seek(0); tlui.fit(); setStatus('Loaded ' + d.name); }
  function setStatus(s: string) { status.textContent = s; clearTimeout((setStatus as any).t); (setStatus as any).t = setTimeout(() => { status.textContent = ''; }, 9000); }

  function renderMenu() {
    const pop = h('div', { class: 'popmenu' });
    const item = (label: string, sub: string, fn: () => void) => h('button', { onClick: () => { pop.classList.remove('open'); fn(); } }, h('b', {}, label), h('small', {}, sub));
    pop.append(
      item('Record video (WebM)', 'Real-time capture of the canvas + synthesised audio', () => recordWebM(engine, setStatus)),
      item('Snapshot (PNG)', 'Current frame', () => snapshotPNG(engine, `frame-${fmtTime(engine.tau).replace(/[:.]/g, '-')}.png`)),
      item('Frame sequence (PNG folder)', 'Deterministic offline rendering at 30 fps, 1920×1080 (Chrome / Edge)', () => exportFrames(engine, 30, 1920, (s) => setStatus(s))),
      item('Audio (WAV)', 'Offline render of SFX + music (speech excluded)', () => exportWAV(engine, setStatus)),
      item('Character models (OBJ)', 'Bind-pose meshes of Sael and Korran', () => exportModels(engine)),
    );
    const button = h('button', { class: 'btn primary', onClick: () => pop.classList.toggle('open') }, 'Render ▾');
    const wrap = h('div', { class: 'popwrap' }, button, pop);
    return { button: wrap };
  }

  // ---------------- viewport
  const subtitle = h('div', { class: 'subtitle' });
  const phase = h('div', { class: 'hud tl' });
  const stats = h('div', { class: 'hud tr' });
  const bigPlay = h('button', { class: 'bigplay', onClick: () => toggle() }, '▶');
  const vp = h('div', { class: 'viewport' }, h('div', { class: 'vp-frame' }, canvas, phase, stats, subtitle, bigPlay));
  const frame = vp.firstElementChild as HTMLElement;

  const help = h('div', { class: 'help' }, h('div', { class: 'help-in' },
    h('h3', {}, 'Anime Fight Engine · quick reference'),
    h('ul', {}, ...[
      'Space — play / pause · Home / End — jump · ← → — step one frame · Shift+← → — 1 second',
      'Timeline: click ruler to scrub · drag clip to move · drag its edges to trim · Shift-click multi-select',
      'Ctrl+D duplicate · Del delete · S split at playhead · Ctrl+Z / Ctrl+Y undo / redo · Ctrl+wheel zoom',
      '+ button on a track header adds a clip at the playhead · click a clip to edit every parameter in the Inspector',
      'Scene Graph → Character → rig controls: enable manual pose to drive IK/FK limbs, spine, eyes, fingers and the face',
      'Render menu: real WebM recording, PNG snapshot, deterministic PNG frame sequence, offline WAV, OBJ models',
    ].map((t) => h('li', {}, t))),
    h('p', { class: 'hint' }, 'The scene is a pure function of scene time: scrubbing, playing and exporting produce identical frames. Click anywhere to close.')));
  help.addEventListener('click', () => help.classList.remove('open'));

  // splitters
  const tlWrap = h('div', { class: 'tl-wrap' }, h('div', { class: 'splitter', onPointerdown: (e: PointerEvent) => { const y0 = e.clientY, h0 = tlh; const mv = (ev: PointerEvent) => { tlh = Math.min(560, Math.max(150, h0 + (y0 - ev.clientY))); rootEl.style.setProperty('--tlh', tlh + 'px'); resize(); tlui.render(); }; const up = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); }; window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up); } }), tlui.el);
  let tlh = 306;
  const rootEl = h('div', { class: 'app', style: { '--tlh': tlh + 'px' } as any }, top, left.el, vp, inspector.el, tlWrap, help, fileIn);
  root.append(rootEl);

  const resize = () => {
    const r = vp.getBoundingClientRect();
    let w = r.width - 16, hh = r.height - 16;
    if (w / hh > 16 / 9) w = hh * 16 / 9; else hh = w * 9 / 16;
    frame.style.width = Math.floor(w) + 'px'; frame.style.height = Math.floor(hh) + 'px';
    engine.resize(Math.floor(w * Math.min(2, window.devicePixelRatio || 1)), Math.floor(hh * Math.min(2, window.devicePixelRatio || 1)));
    if (!engine.playing) engine.renderFrame();
  };
  new ResizeObserver(resize).observe(vp);

  // ---------------- free camera
  let drag: null | { x: number; y: number; btn: number } = null;
  canvas.addEventListener('pointerdown', (e) => { if (!engine.freeCam.enabled) return; drag = { x: e.clientX, y: e.clientY, btn: e.button }; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener('pointerup', () => { drag = null; });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y; drag.x = e.clientX; drag.y = e.clientY;
    const f = engine.freeCam;
    if (drag.btn === 2) { const s = f.dist * 0.0018; f.target = [f.target[0] - Math.cos(f.yaw) * dx * s, f.target[1] + dy * s, f.target[2] + Math.sin(f.yaw) * dx * s]; }
    else { f.yaw -= dx * 0.006; f.pitch = Math.max(-1.4, Math.min(1.4, f.pitch + dy * 0.006)); }
    if (!engine.playing) engine.renderFrame();
  });
  canvas.addEventListener('wheel', (e) => { if (!engine.freeCam.enabled) return; e.preventDefault(); engine.freeCam.dist = Math.max(0.6, Math.min(200, engine.freeCam.dist * (e.deltaY > 0 ? 1.1 : 0.9))); if (!engine.playing) engine.renderFrame(); }, { passive: false });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  // ---------------- transport / keyboard
  async function toggle() { if (engine.playing) engine.pause(); else await engine.play(); }
  window.addEventListener('keydown', (e) => {
    const tag = (e.target as HTMLElement).tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    const k = e.key;
    if (k === ' ') { e.preventDefault(); toggle(); }
    else if (k === 'Home') engine.seek(0); else if (k === 'End') engine.seek(engine.duration);
    else if (k === 'ArrowLeft') { e.preventDefault(); engine.seek(engine.tau - (e.shiftKey ? 1 : 1 / 30)); }
    else if (k === 'ArrowRight') { e.preventDefault(); engine.seek(engine.tau + (e.shiftKey ? 1 : 1 / 30)); }
    else if (k === 'Delete' || k === 'Backspace') tlui.deleteSelected();
    else if ((e.ctrlKey || e.metaKey) && k.toLowerCase() === 'd') { e.preventDefault(); tlui.duplicateSelected(); }
    else if ((e.ctrlKey || e.metaKey) && k.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) timeline.redo(); else timeline.undo(); }
    else if ((e.ctrlKey || e.metaKey) && k.toLowerCase() === 'y') { e.preventDefault(); timeline.redo(); }
    else if (k.toLowerCase() === 's' && !e.ctrlKey && !e.metaKey) tlui.splitAtPlayhead();
    else if (k === '?') help.classList.toggle('open');
    if (!engine.playing) engine.renderFrame();
  });
  document.addEventListener('pointerdown', (e) => { const p = document.querySelector('.popmenu.open'); if (p && !(e.target as HTMLElement).closest('.popwrap')) p.classList.remove('open'); });
  engine.onEnd = () => { playBtn.textContent = '▶'; };

  // ---------------- main loop
  let statTick = 0;
  const loop = (now: number) => {
    engine.tick(now);
    if (engine.playing || engine.needsRender) { engine.renderFrame(); engine.needsRender = false; }
    timecode.textContent = fmtTime(engine.tau); total.textContent = '/ ' + fmtTime(engine.duration, false);
    playBtn.textContent = engine.playing ? '❚❚' : '▶'; playBtn.classList.toggle('on', engine.playing);
    frame.classList.toggle('paused', !engine.playing);
    const s = engine.subtitle;
    subtitle.textContent = s ? `${s.name}: ${s.text}` : ''; subtitle.className = 'subtitle' + (s ? ' on ' + s.speaker : '') + (engine.lang === 'ar' ? ' rtl' : '');
    phase.textContent = engine.phase;
    if (now - statTick > 300) { statTick = now; const R = engine.renderer; stats.textContent = `${engine.fpsSmooth.toFixed(0)} fps · ${R.width}×${R.height} · fx ${engine.vfx.stats.active} · particles ${engine.vfx.stats.particles}${engine.freeCam.enabled ? ' · FREE CAM' : ''}`; }
    requestAnimationFrame(loop);
  };
  tlui.fit();
  const saved = loadLocal();
  void saved; void download; void deg;
  requestAnimationFrame(loop);
  inspector.showNode({ kind: 'scene' });
  return engine;
}
