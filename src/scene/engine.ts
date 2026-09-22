import { V, M, clamp, rad, smoothstep, type V3 } from '../utils/math.js';
import { ease } from '../utils/ease.js';
import { Renderer, DEFAULT_QUALITY, type QualitySettings } from '../engine/renderer.js';
import { Terrain, EnvDamage } from '../environment/terrain.js';
import { RockField, blockingRock, lineBlock, type RockBreak } from '../environment/rocks.js';
import { Sky } from '../environment/sky.js';
import { Fighter } from '../characters/fighter.js';
import { SPEC_A, SPEC_B } from '../characters/specs.js';
import { FighterTrack, type TrackEval, type Override } from '../animation/fighterTrack.js';
import { EXPRESSIONS, type Pose, type FKOverride, type ExpressionName } from '../animation/pose.js';
import { CameraSystem, shakeEventsFrom } from '../camera/camera.js';
import { VfxSystem, type VfxContext } from '../vfx/vfx.js';
import { AudioDirector } from '../audio/director.js';
import { lipCurve } from '../audio/lipsync.js';
import { Timeline, type Clip, type TimelineData } from '../timeline/model.js';
import { TimeWarp } from '../timeline/warp.js';
import { DEFAULT_LIGHTING, lerpLighting, linHex, type LightingState } from './lighting.js';
import type { CameraState, PostState } from './types.js';

export interface ManualRig { enabled: boolean; pose: Partial<Pose> | null; fk: FKOverride | null }
export interface Subtitle { speaker: 'A' | 'B'; text: string; name: string }
interface LightKey { start: number; dur: number; state: LightingState }

/** The scene: owns every system (environment, fighters, animation tracks, camera, VFX, audio) and evaluates the whole
 *  frame as a pure function of scene time. Playback, scrubbing, recording and frame-by-frame export all use render(). */
export class Engine {
  renderer: Renderer;
  terrain: Terrain; damage: EnvDamage; rocks: RockField; sky: Sky;
  A: Fighter; B: Fighter;
  tracks: { A: FighterTrack; B: FighterTrack };
  camera = new CameraSystem();
  vfx: VfxSystem;
  audio = new AudioDirector();
  warp = new TimeWarp();
  timeline: Timeline;

  // transport
  playing = false;
  tau = 0;               // scene time
  realT = 0;             // presentation time
  private lastNow = 0;
  private lastAc = -1;
  loop = false;
  onEnd: (() => void) | null = null;

  // last evaluated frame data (for UI / inspector / scene graph)
  evals!: { A: TrackEval; B: TrackEval };
  camState!: CameraState;
  light: LightingState = DEFAULT_LIGHTING;
  subtitle: Subtitle | null = null;
  lang: 'en' | 'ar' = 'en';
  manual: { A: ManualRig; B: ManualRig } = { A: { enabled: false, pose: null, fk: null }, B: { enabled: false, pose: null, fk: null } };
  freeCam = { enabled: false, target: [0, 1.5, 0] as V3, dist: 12, yaw: 0.6, pitch: 0.25 };
  showRig = false;
  fpsSmooth = 60;
  phase = '';

  private lightKeys: LightKey[] = [];
  private lines: Clip[] = [];
  private cries: Clip[] = [];
  private winds: Clip[] = [];
  private dirty = true;
  needsRender = true;

  constructor(canvas: HTMLCanvasElement, timeline: Timeline, quality: Partial<QualitySettings> = {}) {
    this.renderer = new Renderer(canvas, { ...DEFAULT_QUALITY, ...quality });
    const gl = this.renderer.gl;
    this.terrain = new Terrain(gl); this.damage = new EnvDamage(gl); this.rocks = new RockField(gl); this.sky = new Sky(gl);
    this.A = new Fighter(gl, SPEC_A); this.B = new Fighter(gl, SPEC_B);
    this.tracks = { A: new FighterTrack('A'), B: new FighterTrack('B') };
    this.tracks.A.opp = this.tracks.B; this.tracks.B.opp = this.tracks.A;
    this.vfx = new VfxSystem(gl, this.damage);
    this.timeline = timeline;
    this.camera.avoid = (p, t) => blockingRock(this.rocks, p, t);
    this.timeline.onChange(() => { this.dirty = true; this.needsRender = true; });
    this.resolve();
  }

  get fighters() { return { A: this.A, B: this.B }; }
  get duration() { return this.timeline.data.duration; }

