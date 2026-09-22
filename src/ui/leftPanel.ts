import { h, clear } from './dom.js';
import type { Engine } from '../scene/engine.js';
import { SCENES } from '../scenes/registry.js';
import { exportModels } from '../export/exporters.js';
import { BONE_NAMES } from '../characters/rig.js';
import type { NodeRef } from './inspector.js';
import type { TimelineData } from '../timeline/model.js';

type Tab = 'scenes' | 'characters' | 'environment' | 'assets' | 'graph';

export class LeftPanel {
  el: HTMLElement;
  private body: HTMLElement;
  private tab: Tab = 'graph';
  onNode: (n: NodeRef) => void = () => undefined;
  onSceneLoaded: () => void = () => undefined;
  private liveFn: (() => void) | null = null;

  constructor(private engine: Engine) {
    this.body = h('div', { class: 'lp-body' });
    const tabs = h('div', { class: 'tabs' });
    (['graph', 'scenes', 'characters', 'environment', 'assets'] as Tab[]).forEach((t) => tabs.append(h('button', { class: 'tab' + (t === this.tab ? ' on' : ''), onClick: (e: Event) => { this.tab = t; tabs.querySelectorAll('.tab').forEach((b) => b.classList.remove('on')); (e.target as HTMLElement).classList.add('on'); this.render(); } }, t === 'graph' ? 'Scene Graph' : t[0].toUpperCase() + t.slice(1))));
    this.el = h('div', { class: 'panel left' }, tabs, this.body);
    engine.timeline.onChange((k) => { if (k === 'load') this.render(); });
    setInterval(() => this.liveFn?.(), 500);
    this.render();
  }

  render() {
    clear(this.body); this.liveFn = null;
    ({ scenes: () => this.scenes(), characters: () => this.characters(), environment: () => this.environment(), assets: () => this.assets(), graph: () => this.graph() })[this.tab]();
  }

  private graph() {
    const E = this.engine;
    const node = (label: string, ref: NodeRef | null, extra?: string, kids?: HTMLElement[]) => {
      const row = h('div', { class: 'tn', onClick: () => ref && this.onNode(ref) }, h('span', { class: 'tnl' }, label), extra ? h('span', { class: 'muted' }, ' ' + extra) : null);
      return kids && kids.length ? h('details', { open: true }, h('summary', {}, row), h('div', { class: 'tk' }, kids)) : h('div', { class: 'leaf' }, row);
    };
    const bones = (f: typeof E.A) => h('details', {}, h('summary', {}, h('span', { class: 'tnl' }, 'Skeleton'), h('span', { class: 'muted' }, ` ${f.skel.n} bones`)), h('div', { class: 'tk bonelist' }, BONE_NAMES.map((b) => h('span', { class: 'bone' }, b))));
    const clipsOf = (tr: string) => E.timeline.data.clips.filter((c) => c.track === tr).length;
    const char = (w: 'A' | 'B') => { const f = w === 'A' ? E.A : E.B; return node(`Character ${w} · ${f.spec.name}`, { kind: w === 'A' ? 'charA' : 'charB' }, '', [bones(f), node('Animation', { kind: w === 'A' ? 'charA' : 'charB' }, `${clipsOf(w === 'A' ? 'charA' : 'charB')} clips · state machine`), node('VFX', { kind: 'vfx' }, 'aura · trails · afterimages')]); };
    this.body.append(h('div', { class: 'tree' }, node('Scene', { kind: 'scene' }, E.timeline.data.name, [
      node('Environment', { kind: 'environment' }, '', [node('Terrain', { kind: 'environment' }, `${E.terrain.triangles} tris`), node('Sky & clouds', { kind: 'lighting' }), node('Rocks & pillars', { kind: 'environment' }, `${E.rocks.instances.length} instances`), node('Damage', { kind: 'environment' }, 'craters · cracks')]),
      char('A'), char('B'),
      node('Camera', { kind: 'camera' }, `${clipsOf('camera')} shots`), node('Lighting', { kind: 'lighting' }, `${clipsOf('lighting')} keys`),
      node('Audio', { kind: 'audio' }, 'sfx · voice · music'), node('Effects', { kind: 'vfx' }, `${clipsOf('vfx')} fx`),
    ])));
  }

  private scenes() {
    const E = this.engine;
    for (const s of SCENES) this.body.append(h('div', { class: 'card' }, h('b', {}, s.name), h('p', { class: 'hint' }, s.description), h('button', { onClick: () => this.load(s.build()) }, 'Load scene')));
    const file = h('input', { type: 'file', accept: '.json,application/json', style: { display: 'none' }, onChange: async (e: Event) => { const f = (e.target as HTMLInputElement).files?.[0]; if (!f) return; try { this.load(JSON.parse(await f.text())); } catch (err) { alert('Could not read scene: ' + err); } } });
    this.body.append(h('div', { class: 'card' }, h('b', {}, 'Import'), h('p', { class: 'hint' }, 'Load a saved .afe.json scene (Save exports the current timeline).'), file, h('button', { onClick: () => file.click() }, 'Import JSON…')));
    this.body.append(h('div', { class: 'card' }, h('b', {}, 'Current'), h('p', { class: 'hint' }, `${E.timeline.data.name} · ${E.timeline.data.clips.length} clips · ${E.duration.toFixed(0)} s`)));
  }
  private load(d: TimelineData) { this.engine.pause(); this.engine.timeline.load(d); this.engine.resolve(); this.engine.seek(0); this.onSceneLoaded(); this.render(); }

