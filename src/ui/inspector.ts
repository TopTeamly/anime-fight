import { h, clear, slider, fmtTime } from './dom.js';
import type { Engine } from '../scene/engine.js';
import type { TimelineUI } from './timelineUI.js';
import { clipTypeDef, type ParamDef } from '../timeline/clipTypes.js';
import { EXPRESSIONS, clonePose, type Pose, type FKOverride, type FaceParams, type ExpressionName } from '../animation/pose.js';
import { deg } from '../utils/math.js';

export type NodeRef = { kind: 'scene' | 'charA' | 'charB' | 'camera' | 'lighting' | 'audio' | 'environment' | 'vfx' | 'clips' };

const R3 = (a: number[]) => a.map((v) => Math.round(v * 100) / 100);

export class Inspector {
  el: HTMLElement;
  private body: HTMLElement;
  private live: (() => void) | null = null;
  private node: NodeRef = { kind: 'scene' };
  private clipIds: string[] = [];

  constructor(private engine: Engine, private tl: TimelineUI) {
    this.body = h('div', { class: 'insp-body' });
    this.el = h('div', { class: 'panel inspector' }, h('div', { class: 'panel-title' }, 'Inspector'), this.body);
    engine.timeline.onChange((k) => { if (k === 'load') this.showNode({ kind: 'scene' }); else if (this.clipIds.length) this.refreshClipFields(); });
    setInterval(() => this.live?.(), 250);
  }

  showNode(n: NodeRef) { this.node = n; this.clipIds = []; clear(this.body); this.live = null; this.buildNode(n); }
  showClips(ids: string[]) {
    this.clipIds = ids;
    if (!ids.length) { this.showNode(this.node.kind === 'clips' ? { kind: 'scene' } : this.node); return; }
    this.node = { kind: 'clips' };
    this.buildClips(ids);
  }
  private refreshClipFields() { /* values are read on build; edits update the model directly */ }

  // ------------------------------------------------------------------ clip inspector
  private buildClips(ids: string[]) {
    clear(this.body); this.live = null;
    const tl = this.engine.timeline;
    const clips = ids.map((i) => tl.get(i)).filter(Boolean) as NonNullable<ReturnType<typeof tl.get>>[];
    if (!clips.length) return;
    const c = clips[0], def = clipTypeDef(c.type);
    this.body.append(h('div', { class: 'ins-head' }, h('span', { class: 'dot', style: { background: def?.color } }), h('b', {}, def?.label ?? c.type), h('span', { class: 'muted' }, ` · ${c.track}${clips.length > 1 ? ` · +${clips.length - 1} more` : ''}`)));
    if (def?.desc) this.body.append(h('p', { class: 'hint' }, def.desc));
    const num = (label: string, get: () => number, set: (v: number) => void) => {
      const inp = h('input', { type: 'number', step: 0.05, value: get().toFixed(2), onChange: (e: Event) => { tl.checkpoint(); set(parseFloat((e.target as HTMLInputElement).value) || 0); } });
      return h('label', { class: 'row' }, h('span', { class: 'lbl' }, label), inp);
    };
    this.body.append(num('Start (s)', () => c.start, (v) => clips.forEach((k) => tl.update(k.id, { start: v }))), num('Duration (s)', () => c.dur, (v) => clips.forEach((k) => tl.update(k.id, { dur: v }))));
    this.body.append(h('label', { class: 'row' }, h('span', { class: 'lbl' }, 'Label'), h('input', { type: 'text', value: c.label ?? '', placeholder: '(auto)', onChange: (e: Event) => tl.update(c.id, { label: (e.target as HTMLInputElement).value || undefined }, true) })));
    for (const p of def?.params ?? []) this.body.append(this.paramField(p, c.params[p.key] ?? p.def, (v) => { tl.checkpoint(); clips.forEach((k) => tl.update(k.id, { params: { [p.key]: v } })); }));
    this.body.append(h('div', { class: 'btns' },
      h('button', { onClick: () => this.tl.duplicateSelected() }, 'Duplicate'), h('button', { onClick: () => this.tl.splitAtPlayhead() }, 'Split @ playhead'), h('button', { class: 'danger', onClick: () => this.tl.deleteSelected() }, 'Delete'),
      h('button', { onClick: () => this.engine.seek(c.start) }, 'Go to start')));
  }