  /** Rebuild every derived structure from the timeline data. Called after any edit. */
  resolve() {
    const d = this.timeline.data, clips = d.clips;
    const by = (t: string) => clips.filter((c) => c.track === t).sort((a, b) => a.start - b.start);
    const cA = by('charA'), cB = by('charB');
    this.tracks.A.setClips(cA, d.startPos.A, cB);
    this.tracks.B.setClips(cB, d.startPos.B, cA);
    this.warp.build(clips.filter((c) => c.type === 'speed'), d.duration + 4);
    this.camera.set(by('camera'), shakeEventsFrom(clips));
    // auto dust for fast ground movement (derived, not user-editable)
    const derived: Clip[] = [];
    for (const w of ['A', 'B'] as const) {
      let n = 0;
      for (const s of this.tracks[w].motionSegments()) {
        const dur = s.t1 - s.t0, speed = s.len / Math.max(dur, 0.01);
        if (speed < 4.2 || Math.max(s.from[1], s.to[1]) > 0.4 || dur > 3) continue;
        for (let t = s.t0; t < s.t1; t += 0.06) {
          const u = (t - s.t0) / dur, p = V.lerp(s.from, s.to, ease(s.ease, u));
          derived.push({ id: `auto_${w}_${n++}`, track: 'vfx', type: 'dust', start: t, dur: 0.05, params: { attach: 'world', pos: [p[0], 0, p[2]], intensity: 0.22, scale: 0.55, opacity: 0.8, seed: n } });
        }
      }
    }
    this.vfx.setClips(clips.filter((c) => c.track === 'vfx'), derived.concat(clips.filter((c) => c.track === 'environment')));
    const breaks: RockBreak[] = [];
    for (const c of by('environment')) {
      const p = c.params;
      if (c.type === 'rockBreak') breaks.push({ x: p.pos?.[0] ?? 0, z: p.pos?.[2] ?? 0, radius: p.radius ?? 4, t: c.start, mode: 'shatter', yaw: 0 });
      if (c.type === 'pillarFall') breaks.push({ x: p.pos?.[0] ?? 0, z: p.pos?.[2] ?? 0, radius: p.radius ?? 6, t: c.start, mode: 'topple', yaw: rad(p.yaw ?? 0) });
    }
    this.rocks.applyBreaks(breaks);
    this.winds = by('environment').filter((c) => c.type === 'wind');
    // lighting keys accumulate: each key merges over the previous state
    this.lightKeys = [];
    let prev = DEFAULT_LIGHTING;
    for (const c of by('lighting').filter((x) => x.type === 'key')) { prev = keyToState(prev, c.params); this.lightKeys.push({ start: c.start, dur: Math.max(0.01, c.dur), state: prev }); }
    this.lines = by('dialogue'); this.cries = by('voice').filter((c) => c.type === 'cry');
    this.audio.build(clips, this.warp);
    this.audio.lang = this.lang;
    this.dirty = false;
  }

  lightAt(t: number): LightingState {
    let cur = DEFAULT_LIGHTING;
    for (const k of this.lightKeys) {
      if (t < k.start) break;
      if (t >= k.start + k.dur) { cur = k.state; continue; }
      return lerpLighting(cur, k.state, ease('inOut', (t - k.start) / k.dur));
    }
    return cur;
  }
  windAt(t: number): number { let w = 1; for (const c of this.winds) { if (c.start <= t) w = c.params.speed ?? 1; else break; } return w; }

  private overrideFor(who: 'A' | 'B', t: number): Override | undefined {
    const ov: Override = {};
    let has = false;
    for (const c of this.lines) {
      if (c.params.speaker !== who || t < c.start || t > c.start + c.dur) continue;
      const u = (t - c.start) / c.dur, text: string = (this.lang === 'ar' ? c.params.ar || c.params.en : c.params.en || c.params.ar) ?? '';
      const w = smoothstep(0, 0.12, t - c.start) * (1 - smoothstep(0, 0.2, c.start + c.dur - t));
      ov.face = EXPRESSIONS[(c.params.expr ?? 'neutral') as ExpressionName]; ov.faceW = 0.8 * w;
      ov.mouth = Math.max(ov.mouth ?? 0, lipCurve(text, u) * w * 0.85);
      has = true;
    }
    for (const c of this.cries) {
      if (c.params.speaker !== who || t < c.start || t > c.start + c.dur) continue;
      const u = (t - c.start) / c.dur;
      ov.face = EXPRESSIONS[c.params.kind === 'pain' ? 'pain' : c.params.kind === 'grunt' ? 'strain' : 'scream']; ov.faceW = 0.9;
      ov.mouth = Math.max(ov.mouth ?? 0, (0.55 + 0.4 * Math.abs(Math.sin(u * 9))) * (c.params.kind === 'grunt' ? 0.4 : 1));
      has = true;
    }
    return has ? ov : undefined;
  }