  private characters() {
    const E = this.engine;
    for (const w of ['A', 'B'] as const) {
      const f = w === 'A' ? E.A : E.B, s = f.spec;
      this.body.append(h('div', { class: 'card' },
        h('div', { class: 'swatches' }, ...[s.skin, s.hair, s.top, s.topAccent, s.pants, s.iris].map((c) => h('i', { style: { background: c } }))),
        h('b', {}, `${s.name}`), h('span', { class: 'muted' }, ` · character ${w}`),
        h('p', { class: 'hint' }, w === 'A' ? 'Calm, precise, reaction-based. Silver hair, charcoal tunic. Power state: white-gold aura.' : 'Confident, aggressive, energy-based. Blue spiked hair, indigo vest. Rage: crimson eyes.'),
        h('div', { class: 'btns' }, h('button', { onClick: () => this.onNode({ kind: w === 'A' ? 'charA' : 'charB' }) }, 'Inspect / rig'), h('button', { onClick: () => { E.freeCam.enabled = true; E.freeCam.target = f.point('chest'); E.freeCam.dist = 3.2; E.freeCam.yaw = f.frame.yaw + 0.6; E.freeCam.pitch = 0.12; if (!E.playing) E.renderFrame(); } }, 'Focus camera')),
        h('p', { class: 'hint' }, `${f.body.vertexCount} vertices · ${f.bodyMB.idx.length / 3} triangles · ${f.skel.n} bones · ${s.clumps.length} hair clumps · ${s.cloth.length} cloth strips`)));
    }
    this.body.append(h('div', { class: 'card' }, h('b', {}, 'Export models'), h('p', { class: 'hint' }, 'Bind-pose meshes as Wavefront OBJ (with vertex colours).'), h('button', { onClick: () => exportModels(E) }, 'Download OBJ ×2')));
  }

  private environment() {
    const E = this.engine, rd = h('pre', { class: 'readout' });
    this.body.append(h('div', { class: 'card' }, h('b', {}, 'Wasteland arena'), h('p', { class: 'hint' }, 'Polar terrain mesh (denser near the fight), terraced cliffs, rock pillars, instanced boulders with two LOD levels, toon clouds and dusk sky. Craters, cracks, shattering boulders and toppling pillars are all driven by timeline events, so damage accumulates as the fight goes on.')), rd);
    const list = h('div', { class: 'card' }, h('b', {}, 'Environment events'));
    for (const c of E.timeline.data.clips.filter((x) => x.track === 'environment' && x.type !== 'wind').slice(0, 40)) list.append(h('button', { class: 'link', onClick: () => E.seek(Math.max(0, c.start - 1.2)) }, `${c.start.toFixed(1)}s  ${c.type}`));
    this.body.append(list);
    this.liveFn = () => { rd.textContent = `terrain tris   ${E.terrain.triangles}\nrock instances ${E.rocks.instances.length} (${E.rocks.drawn} drawn)\ncraters        ${E.damage.craters.length}\ncracks         ${E.damage.cracks.length}\nwind           ${E.windAt(E.tau).toFixed(2)}`; };
    this.liveFn();
  }

  private assets() {
    const E = this.engine, rd = h('pre', { class: 'readout wide' });
    this.body.append(h('div', { class: 'card' }, h('b', {}, 'Asset manager'), h('p', { class: 'hint' }, 'Everything is generated procedurally at start-up: no external art, audio or video files are needed. Items marked lazy are created only when first used.')), rd);
    this.liveFn = () => {
      const mb = (n: number) => (n / 1048576).toFixed(1) + ' MB';
      const R = E.renderer;
      rd.textContent = [
        `[loaded] terrain mesh      ${E.terrain.triangles} tris`,
        `[loaded] rock meshes       4 (2 kinds × 2 LOD), ${E.rocks.instances.length} instances`,
        `[loaded] fighter meshes    ${E.A.body.vertexCount + E.B.body.vertexCount} verts`,
        `[loaded] particle pool     ${E.vfx.stats.particles} live (cap 40000)`,
        `[loaded] debris pool       ${E.vfx.stats.debris} live (cap 4200)`,
        `[loaded] shadow map        ${R.shadow.size}² (${mb(R.shadow.size ** 2 * 4)})`,
        `[loaded] HDR target        ${R.width}×${R.height}`,
        `[lazy ] audio synth kit    ${E.audio.ctx ? 'created' : 'created on first Play'}`,
        `[lazy ] offline audio      on Render → WAV`,
        `[lazy ] speech voices      ${'speechSynthesis' in window ? 'on demand' : 'unavailable'}`,
        `[lazy ] video recorder     on Render → WebM`,
      ].join('\n');
    };
    this.liveFn();
  }
}