  private paramField(p: ParamDef, val: any, set: (v: any) => void): HTMLElement {
    const lbl = h('span', { class: 'lbl' }, p.label);
    switch (p.kind) {
      case 'number': return slider(p.label, p.min ?? 0, p.max ?? 1, p.step ?? 0.01, Number(val ?? 0), set, (v) => (p.step && p.step >= 1 ? String(Math.round(v)) : v.toFixed(2)));
      case 'select': return h('label', { class: 'row' }, lbl, h('select', { onChange: (e: Event) => set((e.target as HTMLSelectElement).value) }, ...(p.options ?? []).map((o) => h('option', { value: o, selected: o === val }, o))));
      case 'bool': return h('label', { class: 'row' }, lbl, h('input', { type: 'checkbox', checked: !!val, onChange: (e: Event) => set((e.target as HTMLInputElement).checked) }));
      case 'color': return h('label', { class: 'row' }, lbl, h('input', { type: 'color', value: String(val ?? '#ffffff'), onInput: (e: Event) => set((e.target as HTMLInputElement).value) }));
      case 'text': return h('label', { class: 'row col' }, lbl, h('textarea', { rows: p.multiline ? 2 : 1, value: String(val ?? ''), dir: 'auto', onChange: (e: Event) => set((e.target as HTMLTextAreaElement).value) }));
      case 'vec3': { const a: number[] = Array.isArray(val) ? [...val] : [0, 0, 0]; return h('div', { class: 'row' }, lbl, ...[0, 1, 2].map((i) => h('input', { type: 'number', class: 'v3', step: 0.1, value: a[i] ?? 0, onChange: (e: Event) => { a[i] = parseFloat((e.target as HTMLInputElement).value) || 0; set([...a]); } }))); }
      default: return h('div');
    }
  }