  subtitleAt(t: number): Subtitle | null {
    for (const c of this.lines) {
      if (t >= c.start && t <= c.start + c.dur) {
        const text = (this.lang === 'ar' ? c.params.ar || c.params.en : c.params.en || c.params.ar) ?? '';
        return { speaker: c.params.speaker, text, name: c.params.speaker === 'A' ? SPEC_A.name : SPEC_B.name };
      }
    }
    return null;
  }

  // ------------------------------------------------------------------ transport
  async play() {
    if (this.dirty) this.resolve();
    if (this.tau >= this.duration - 0.05) { this.tau = 0; this.realT = 0; }
    this.playing = true;
    this.lastNow = performance.now();
    await this.audio.start(this.realT);
  }
  pause() { this.playing = false; this.audio.pause(); }
  stop() { this.playing = false; this.audio.pause(); this.seek(0); }
  seek(tau: number) {
    tau = clamp(tau, 0, this.duration + 3);
    this.tau = tau; this.realT = this.warp.realOf(tau); this.needsRender = true;
    if (this.playing) { this.audio.start(this.realT); this.lastNow = performance.now(); }
  }

  /** advance the clock (call once per animation frame) */
  tick(now: number) {
    const dt = Math.min(0.1, (now - this.lastNow) / 1000);
    this.lastNow = now;
    this.fpsSmooth += (1 / Math.max(dt, 1e-4) - this.fpsSmooth) * 0.08;
    if (this.dirty) this.resolve();
    if (this.playing) {
      // wall clock drives the scene; the audio clock only applies a gentle drift correction (keeps A/V in sync)
      this.realT += dt;
      const ac = this.audio.clock();
      if (ac !== null && ac !== this.lastAc) { const d = ac - this.realT; if (Math.abs(d) < 0.25) this.realT += d * 0.06; this.lastAc = ac; }
      this.tau = this.warp.contentOf(this.realT);
      if (this.tau >= this.duration) {
        if (this.loop) { this.seek(0); return; }
        this.playing = false; this.audio.pause(); this.tau = this.duration; this.onEnd?.();
      }
    }
  }

  // ------------------------------------------------------------------ frame evaluation + render
  private probeVal(who: 'A' | 'B', bone: string, t: number): V3 {
    const f = this.fighters[who], e = this.tracks[who].evaluate(t, 1);
    f.ghostRig.solve(e.frame.pose, e.frame.rootPos, e.frame.yaw);
    return f.point(bone, f.ghostRig);
  }

  private applyManual(who: 'A' | 'B', e: TrackEval) {
    const m = this.manual[who];
    if (!m.enabled) return;
    if (m.pose) e.frame.pose = { ...e.frame.pose, ...(m.pose as Pose), face: { ...e.frame.pose.face, ...(m.pose.face ?? {}) } };
    e.frame.fk = m.fk;
  }