  // ------------------------------------------------------------------ node inspectors
  private buildNode(n: NodeRef) {
    const E = this.engine;
    if (n.kind === 'charA' || n.kind === 'charB') return this.buildChar(n.kind === 'charA' ? 'A' : 'B');
    const title = { scene: 'Scene', camera: 'Camera', lighting: 'Lighting', audio: 'Audio', environment: 'Environment', vfx: 'VFX', clips: '' }[n.kind];
    this.body.append(h('div', { class: 'ins-head' }, h('b', {}, title)));
    const rd = h('pre', { class: 'readout' });
    if (n.kind === 'scene') {
      const d = E.timeline.data;
      this.body.append(h('label', { class: 'row' }, h('span', { class: 'lbl' }, 'Name'), h('input', { type: 'text', value: d.name, onChange: (e: Event) => { d.name = (e.target as HTMLInputElement).value; } })));
      this.body.append(h('label', { class: 'row' }, h('span', { class: 'lbl' }, 'Duration (s)'), h('input', { type: 'number', value: d.duration, step: 1, onChange: (e: Event) => { d.duration = Math.max(5, parseFloat((e.target as HTMLInputElement).value) || d.duration); E.resolve(); } })));
      this.body.append(h('label', { class: 'row' }, h('span', { class: 'lbl' }, 'Subtitles'), h('select', { onChange: (e: Event) => { E.lang = (e.target as HTMLSelectElement).value as 'en' | 'ar'; E.audio.lang = E.lang; } }, h('option', { value: 'en', selected: E.lang === 'en' }, 'English'), h('option', { value: 'ar', selected: E.lang === 'ar' }, 'العربية'))));
      this.body.append(h('label', { class: 'row' }, h('span', { class: 'lbl' }, 'Speech voices'), h('input', { type: 'checkbox', checked: E.audio.speechEnabled, onChange: (e: Event) => { E.audio.speechEnabled = (e.target as HTMLInputElement).checked; } })));
      this.body.append(h('label', { class: 'row' }, h('span', { class: 'lbl' }, 'Show rig'), h('input', { type: 'checkbox', checked: E.showRig, onChange: (e: Event) => { E.showRig = (e.target as HTMLInputElement).checked; if (!E.playing) E.renderFrame(); } })));
      const q = E.renderer.quality;
      this.body.append(h('div', { class: 'sec' }, 'Quality'));
      this.body.append(slider('Resolution scale', 0.5, 2, 0.25, q.scale, (v) => { E.setQuality({ scale: v }); E.resize(E.renderer.canvas.clientWidth, E.renderer.canvas.clientHeight); }));
      this.body.append(h('label', { class: 'row' }, h('span', { class: 'lbl' }, 'Shadow map'), h('select', { onChange: (e: Event) => E.setQuality({ shadow: parseInt((e.target as HTMLSelectElement).value) }) }, ...[1024, 2048, 4096].map((s) => h('option', { value: s, selected: s === q.shadow }, s + ' px')))));
      this.body.append(h('label', { class: 'row' }, h('span', { class: 'lbl' }, 'MSAA'), h('select', { onChange: (e: Event) => E.setQuality({ msaa: parseInt((e.target as HTMLSelectElement).value) }) }, ...[0, 4].map((s) => h('option', { value: s, selected: s === q.msaa }, s ? s + '×' : 'off')))));
      this.body.append(slider('Particle budget', 0.1, 1, 0.1, q.particles, (v) => E.setQuality({ particles: v })));
      this.body.append(h('div', { class: 'sec' }, 'Live'), rd);
    } else if (n.kind === 'camera') {
      this.body.append(h('label', { class: 'row' }, h('span', { class: 'lbl' }, 'Free orbit camera'), h('input', { type: 'checkbox', checked: E.freeCam.enabled, onChange: (e: Event) => { E.freeCam.enabled = (e.target as HTMLInputElement).checked; if (!E.playing) E.renderFrame(); } })));
      this.body.append(h('p', { class: 'hint' }, 'Free camera: drag = orbit, wheel = zoom, right-drag = pan. Director camera follows the Camera track shots.'), h('div', { class: 'sec' }, 'Live'), rd);
    } else if (n.kind === 'lighting') this.body.append(h('p', { class: 'hint' }, 'Values at the playhead. Edit the Lighting track keys to change them.'), rd);
    else if (n.kind === 'audio') {
      const a = E.audio;
      this.body.append(slider('Master', 0, 1.2, 0.05, a.volume.master, (v) => { a.volume.master = v; a.applyVolumes(); }), slider('Music', 0, 1, 0.05, a.volume.music, (v) => { a.volume.music = v; a.applyVolumes(); }), slider('SFX', 0, 1.5, 0.05, a.volume.sfx, (v) => { a.volume.sfx = v; a.applyVolumes(); }), slider('Voice', 0, 1.5, 0.05, a.volume.voice, (v) => { a.volume.voice = v; a.applyVolumes(); }));
      this.body.append(h('div', { class: 'sec' }, 'Live'), rd);
    } else this.body.append(h('div', { class: 'sec' }, 'Live'), rd);
    this.live = () => {
      const t = E.tau;
      if (n.kind === 'scene') rd.textContent = `scene time  ${fmtTime(t)}\nreal time   ${fmtTime(E.realT)}\nphase       ${E.phase || '-'}\nclips       ${E.timeline.data.clips.length}\nfps         ${E.fpsSmooth.toFixed(0)}\ndraw ms     ${E.renderer.stats.lastFrameMs.toFixed(1)}`;
      if (n.kind === 'camera' && E.camState) { const c = E.camState, s = E.camera.shotAt(t)?.clip; rd.textContent = `shot        ${s?.params.shot ?? '-'} (#${E.camera.shotAt(t)?.index ?? '-'})\nsubject     ${s?.params.subject ?? '-'}\npos         ${R3(c.pos).join(', ')}\ntarget      ${R3(c.target).join(', ')}\nfov         ${deg(c.fov).toFixed(1)}°\nshake       ${E.camera.shakeAt(t).toFixed(3)}`; }
      if (n.kind === 'lighting') { const L = E.light; rd.textContent = `sun dir     ${R3(L.sunDir).join(', ')}\nsun col     ${R3(L.sunCol).join(', ')}\nexposure    ${L.exposure.toFixed(2)}\nbloom       ${L.bloom.toFixed(2)}\ncontrast    ${L.contrast.toFixed(2)}\nsaturation  ${L.saturation.toFixed(2)}\nfog density ${L.fogDen.toFixed(4)}`; }
      if (n.kind === 'audio') rd.textContent = `state       ${E.audio.running ? 'running' : 'idle'}\nscheduled   ${E.audio.stats.scheduled} sfx / ${E.audio.stats.notes} notes\nreal length ${fmtTime(E.warp.realDuration)}\nspeech      ${'speechSynthesis' in window ? 'available' : 'unavailable'}`;
      if (n.kind === 'environment') rd.textContent = `terrain tris ${E.terrain.triangles}\nrocks drawn  ${E.rocks.drawn}\ncraters      ${E.damage.craters.length}\ncracks       ${E.damage.cracks.length}\nwind         ${E.windAt(t).toFixed(2)}`;
      if (n.kind === 'vfx') rd.textContent = `active fx    ${E.vfx.stats.active}\nparticles    ${E.vfx.stats.particles}\ndebris       ${E.vfx.stats.debris}\nribbons      ${Math.round(E.vfx.stats.ribbons)}`;
    };
    this.live();
  }