  renderFrame(t = this.tau) {
    if (this.dirty) this.resolve();
    const R = this.renderer;
    const wind = this.windAt(t);
    const eA = this.tracks.A.evaluate(t, wind, this.overrideFor('A', t)), eB = this.tracks.B.evaluate(t, wind, this.overrideFor('B', t));
    this.applyManual('A', eA); this.applyManual('B', eB);
    this.evals = { A: eA, B: eB };
    this.A.apply(eA.frame); this.B.apply(eB.frame);
    this.subtitle = this.subtitleAt(t);
    const aspect = R.width / R.height;
    this.camera.aspect = aspect;
    const co = this.camera.evaluate(t, {
      point: (w, b) => this.fighters[w].point(b),
      root: (w, tt) => this.tracks[w].rootAt(tt),
      velocity: (w) => this.evals[w].velWorld,
    });
    let cam = co.cam;
    if (this.freeCam.enabled) {
      const f = this.freeCam, cp = Math.cos(f.pitch);
      cam = { ...cam, target: f.target, pos: V.add(f.target, [Math.sin(f.yaw) * cp * f.dist, Math.sin(f.pitch) * f.dist, Math.cos(f.yaw) * cp * f.dist]), fov: rad(45), roll: 0 };
    }
    if (!this.freeCam.enabled) {
      const lift = lineBlock(this.rocks, cam.pos, cam.target, t);
      if (lift > cam.pos[1]) cam = { ...cam, pos: [cam.pos[0], Math.min(lift, cam.pos[1] + 7), cam.pos[2]] };
    }
    this.camState = cam;
    // VFX (needs the projection of the *current* camera for screen-space effects)
    const fov = cam.fov;
    const view = M.lookAt(cam.pos, cam.target, [0, 1, 0]);
    this.vfx.rendererVP = M.mul(M.perspective(fov, aspect, cam.near, cam.far), view);
    const ctx: VfxContext = {
      t, fighters: this.fighters, evals: this.evals,
      probe: (w, b, tt) => this.probeVal(w, b, tt),
      frameAt: (w, tt) => this.tracks[w].evaluate(tt, wind).frame,
      camPos: cam.pos, camRight: [view[0], view[4], view[8]], camUp: [view[1], view[5], view[9]], fovY: fov,
    };
    let lines: [V3, V3][] | undefined;
    if (this.showRig) lines = this.rigLines();
    this.vfx.update(t, ctx, lines);
    const post: PostState = this.vfx.post;
    post.whip = Math.max(post.whip, co.whip * 0.8); post.chroma += co.shakeAmount * 0.05;
    post.fade = Math.max(1 - smoothstep(0, 1.2, t), smoothstep(this.duration - 2.6, this.duration, t)) ;
    const light = this.lightAt(t);
    // energy lighting: awakened / charging fighters also light their surroundings
    this.light = light;
    const mid = V.lerp(eA.root, eB.root, 0.5);
    R.render({ time: t, camera: cam, light, post, flashes: this.vfx.flashes, focus: [mid[0], Math.max(1, mid[1] * 0.6 + 1), mid[2]], world: { terrain: this.terrain, damage: this.damage, rocks: this.rocks, sky: this.sky, fighters: [this.A, this.B], vfx: this.vfx } });
    this.phase = this.phaseAt(t);
  }

  private rigLines(): [V3, V3][] {
    const out: [V3, V3][] = [];
    for (const f of [this.A, this.B]) {
      const sk = f.skel;
      for (let i = 1; i < sk.n; i++) { const p = sk.parent[i]; if (p > 0) out.push([f.rig.pos[p], f.rig.pos[i]]); }
    }
    return out;
  }
  phaseAt(t: number): string { let m = ''; for (const k of this.timeline.data.markers) if (k.t <= t) m = k.label; return m; }

  resize(w: number, h: number) { this.renderer.resize(w, h); }
  setQuality(q: Partial<QualitySettings>) { Object.assign(this.renderer.quality, q); this.renderer.applyQuality(); this.vfx.setQuality(q.particles ?? this.renderer.quality.particles); }
}

/** lighting key clip params -> LightingState (partial keys merge over the previous state) */
export function keyToState(prev: LightingState, p: Record<string, any>): LightingState {
  const s: any = { ...prev };
  const lin = (k: string) => (typeof p[k] === 'string' ? linHex(p[k]) : undefined);
  if (p.sunAz !== undefined || p.sunEl !== undefined) {
    const az = rad(p.sunAz ?? -50), el = rad(p.sunEl ?? 25);
    s.sunDir = V.norm([Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)]);
    s.rimDir = V.norm([-s.sunDir[0], 0.3, -s.sunDir[2]]);
  }
  if (p.sunCol !== undefined || p.sunI !== undefined) s.sunCol = V.mul(lin('sunCol') ?? V.norm(prev.sunCol).map((x) => x) as V3, p.sunI ?? 1.7);
  for (const k of ['ambSky', 'ambGround', 'rimCol', 'fogCol', 'skyTop', 'skyHor', 'grade'] as const) { const v = lin(k); if (v) s[k] = k === 'ambSky' ? V.mul(v, 0.9) : k === 'ambGround' ? V.mul(v, 0.7) : k === 'rimCol' ? V.mul(v, 0.9) : v; }
  for (const k of ['fogDen', 'cloudCover', 'exposure', 'bloom', 'contrast', 'saturation', 'vignette', 'wind'] as const) if (typeof p[k] === 'number') s[k] = p[k];
  if (typeof p.cloudLit === 'string') s.cloudLit = linHex(p.cloudLit);
  if (typeof p.cloudShade === 'string') s.cloudShade = linHex(p.cloudShade);
  if (typeof p.glow === 'number') s.glow = p.glow;
  return s as LightingState;
}
export type { Timeline, TimelineData };