  // ------------------------------------------------------------------ character inspector (state machine + rig controls)
  private buildChar(w: 'A' | 'B') {
    const E = this.engine, f = w === 'A' ? E.A : E.B, m = E.manual[w];
    this.body.append(h('div', { class: 'ins-head' }, h('b', {}, f.spec.name), h('span', { class: 'muted' }, ` · Character ${w} · ${f.skel.n} bones`)));
    const rd = h('pre', { class: 'readout' });
    this.body.append(h('div', { class: 'sec' }, 'State machine'), rd);
    this.live = () => { const ev = E.evals?.[w]; if (!ev) return; const me = ev.meters; rd.textContent = `state    ${me.state}\nfatigue  ${bar(me.fatigue)}\nrage     ${bar(me.rage)}\npower    ${bar(me.power)}\nairborne ${me.airborne}\nhits     ${me.hits}\nclip     ${ev.activeType ?? '-'}${ev.activeKind ? ':' + ev.activeKind : ''}\nspeed    ${ev.speed.toFixed(1)} m/s`; };
    this.live();
    const redraw = () => { if (!E.playing) E.renderFrame(); };
    this.body.append(h('div', { class: 'sec' }, 'Rig controls'));
    const en = h('label', { class: 'row' }, h('span', { class: 'lbl' }, 'Manual pose override'), h('input', { type: 'checkbox', checked: m.enabled, onChange: (e: Event) => { m.enabled = (e.target as HTMLInputElement).checked; if (m.enabled && !m.pose) m.pose = clonePose(E.evals[w].frame.pose); redraw(); this.buildChar2(w, holder); } }));
    this.body.append(en);
    const holder = h('div', {});
    this.body.append(holder);
    this.buildChar2(w, holder);
    void redraw;
  }

  private buildChar2(w: 'A' | 'B', holder: HTMLElement) {
    clear(holder);
    const E = this.engine, m = E.manual[w];
    if (!m.enabled || !m.pose) { holder.append(h('p', { class: 'hint' }, 'Enable the override to pose the skeleton by hand: IK/FK limbs, spine, head, eyes, fingers and the facial rig. Timeline animation resumes when disabled.')); return; }
    const P = m.pose as Pose;
    const redraw = () => { if (!E.playing) E.renderFrame(); };
    const v3 = (label: string, key: keyof Pose, lo: number, hi: number, step = 0.02) => { const a = P[key] as unknown as number[]; return h('details', {}, h('summary', {}, label), ...['x', 'y', 'z'].map((ax, i) => slider(ax, lo, hi, step, a[i], (v) => { a[i] = v; redraw(); }))); };
    const num = (label: string, key: keyof Pose, lo: number, hi: number, step = 0.02) => slider(label, lo, hi, step, P[key] as number, (v) => { (P as any)[key] = v; redraw(); });
    const pair = (label: string, key: 'fist' | 'spread' | 'footPitch' | 'gaze', lo: number, hi: number) => h('details', {}, h('summary', {}, label), ...[0, 1].map((i) => slider(key === 'gaze' ? (i ? 'pitch' : 'yaw') : i ? 'R' : 'L', lo, hi, 0.02, (P[key] as number[])[i], (v) => { (P[key] as number[])[i] = v; redraw(); })));
    const fkSet = (limb: 'armL' | 'armR' | 'legL' | 'legR', on: boolean) => {
      m.fk = m.fk ?? ({} as FKOverride);
      if (on) (m.fk as any)[limb] = limb.startsWith('arm') ? { sh: [0, 0, 0], el: 0.4, wr: [0, 0, 0] } : { hip: [0, 0, 0], knee: 0.3, ank: 0 };
      else delete (m.fk as any)[limb];
      this.buildChar2(w, holder); redraw();
    };
    const limb = (limb: 'armL' | 'armR' | 'legL' | 'legR', ik: () => HTMLElement[]) => {
      const fk = (m.fk as any)?.[limb];
      const tog = h('label', { class: 'row' }, h('span', { class: 'lbl' }, 'FK (off = IK)'), h('input', { type: 'checkbox', checked: !!fk, onChange: (e: Event) => fkSet(limb, (e.target as HTMLInputElement).checked) }));
      const body: HTMLElement[] = [tog];
      if (!fk) body.push(...ik());
      else if (limb.startsWith('arm')) body.push(...['x', 'y', 'z'].map((ax, i) => slider('shoulder ' + ax, -3.1, 3.1, 0.02, fk.sh[i], (v) => { fk.sh[i] = v; redraw(); })), slider('elbow', -0.1, 2.6, 0.02, fk.el, (v) => { fk.el = v; redraw(); }), ...['x', 'y', 'z'].map((ax, i) => slider('wrist ' + ax, -1.5, 1.5, 0.02, fk.wr[i], (v) => { fk.wr[i] = v; redraw(); })));
      else body.push(...['x', 'y', 'z'].map((ax, i) => slider('hip ' + ax, -2, 2, 0.02, fk.hip[i], (v) => { fk.hip[i] = v; redraw(); })), slider('knee', -0.1, 2.6, 0.02, fk.knee, (v) => { fk.knee = v; redraw(); }), slider('ankle', -1, 1, 0.02, fk.ank, (v) => { fk.ank = v; redraw(); }));
      return h('details', { open: !!fk }, h('summary', {}, { armL: 'Left arm', armR: 'Right arm', legL: 'Left leg', legR: 'Right leg' }[limb]), ...body);
    };
    const goal = (key: 'handL' | 'handR' | 'footL' | 'footR', lo: [number, number, number], hi: [number, number, number]) => ['x', 'y', 'z'].map((ax, i) => slider(key + ' ' + ax, lo[i], hi[i], 0.01, (P[key] as number[])[i], (v) => { (P[key] as number[])[i] = v; redraw(); }));
    const face = (label: string, k: keyof FaceParams, lo: number, hi: number) => slider(label, lo, hi, 0.02, P.face[k], (v) => { P.face[k] = v; redraw(); });
    holder.append(
      h('div', { class: 'btns' }, h('button', { onClick: () => { m.pose = clonePose(E.evals[w].frame.pose); m.fk = null; this.buildChar2(w, holder); redraw(); } }, 'Capture current pose'), h('button', { onClick: () => { m.enabled = false; this.buildNode({ kind: w === 'A' ? 'charA' : 'charB' }); redraw(); } }, 'Release')),
      h('details', { open: true }, h('summary', {}, 'Body'), num('pitch', 'bodyPitch', -3.2, 3.2), num('roll', 'bodyRoll', -3.2, 3.2), num('twist', 'twist', -3.2, 3.2),
        ...['x', 'y', 'z'].map((ax, i) => slider('hips ' + ax, -0.5, 0.5, 0.01, P.hipsOff[i], (v) => { P.hipsOff[i] = v; redraw(); }))),
      v3('Pelvis', 'pelvis', -1.2, 1.2), v3('Spine', 'spine', -1.2, 1.2), v3('Chest', 'chest', -1, 1), v3('Neck', 'neck', -0.8, 0.8), v3('Head', 'head', -1, 1), v3('Shoulder L', 'clavL', -0.6, 0.6), v3('Shoulder R', 'clavR', -0.6, 0.6),
      limb('armL', () => [...goal('handL', [-0.2, 0.4, -0.3], [0.9, 1.9, 0.9]), num('roll', 'rollL', -3, 3)]), limb('armR', () => [...goal('handR', [-0.9, 0.4, -0.3], [0.2, 1.9, 0.9]), num('roll', 'rollR', -3, 3)]),
      limb('legL', () => goal('footL', [-0.1, 0.05, -0.6], [0.7, 1.4, 0.9])), limb('legR', () => goal('footR', [-0.7, 0.05, -0.6], [0.1, 1.4, 0.9])),
      pair('Fingers: fist', 'fist', 0, 1), pair('Fingers: spread', 'spread', 0, 1), pair('Foot pitch', 'footPitch', -1, 1), pair('Eyes (look)', 'gaze', -0.8, 0.8),
      h('details', { open: true }, h('summary', {}, 'Facial rig'),
        h('div', { class: 'chips' }, ...(Object.keys(EXPRESSIONS) as ExpressionName[]).map((k) => h('button', { class: 'chip', onClick: () => { Object.assign(P.face, EXPRESSIONS[k]); this.buildChar2(w, holder); redraw(); } }, k))),
        face('brow L', 'browL', -1, 1), face('brow R', 'browR', -1, 1), face('angry tilt L', 'tiltL', -1, 1), face('angry tilt R', 'tiltR', -1, 1), face('eyelid L', 'lidL', 0, 1.25), face('eyelid R', 'lidR', 0, 1.25), face('squint', 'squint', 0, 1), face('mouth open', 'mouthOpen', 0, 1), face('mouth wide', 'mouthWide', -1, 1), face('smile', 'smile', -1, 1), face('teeth', 'teeth', 0, 1), face('pupil', 'pupil', 0.5, 1.4)),
    );
  }
}
const bar = (v: number) => '█'.repeat(Math.round(v * 12)).padEnd(12, '░') + ' ' + v.toFixed(2);
