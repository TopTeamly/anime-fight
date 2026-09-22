import { V, clamp, lerp, rad, deg, type V3 } from '../utils/math.js';
import { mulberry32 } from '../utils/rng.js';
import { STRIKE_REACH } from '../animation/actions.js';
import { buildFsm, metersAt, pickDefense, strikePowerBoost, type Meters } from '../animation/fsm.js';
import { speechDuration } from '../audio/lipsync.js';
import type { Clip, TimelineData, TrackId } from './model.js';

type Who = 'A' | 'B';
const other = (w: Who): Who => (w === 'A' ? 'B' : 'A');
const track = (w: Who): TrackId => (w === 'A' ? 'charA' : 'charB');
const AURA = { A: { color: '#cfe3ff', color2: '#8fb6ff' }, B: { color: '#7ab0ff', color2: '#8a52ff' } };
const dirXZ = (a: V3, b: V3): V3 => { const d = V.norm([b[0] - a[0], 0, b[2] - a[2]]); return V.len(d) < 0.01 ? [1, 0, 0] : d; };
const perpXZ = (d: V3): V3 => [d[2], 0, -d[0]];
const r2 = (v: number) => Math.round(v * 100) / 100;
const v3 = (v: V3): V3 => [r2(v[0]), r2(v[1]), r2(v[2])];

interface Beat { t: number; power: number; atk: Who; pos: V3; res: string; kind: string }
export interface ExOpts { side?: 'L' | 'R'; target?: 'head' | 'chest' | 'gut'; dur?: number; contact?: number; react?: string; knock?: number; dir?: V3; fx?: boolean; dashFrom?: number; hitP?: number; noSlow?: boolean; noCut?: boolean }

class Choreo {
  clips: Clip[] = [];
  private n = 1;
  rnd = mulberry32(2026);
  pos: Record<Who, V3> = { A: [-5, 0, 0], B: [5, 0, 0] };
  beats: Beat[] = [];
  private cache: { A?: { n: number; m: Meters[]; t: number[] } } = {};

  add(trk: TrackId, type: string, start: number, dur: number, params: Record<string, any> = {}, label?: string): Clip {
    const c: Clip = { id: 'c' + this.n++, track: trk, type, start: r2(Math.max(0, start)), dur: r2(Math.max(0.03, dur)), params };
    if (label) c.label = label;
    this.clips.push(c);
    return c;
  }
  private fighterClips(w: Who) { return this.clips.filter((c) => c.track === track(w)); }
  /** state-machine meters at time t, computed from everything authored so far */
  meters(w: Who, t: number): Meters {
    const fsm = buildFsm(w, this.fighterClips(w), this.fighterClips(other(w)));
    return metersAt(fsm, t, this.pos[w][1]);
  }
  stance(w: Who, t: number, kind: string, blend = 0.4) { return this.add(track(w), 'stance', t, 2, { kind, blend }, kind); }
  move(w: Who, t: number, dur: number, to: V3, style = 'walk', ease = 'inOut') {
    this.add(track(w), 'move', t, dur, { to: v3(to), style, ease }, style);
    this.pos[w] = to;
  }
  steps(w: Who, t: number, dur: number, rate = 1.8, power = 0.35) { this.add('sfx', 'steps', t, dur, { who: w, rate, power }); }
  line(t: number, who: Who, en: string, ar: string, expr = 'neutral', dur?: number) {
    const d = dur ?? speechDuration(en);
    this.add('dialogue', 'line', t, d, { speaker: who, en, ar, expr });
    this.add('voice', 'speech', t, d, { speaker: who, en, ar, pitch: 1, rate: 1 });
    this.add(track(who), 'emote', t, d, { kind: 'talk', expr }, 'speak');
    return t + d;
  }

  // ------------------------------------------------------------- effects around an impact
  impactFx(tc: number, p: V3, power: number, atk: Who, dir: V3, opts: { block?: boolean; ground?: boolean; noSlow?: boolean } = {}) {
    const col = AURA[atk];
    const yaw = deg(Math.atan2(dir[0], dir[2]));
    if (opts.block) {
      this.add('vfx', 'sparks', tc, 0.12, { attach: 'world', pos: v3(p), intensity: 0.5 + power * 0.8, scale: 0.6, color: '#fff3d0', color2: '#ffb050', seed: 3, rot: [0, 0, 0] });
      if (power > 0.5) this.add('vfx', 'shockwave', tc, 0.35, { attach: 'world', pos: v3(p), rot: [90, r2(yaw), 0], intensity: 0.7, scale: 0.6 + power, color: '#fff4dd', opacity: 0.8 });
      return;
    }
    this.add('vfx', 'sparks', tc, 0.14, { attach: 'world', pos: v3(p), intensity: 0.5 + power * 1.1, scale: 0.55 + power * 0.7, color: col.color, color2: col.color2, seed: Math.floor(tc * 10), rot: [0, 0, 0] });
    if (power > 0.4) this.add('vfx', 'burst', tc, 0.2, { attach: 'world', pos: v3(p), intensity: 0.5 + power, scale: 0.7 + power, color: col.color, color2: col.color2, seed: 5 });
    if (power > 0.45) this.add('vfx', 'shockwave', tc, 0.3 + 0.3 * power, { attach: 'world', pos: v3(p), rot: [90, r2(yaw), 0], intensity: 0.6 + power, scale: 0.7 + 1.6 * power, color: col.color, opacity: 0.9 });
    if (power > 0.68) this.add('vfx', 'impactFrame', tc, 0.09, { who: atk === 'A' ? 'A' : power > 0.85 ? 'neutral' : 'B', color: col.color, intensity: 1 });
    if (power > 0.6) this.add('vfx', 'flash', tc, 0.09, { attach: 'world', pos: v3(p), intensity: 0.5 + power * 0.7, color: '#ffffff', scale: 1 });
    if (power > 0.5) this.add('vfx', 'speedLines', tc - 0.02, 0.3, { attach: 'world', intensity: 0.5 + power * 0.5, color: '#ffffff' });
    if (power > 0.78 || opts.ground) this.add('vfx', 'groundHit', tc + 0.02, 0.2, { attach: 'world', pos: v3([p[0], 0, p[2]]), intensity: 0.5 + power * 1.2, scale: 1, seed: Math.floor(tc * 7) });
    else if (power > 0.4) this.add('vfx', 'dust', tc, 0.2, { attach: 'world', pos: v3([p[0], 0, p[2]]), intensity: 0.5 + power * 0.8, scale: 0.7 });
    if (power > 0.7 && !opts.noSlow) this.add('time', 'speed', tc - 0.03, 0.16 + 0.3 * (power - 0.7), { speed: 0.12 + 0.2 * (1 - power), ramp: 0.04 });
    if (power > 0.9 && !opts.noSlow) this.add('time', 'speed', tc + 0.16, 0.5, { speed: 0.4, ramp: 0.2 });
  }

  /** One attack + the defender's answer. Returns the time at which both fighters have settled. */
  ex(t: number, atk: Who, kind: string, power: number, res: string, o: ExOpts = {}): number {
    const D = other(atk);
    const pa = this.pos[atk], pd = this.pos[D];
    power = clamp(power + strikePowerBoost(this.meters(atk, t)));
    const dur = o.dur ?? (0.5 + 0.2 * (1 - power) + (kind.startsWith('kick') || kind === 'spinKick' ? 0.1 : 0));
    const cf = o.contact ?? 0.45;
    const d0 = dirXZ(pa, pd);
    const reach = STRIKE_REACH[kind] ?? 0.9;
    const pc: V3 = [pd[0] - d0[0] * reach, pa[1], pd[2] - d0[2] * reach];
    let ts = t;
    const dist = V.distXZ(pa, pc);
    if (dist > 3.2 && (pa[1] < 0.5)) {
      const dd = clamp((dist - 1.4) / 20, 0.16, 0.6), mid: V3 = [pd[0] - d0[0] * (reach + 1.3), pa[1], pd[2] - d0[2] * (reach + 1.3)];
      this.move(atk, t, dd, mid, 'dash', 'in');
      this.add('vfx', 'speedLines', t, dd + 0.05, { attach: 'world', intensity: 0.4 + 0.3 * power, color: '#ffffff' });
      ts = t + dd;
    }
    const miss = !(res === 'hit');
    const tc = ts + dur * cf;
    const side = o.side ?? (kind === 'jab' ? 'L' : this.rnd() < 0.5 ? 'R' : 'L');
    const target = o.target ?? (kind === 'uppercut' || kind === 'kickHigh' ? 'head' : kind === 'knee' ? 'gut' : 'chest');
    this.add(track(atk), 'strike', ts, dur, { kind, side, power: r2(power), contact: cf, target, miss, to: v3(pc) }, kind);
    this.pos[atk] = pc;
    this.add('sfx', 'sfx_whoosh', ts + dur * 0.05, 0.3, { power: r2(power), pan: r2(atk === 'A' ? -0.3 : 0.3), seed: Math.floor(t * 7) % 50 });
    const hp: V3 = [pd[0] - d0[0] * 0.1, pd[1] + (target === 'head' ? 1.6 : target === 'gut' ? 1.05 : 1.3), pd[2] - d0[2] * 0.1];
    const hitKind = kind.startsWith('kick') || kind === 'spinKick' ? 'kick' : power > 0.75 ? 'heavy' : kind === 'knee' || kind === 'elbow' ? 'body' : 'punch';
    let end = ts + dur + 0.1;
    const side2 = perpXZ(d0);
    if (res === 'hit') {
      const rk = o.react ?? (pd[1] > 0.6 ? 'airHit' : power < 0.34 ? 'flinch' : power < 0.62 ? 'stagger' : power < 0.9 ? 'knockback' : 'slam');
      const knock = o.knock ?? (rk === 'flinch' ? 0.25 : rk === 'stagger' ? 0.7 + power : rk === 'airHit' ? 1.5 + 3 * power : rk === 'slam' ? 5 + 5 * (power - 0.85) * 4 : 1.8 + 3 * power);
      const kd = o.dir ?? d0;
      const to: V3 = [pd[0] + kd[0] * knock, rk === 'airHit' || pd[1] > 0.6 ? pd[1] + (o.dir ? 0 : 0.3) : rk === 'slam' ? 0.25 : rk === 'knockback' ? 0.05 : 0, pd[2] + kd[2] * knock];
      const rdur = rk === 'flinch' ? 0.45 : rk === 'stagger' ? 0.75 : rk === 'slam' ? 1.1 : rk === 'airHit' ? 0.9 : 0.85;
      this.add(track(D), 'react', tc - 0.04, rdur, { kind: rk, power: r2(power), to: v3(to) }, rk);
      this.pos[D] = pd[1] > 0.6 ? to : [to[0], rk === 'slam' ? 0 : 0, to[2]];
      this.add('sfx', 'hit', tc, 0.5, { kind: hitKind, power: r2(power), seed: Math.floor(tc * 13) % 900, space: 'ground', pan: r2(atk === 'A' ? -0.1 : 0.1) });
      this.impactFx(tc, hp, power, atk, d0, { ground: rk === 'slam', noSlow: o.noSlow });
      if (rk === 'slam') {
        const land = tc + 0.5;
        this.add('vfx', 'groundHit', land, 0.2, { attach: 'world', pos: v3([this.pos[D][0], 0, this.pos[D][2]]), intensity: 1.2 + power, scale: 1.1, seed: Math.floor(land * 5) });
        this.add('sfx', 'hit', land, 0.6, { kind: 'crush', power: r2(clamp(power * 0.9)), seed: 77, space: 'rock' });
        this.add('sfx', 'sfx_rumble', land, 0.9, { power: 0.5 });
        this.add(track(D), 'stance', land + 0.9, 2, { kind: 'lie', blend: 0.1 });
        end = land + 1.0;
      } else end = Math.max(end, tc - 0.04 + rdur);
      this.beats.push({ t: tc, power, atk, pos: hp, res, kind });
    } else {
      const r = res.split(':');
      const dk = r[0] === 'auto' ? '' : r[0];
      const dd = dk || pickDefense(this.meters(D, tc), kind, power, this.rnd()).kind;
      const dstart = tc - 0.3;
      let to: V3 = pd;
      let ddur = 0.5;
      if (dd === 'sidestep') to = V.add(pd, V.mul(side2, (this.rnd() < 0.5 ? 1 : -1) * 0.9));
      else if (dd === 'backstep') { to = V.add(pd, V.mul(d0, 1.3)); ddur = 0.55; }
      else if (dd === 'microDodge') { to = V.add(pd, V.mul(side2, 0.22)); ddur = 0.32; }
      else if (dd === 'blink') { to = V.add(pc, V.mul(d0, -0.0)); to = V.add([pc[0], pd[1], pc[2]], V.mul(d0, -1.3)); ddur = 0.16; }
      else if (dd === 'blockHigh' || dd === 'blockCross' || dd === 'parry') to = V.add(pd, V.mul(d0, 0.15 + 0.8 * power));
      else if (dd === 'airDodge') to = V.add(pd, V.mul(side2, 1.4));
      const dst = dd === 'blink' ? tc - 0.06 : dstart;
      this.add(track(D), 'defend', dst, ddur, { kind: dd, power: r2(power), to: v3(to) }, dd);
      this.pos[D] = to;
      if (dd === 'blockHigh' || dd === 'blockCross' || dd === 'parry') {
        this.add('sfx', 'sfx_block', tc, 0.4, { power: r2(power), seed: Math.floor(tc * 3) % 40 });
        this.impactFx(tc, hp, power * 0.7, atk, d0, { block: true });
        if (power > 0.45) this.add('vfx', 'dust', tc, 0.2, { attach: 'world', pos: v3([pd[0], 0, pd[2]]), intensity: 0.5 + power, scale: 0.8 });
        this.beats.push({ t: tc, power: power * 0.7, atk, pos: hp, res: 'block', kind });
      } else if (dd === 'blink') {
        this.add('vfx', 'afterimage', tc - 0.3, 0.6, { attach: D, intensity: 1, color: AURA[D].color, scale: 1.4 });
        this.add('vfx', 'burst', tc - 0.08, 0.15, { attach: 'world', pos: v3([pd[0], pd[1] + 1.2, pd[2]]), intensity: 0.6, scale: 0.6, color: AURA[D].color, color2: AURA[D].color2 });
        this.add('sfx', 'sfx_whoosh', tc - 0.1, 0.25, { power: 0.9, pan: 0.2, seed: 9 });
      } else this.add('sfx', 'sfx_cloth', tc - 0.15, 0.3, { power: 0.6, seed: Math.floor(tc) % 30 });
      end = Math.max(end, dstart + ddur + 0.05);
    }
    return end;
  }

  combo(t: number, atk: Who, seq: [string, number, string, ExOpts?][], gap = 0.06): number {
    let cur = t;
    for (const [k, p, r, o] of seq) cur = this.ex(cur, atk, k, p, r, o) + gap;
    return cur;
  }
  /** both fighters step apart / re-centre to `dist` metres */
  reset(t: number, dist: number, dur = 1.0, style = 'walk', shift: V3 = [0, 0, 0]) {
    const pa = this.pos.A, pb = this.pos.B, d = dirXZ(pa, pb);
    const mid = V.add(V.lerp(pa, pb, 0.5), shift), m: V3 = [clamp(mid[0], -24, 24), 0, clamp(mid[2], -24, 24)];
    this.move('A', t, dur, [m[0] - d[0] * dist / 2, this.pos.A[1], m[2] - d[2] * dist / 2], style);
    this.move('B', t, dur, [m[0] + d[0] * dist / 2, this.pos.B[1], m[2] + d[2] * dist / 2], style);
    if (style === 'walk') { this.steps('A', t, dur); this.steps('B', t, dur); }
    return t + dur;
  }

  // ------------------------------------------------------------------------------------------------ cameras
  shot(t: number, dur: number, p: Record<string, any>) { return this.add('camera', 'shot', t, dur, { subject: 'both', bone: 'chest', ease: 'inOut', lag: 0.15, shake: 0, roll: 0, ...p }); }
  light(t: number, dur: number, p: Record<string, any>) { this.add('lighting', 'key', t, dur, p); }
}

// ==================================================================================================================
export function buildFight(): TimelineData {
  const c = new Choreo();
  const R = c.rnd;

  // ---------------------------------------------------------------- lighting looks
  c.light(0, 0.1, { sunAz: -50, sunEl: 11, sunCol: '#ffb684', sunI: 1.5, ambSky: '#98a4c8', ambGround: '#a08268', rimCol: '#a5c4ff', fogCol: '#d59a7c', fogDen: 0.0036, skyTop: '#2f4c8f', skyHor: '#ff9c72', cloudCover: 0.56, exposure: 1.0, bloom: 0.4, contrast: 1.1, saturation: 1.12, vignette: 0.32, grade: '#ffffff', wind: 1.4 });
  c.light(27, 6, { sunEl: 17, sunCol: '#ffd0a0', sunI: 1.6, skyHor: '#f3b48a', skyTop: '#365aa6', fogCol: '#d0a38c', fogDen: 0.0034, saturation: 1.1 });
  c.light(60, 6, { sunAz: -35, sunEl: 30, sunCol: '#ffe6c8', sunI: 1.75, skyTop: '#3f68b8', skyHor: '#f5c9a0', fogCol: '#d3b39c', contrast: 1.1 });
  c.light(96, 8, { sunEl: 20, sunCol: '#ffc48a', sunI: 1.6, skyTop: '#5a4a80', skyHor: '#e58c5c', fogCol: '#c8926c', fogDen: 0.0068, exposure: 0.96, vignette: 0.42, saturation: 1.15 });
  c.light(128, 5, { sunAz: -20, sunEl: 14, sunCol: '#ffb070', sunI: 1.8, skyTop: '#4a3f86', skyHor: '#ff7a50', fogCol: '#b96e58', fogDen: 0.0052, contrast: 1.32, saturation: 1.28, vignette: 0.48, bloom: 0.5 });
  c.light(158, 6, { sunAz: -60, sunEl: 42, sunCol: '#fff0d8', sunI: 1.9, skyTop: '#3f7ad8', skyHor: '#f6d7ac', fogCol: '#d8c0a8', fogDen: 0.0026, cloudCover: 0.5, exposure: 1.05, bloom: 0.45, contrast: 1.12, vignette: 0.3 });
  c.light(191, 8, { sunEl: 9, sunCol: '#a898d8', sunI: 1.5, ambSky: '#7078b8', ambGround: '#6a5a70', skyTop: '#20204a', skyHor: '#6a4470', fogCol: '#544468', fogDen: 0.0048, cloudCover: 0.66, exposure: 1.0, contrast: 1.15, saturation: 0.85, vignette: 0.5, bloom: 0.3, grade: '#e6ecff' });
  // awakening steps (each is one visible layer of the transformation)
  c.light(205.5, 3.5, { sunCol: '#ffe9b0', sunI: 1.6, ambSky: '#8a88c8', skyTop: '#2c2858', skyHor: '#8c5a70', exposure: 0.98, bloom: 0.55 });
  c.light(211.5, 1.2, { sunEl: 34, sunCol: '#fff4d0', sunI: 2.4, skyTop: '#e8d090', skyHor: '#fff2d0', fogCol: '#f0dcb0', fogDen: 0.006, exposure: 1.25, bloom: 1.2, saturation: 1.1, grade: '#fff6e0', cloudCover: 0.52 });
  c.light(214.5, 5, { sunEl: 24, sunCol: '#ffe0b0', sunI: 1.9, skyTop: '#4a5cc0', skyHor: '#f0b070', fogCol: '#d4a878', fogDen: 0.0022, exposure: 0.9, bloom: 0.4, saturation: 1.2, contrast: 1.22, vignette: 0.42 });
  c.add('environment', 'wind', 0, 60, { speed: 1.5 }); c.add('environment', 'wind', 60, 120, { speed: 2.2 }); c.add('environment', 'wind', 180, 30, { speed: 3.4 });
  c.add('environment', 'wind', 210, 20, { speed: 0.7 }); c.add('environment', 'wind', 230, 50, { speed: 2.6 });

  // ================================================================ PHASE 1 - SILENCE  (0 - 27)
  c.pos.A = [-5.2, 0, 0.4]; c.pos.B = [5.2, 0, -0.3];
  c.stance('A', 0, 'relaxed'); c.stance('B', 0, 'armsCrossed');
  c.add('sfx', 'breathing', 4, 18, { who: 'A', rate: 0.3, power: 0.15 }); c.add('sfx', 'breathing', 6, 16, { who: 'B', rate: 0.26, power: 0.15 });
  c.add('sfx', 'sfx_cloth', 5.5, 1, { power: 0.3, seed: 2, pan: -0.5 }); c.add('sfx', 'sfx_cloth', 10.5, 1, { power: 0.3, seed: 5, pan: 0.5 });
  c.move('A', 8.5, 3.4, [-4.3, 0, 0.3]); c.steps('A', 8.7, 3.0, 1.1, 0.3);
  c.move('B', 12.4, 3.0, [4.6, 0, -0.2]); c.steps('B', 12.5, 2.8, 1.1, 0.35);
  c.add('charA', 'emote', 15, 3, { kind: 'stare', expr: 'calm' }); c.add('charB', 'emote', 16, 3, { kind: 'stare', expr: 'smirk' });
  c.add('sfx', 'sfx_rumble', 17, 6, { power: 0.15 }); c.add('sfx', 'sfx_riser', 20, 6, { power: 0.3 });
  c.stance('B', 21.6, 'guardLow', 0.6);
  let t = c.line(19.6, 'B', "You came. I was starting to think you'd run.", 'جئت أخيرًا... ظننتُ أنك ستهرب.', 'smirk', 2.4);
  t = c.line(23.4, 'A', 'Begin.', 'ابدأ.', 'calm', 1.0);
  c.stance('A', 24.4, 'guard', 0.7);
  c.move('A', 24.6, 2.2, [-3.4, 0, 0.1]); c.steps('A', 24.6, 2, 1.4, 0.4);
  c.move('B', 24.6, 2.2, [3.5, 0, -0.1]); c.steps('B', 24.6, 2, 1.4, 0.45);
  // cameras (explicit cinematic sequence)
  c.shot(0, 8, { shot: 'wide', d0: 34, d1: 22, h0: 2.2, h1: 9, az0: -30, az1: 8, fov0: 34, fov1: 36, lag: 0 });
  c.shot(8, 4.2, { shot: 'medium', d0: 17, d1: 13, h0: 0.5, h1: 1.0, az0: 8, az1: 28, fov0: 38, fov1: 40 });
  c.shot(12.2, 3.3, { shot: 'eyes', subject: 'A', bone: 'eyes', d0: 0.9, d1: 0.65, h0: 1.6, h1: 1.62, az0: 52, az1: 48, fov0: 24, fov1: 20, lag: 0 });
  c.shot(15.5, 3.4, { shot: 'eyes', subject: 'B', bone: 'eyes', d0: 0.95, d1: 0.7, h0: 1.7, h1: 1.72, az0: -52, az1: -46, fov0: 24, fov1: 20, lag: 0 });
  c.shot(18.9, 1.6, { shot: 'feet', subject: 'A', bone: 'feet', d0: 2.6, d1: 2.2, h0: 0.35, h1: 0.4, az0: 25, az1: 40, fov0: 45, fov1: 45, lag: 0 });
  c.shot(20.5, 2.6, { shot: 'medium', subject: 'B', bone: 'head', d0: 3.4, d1: 2.6, h0: 1.55, h1: 1.65, az0: -38, az1: -25, fov0: 30, fov1: 28, lag: 0 });
  c.shot(23.1, 2.4, { shot: 'close', subject: 'A', bone: 'head', d0: 2.0, d1: 1.5, h0: 1.6, h1: 1.62, az0: 34, az1: 24, fov0: 26, fov1: 22, lag: 0 });
  c.shot(25.5, 1.6, { shot: 'low', d0: 12, d1: 9, h0: 0.35, h1: 0.7, az0: 15, az1: -10, fov0: 42, fov1: 38 });
  c.add('music', 'section', 0, 26, { mood: 'calm', intensity: 0.35, bpm: 68 });
  c.add('vfx', 'dust', 12.6, 0.1, { attach: 'world', pos: [4.8, 0, 0], intensity: 0.35, scale: 0.6, opacity: 0.8 });

  // ================================================================ PHASE 2 - TESTING (27 - 60)
  t = 27;
  c.add('music', 'section', 26, 34, { mood: 'tension', intensity: 0.6, bpm: 96 });
  c.add('sfx', 'sfx_riser', 25.5, 2, { power: 0.5 });
  t = c.ex(t, 'B', 'jab', 0.3, 'parry', { dashFrom: 0 }) + 0.45;
  t = c.ex(t, 'A', 'cross', 0.32, 'blockHigh') + 0.5;
  t = c.reset(t, 3.0, 0.7) + 0.05;
  t = c.ex(t, 'B', 'kickFront', 0.35, 'sidestep') + 0.3;
  t = c.ex(t, 'A', 'jab', 0.3, 'backstep') + 0.35;
  t = c.reset(t, 2.6, 0.7) + 0.05;
  t = c.ex(t, 'A', 'cross', 0.36, 'auto') + 0.25;
  t = c.ex(t, 'B', 'hook', 0.4, 'blockCross') + 0.35;
  t = c.reset(t, 2.4, 0.6, 'walk', [0, 0, 2]) + 0.1;
  t = c.ex(t, 'B', 'jab', 0.33, 'lean') + 0.05;
  t = c.ex(t, 'B', 'cross', 0.4, 'duck') + 0.3;
  t = c.ex(t, 'A', 'uppercut', 0.42, 'blockCross') + 0.4;
  t = c.reset(t, 2.8, 0.7) + 0.1;
  t = c.ex(t, 'A', 'jab', 0.32, 'hit', { react: 'flinch' }) + 0.15;   // first clean touch
  c.add('charB', 'emote', t - 0.4, 1.2, { kind: 'taunt', expr: 'smirk' });
  t = c.ex(t, 'B', 'cross', 0.45, 'parry') + 0.3;
  t = c.ex(t, 'A', 'kickRound', 0.42, 'blockHigh') + 0.4;
  t = c.reset(t, 2.2, 0.6, 'walk') + 0.05;
  t = c.ex(t, 'B', 'jab', 0.36, 'hit', { react: 'flinch', target: 'head' }) + 0.2;
  t = c.ex(t, 'A', 'cross', 0.4, 'blockHigh') + 0.3;
  const p2end = Math.max(t, 58.2);
  c.stance('A', 27, 'guard', 0.2); c.stance('B', 27, 'guardLow', 0.2);

  // ================================================================ PHASE 3 - CLOSE COMBAT (60 - 96)
  t = 60;
  c.add('music', 'section', 60, 36, { mood: 'escalation', intensity: 0.7, bpm: 116 });
  c.add('sfx', 'sfx_riser', 58.5, 1.8, { power: 0.5 });
  c.add('sfx', 'hit', 60, 0.3, { kind: 'body', power: 0.25, seed: 4 }); // tiny sting
  t = Math.max(p2end, 60.2);
  c.pos.A[1] = 0; c.pos.B[1] = 0;
  t = c.combo(t, 'B', [['jab', 0.42, 'parry'], ['cross', 0.48, 'blockHigh'], ['kickRound', 0.5, 'duck']]) + 0.15;
  t = c.combo(t, 'A', [['jab', 0.42, 'hit', { react: 'flinch' }], ['cross', 0.5, 'hit', { react: 'stagger' }], ['hook', 0.5, 'blockHigh']]) + 0.15;
  t = c.combo(t, 'B', [['elbow', 0.5, 'blockCross'], ['knee', 0.52, 'parry'], ['hook', 0.55, 'hit', { react: 'stagger' }]]) + 0.2;
  t = c.reset(t, 1.5, 0.5, 'slide', [3, 0, -2]) + 0.05;
  t = c.combo(t, 'A', [['kickFront', 0.5, 'blockCross'], ['jab', 0.42, 'lean'], ['uppercut', 0.55, 'hit', { react: 'stagger' }]]) + 0.1;
  t = c.combo(t, 'B', [['cross', 0.55, 'hit', { react: 'stagger' }], ['kickRound', 0.6, 'blockHigh'], ['elbow', 0.52, 'sidestep']]) + 0.15;
  t = c.reset(t, 1.4, 0.5, 'slide', [-3, 0, 3]) + 0.05;
  t = c.combo(t, 'A', [['knee', 0.55, 'blockCross'], ['elbow', 0.52, 'parry'], ['cross', 0.6, 'hit', { react: 'stagger' }]]) + 0.1;
  t = c.combo(t, 'B', [['hook', 0.6, 'duck'], ['uppercut', 0.6, 'lean'], ['kickHigh', 0.62, 'blockHigh']]) + 0.15;
  // grab + throw
  c.add('charB', 'emote', t, 0.4, { kind: 'shout', expr: 'grit' });
  c.add('sfx', 'sfx_cloth', t, 0.4, { power: 0.7, seed: 6 });
  t = c.ex(t + 0.1, 'B', 'grabThrow', 0.66, 'hit', { react: 'thrown', knock: 5.4, contact: 0.35, dur: 0.85, noSlow: false }) + 0.6;
  c.stance('A', t - 0.4, 'guard', 0.6);
  c.add('charA', 'react', t - 0.55, 0.5, { kind: 'getup', to: v3(c.pos.A) });
  t = c.reset(t, 2.4, 0.7) + 0.05;
  t = c.combo(t, 'A', [['jab', 0.5, 'blockHigh'], ['cross', 0.56, 'parry'], ['kickRound', 0.6, 'hit', { react: 'stagger' }]]) + 0.1;
  const p3end = Math.max(t, 94.5);

  // ================================================================ PHASE 4 - ENVIRONMENT DAMAGE (96 - 128)
  t = 96;
  c.add('music', 'section', 96, 62, { mood: 'fast', intensity: 0.8, bpm: 138 });
  t = Math.max(p3end, 96.2);
  c.add('sfx', 'sfx_rumble', 95.5, 3, { power: 0.5 });
  t = c.ex(t, 'B', 'slam', 0.62, 'blockCross', { target: 'chest' }) + 0.05;
  c.add('vfx', 'groundHit', t - 0.7, 0.2, { attach: 'world', pos: v3([c.pos.B[0] + 0.5, 0, c.pos.B[2]]), intensity: 1.6, scale: 1.2, seed: 41 });
  c.add('sfx', 'hit', t - 0.7, 0.5, { kind: 'crush', power: 0.7, seed: 12, space: 'rock' });
  t = c.combo(t, 'A', [['kickRound', 0.66, 'hit', { react: 'knockback' }]]) + 0.2;
  // B is thrown across the arena into a boulder field: rocks shatter
  const b1 = [c.pos.B[0], c.pos.B[2]];
  c.add('environment', 'rockBreak', t - 1.0, 0.2, { pos: [r2(b1[0] + 1), 0, r2(b1[1])], radius: 5 });
  c.add('sfx', 'sfx_rockBreak', t - 1.0, 0.8, { power: 0.7, seed: 4 });
  c.add('vfx', 'debris', t - 1.0, 0.3, { attach: 'world', pos: [r2(b1[0] + 1), 0.4, r2(b1[1])], intensity: 1.4, scale: 1.3, seed: 8 });
  c.add('vfx', 'dust', t - 1.0, 0.3, { attach: 'world', pos: [r2(b1[0] + 1), 0, r2(b1[1])], intensity: 1.8, scale: 1.6 });
  t = c.reset(t, 2.4, 0.5, 'dash') + 0.05;
  t = c.combo(t, 'B', [['cross', 0.72, 'hit', { react: 'knockback' }]]) + 0.1;
  c.add('vfx', 'groundHit', t - 0.5, 0.2, { attach: 'world', pos: v3([c.pos.A[0], 0, c.pos.A[2]]), intensity: 1.5, scale: 1.2, seed: 22 });
  t = c.combo(t, 'A', [['uppercut', 0.7, 'auto'], ['axe', 0.72, 'blockCross']]) + 0.15;
  t = c.combo(t, 'B', [['kickHigh', 0.74, 'blockHigh'], ['hook', 0.76, 'hit', { react: 'knockback' }]]) + 0.1;
  const pos1 = c.pos.A;
  c.add('environment', 'rockBreak', t - 0.8, 0.2, { pos: [r2(pos1[0]), 0, r2(pos1[2])], radius: 5 });
  c.add('sfx', 'sfx_rockBreak', t - 0.8, 0.8, { power: 0.8, seed: 9 });
  t = c.ex(t, 'B', 'slam', 0.82, 'dodge:sidestep') + 0.1;
  c.add('vfx', 'crater', t - 0.6, 0.2, { attach: 'world', pos: v3([c.pos.B[0] + 0.6, 0, c.pos.B[2]]), scale: 1.4, intensity: 1.2, seed: 5 });
  c.add('sfx', 'sfx_boom', t - 0.6, 0.6, { power: 0.5 });
  t = c.combo(t, 'A', [['knee', 0.72, 'hit', { react: 'stagger' }], ['spinKick', 0.78, 'hit', { react: 'knockback', knock: 6 }]]) + 0.1;
  // pillar collapse: B is smashed into a rock pillar
  const P = [-30, 18];
  c.move('B', t - 0.9, 0.9, [-27.2, 0, 16.4], 'dash', 'in');
  c.pos.B = [-27.2, 0, 16.4]; c.pos.A = [-22, 0, 14];
  c.add('environment', 'pillarFall', t + 0.02, 0.2, { pos: [P[0], 0, P[1]], radius: 6, yaw: 60 });
  c.add('sfx', 'sfx_rockBreak', t, 1.2, { power: 1, seed: 21 }); c.add('sfx', 'sfx_boom', t, 0.6, { power: 0.9 });
  c.add('vfx', 'explosion', t, 0.3, { attach: 'world', pos: [r2(P[0] + 2), 3, r2(P[1] - 1)], intensity: 1.2, scale: 1.6, seed: 3, color: '#ffcf90', color2: '#c86a2a' });
  c.add('vfx', 'impactFrame', t, 0.09, { who: 'neutral', color: '#ffffff' }); c.add('vfx', 'debris', t + 0.1, 0.3, { attach: 'world', pos: [r2(P[0] + 2), 4, r2(P[1])], intensity: 2, scale: 2, seed: 15 });
  c.add('time', 'speed', t - 0.03, 0.3, { speed: 0.15, ramp: 0.05 }); c.add('time', 'speed', t + 0.25, 0.9, { speed: 0.4, ramp: 0.2 });
  c.add('charB', 'react', t - 0.05, 1.1, { kind: 'slam', power: 0.9, to: v3([-28.5, 0.2, 16.9]) });
  c.pos.B = [-28.5, 0, 16.9];
  c.add('vfx', 'groundHit', t + 1.6, 0.2, { attach: 'world', pos: [-32.5, 0, 12], intensity: 1.8, scale: 1.5, seed: 30 });
  c.add('sfx', 'sfx_rumble', t + 1.4, 2.4, { power: 0.8 }); c.add('sfx', 'sfx_crack', t + 1.6, 0.6, { power: 1, seed: 2 });
  t += 2.6;
  c.add('charB', 'react', t - 0.3, 1.0, { kind: 'getup', to: v3(c.pos.B) }); c.stance('B', t + 0.8, 'guardLow', 0.4);
  const p4end = Math.max(t + 1.0, 126);

  // ================================================================ PHASE 5 - HIGH SPEED (128 - 158)
  c.add('music', 'section', 158, 32, { mood: 'final', intensity: 0.8, bpm: 150 });
  t = p4end;
  c.pos.A = [-2, 0, 4]; c.pos.B = [2, 0, -1];
  c.move('A', t, 0.5, c.pos.A, 'dash'); c.move('B', t, 0.5, c.pos.B, 'dash');
  t += 0.7;
  const fast = (atk: Who, seq: [string, number, string, ExOpts?][]) => { c.add('vfx', 'afterimage', t - 0.2, 2.2, { attach: atk, intensity: 1, color: AURA[atk].color, scale: 1.2 }); c.add('vfx', 'trail', t - 0.1, 2.2, { attach: atk, bone: 'fistR', intensity: 1, scale: 1, color: AURA[atk].color, color2: AURA[atk].color2 }); c.add('vfx', 'trail', t - 0.1, 2.2, { attach: atk, bone: 'footR', intensity: 0.8, scale: 1, color: AURA[atk].color, color2: AURA[atk].color2 }); t = c.combo(t, atk, seq, 0.0) + 0.02; };
  const dashAround = (w: Who, to: V3, dur = 0.3) => { c.move(w, t, dur, to, 'dash', 'inOut'); c.add('vfx', 'speedLines', t, dur + 0.1, { attach: 'world', intensity: 0.7, color: '#ffffff' }); t += dur; };
  fast('B', [['cross', 0.6, 'blockCross', { dur: 0.42 }], ['hook', 0.6, 'parry', { dur: 0.4 }], ['kickRound', 0.62, 'duck', { dur: 0.42 }], ['jab', 0.5, 'lean', { dur: 0.34 }]]);
  dashAround('A', [8, 0, 6], 0.28);
  fast('A', [['kickHigh', 0.66, 'hit', { react: 'stagger', dur: 0.42 }], ['cross', 0.66, 'blockHigh', { dur: 0.38 }], ['hook', 0.66, 'sidestep', { dur: 0.4 }]]);
  dashAround('B', [-6, 0, -8], 0.3); dashAround('A', [-9, 0, -6], 0.3);
  fast('B', [['jab', 0.55, 'parry', { dur: 0.34 }], ['cross', 0.6, 'blockHigh', { dur: 0.36 }], ['uppercut', 0.66, 'hit', { react: 'knockback', dur: 0.42 }]]);
  dashAround('A', [4, 0, -12], 0.3);
  fast('A', [['jab', 0.55, 'blockHigh', { dur: 0.32 }], ['knee', 0.6, 'parry', { dur: 0.36 }], ['spinKick', 0.72, 'blockCross', { dur: 0.5 }], ['cross', 0.7, 'hit', { react: 'stagger', dur: 0.38 }]]);
  dashAround('B', [14, 0, 2], 0.28); dashAround('A', [10, 0, 8], 0.28);
  fast('B', [['hook', 0.66, 'hit', { react: 'stagger', dur: 0.4 }], ['kickRound', 0.68, 'blockHigh', { dur: 0.4 }], ['cross', 0.7, 'lean', { dur: 0.36 }], ['axe', 0.74, 'blockCross', { dur: 0.5 }]]);
  dashAround('A', [0, 0, 10], 0.25);
  fast('A', [['cross', 0.72, 'auto', { dur: 0.36 }], ['kickHigh', 0.72, 'blockHigh', { dur: 0.4 }], ['uppercut', 0.76, 'hit', { react: 'knockback', dur: 0.42, knock: 3.5 }]]);
  const p5end = Math.max(t + 0.3, 156.5);
  c.stance('A', p4end, 'guard', 0.2); c.stance('B', p4end, 'guardLow', 0.2);

  // ================================================================ PHASE 6 - AERIAL (158 - 190)
  t = p5end + 0.4;
  c.add('sfx', 'sfx_riser', t - 1.2, 1.5, { power: 0.6 });
  // B rockets up with an uppercut, carrying A into the sky
  const pa0 = c.pos.A, pb0 = c.pos.B;
  c.add('vfx', 'afterimage', t, 1.6, { attach: 'B', intensity: 1, color: AURA.B.color, scale: 1.2 });
  t = c.ex(t, 'B', 'uppercut', 0.86, 'hit', { react: 'airHit', knock: 2, dir: [0, 0, 0], dur: 0.5, target: 'head' }) + 0.0;
  c.pos.A = [pa0[0] + 0.5, 9, pa0[2]];
  c.add('charA', 'react', t - 1.0, 1.0, { kind: 'airHit', power: 0.85, to: v3([c.pos.A[0], 9, c.pos.A[2]]) });
  c.move('B', t - 1.0, 0.9, [c.pos.B[0], 8.2, c.pos.B[2]], 'fly', 'outCubic');
  c.pos.B = [c.pos.B[0], 8.2, c.pos.B[2]];
  c.add('charA', 'stance', t - 0.4, 2, { kind: 'air', blend: 0.4 }); c.add('charB', 'stance', t - 0.4, 2, { kind: 'air', blend: 0.4 });
  c.add('sfx', 'sfx_wind', t - 1, 8, { power: 0.8 });
  c.add('vfx', 'shockwave', t - 0.9, 0.7, { attach: 'world', pos: v3([pa0[0], 0, pa0[2]]), rot: [0, 0, 0], intensity: 1.2, scale: 2.5, color: '#ffe0b8', opacity: 0.7 });
  t += 0.6;
  const airEx = (atk: Who, kind: string, pw: number, res: string, moveTo?: V3, o: ExOpts = {}) => {
    const D = other(atk), d = dirXZ(c.pos[atk], c.pos[D]);
    if (moveTo) { c.move(atk, t, 0.28, moveTo, 'fly'); t += 0.25; }
    c.add(track(atk), 'air', t - 0.05, 0.4, { kind: 'glide', to: v3(c.pos[atk]) });
    t = c.ex(t, atk, kind, pw, res, { ...o, knock: o.knock ?? 3 }) + 0.05; void d;
  };
  airEx('A', 'kickRound', 0.66, 'blockCross', [c.pos.A[0] + 3, 10.5, c.pos.A[2] - 2]);
  airEx('B', 'cross', 0.7, 'airDodge', [c.pos.B[0] - 3, 9.5, c.pos.B[2] + 2]);
  airEx('A', 'jab', 0.62, 'hit', undefined, { react: 'airHit' });
  airEx('B', 'hook', 0.7, 'blockHigh', [c.pos.B[0] + 4, 12, c.pos.B[2]]);
  airEx('A', 'kickHigh', 0.72, 'airDodge', [c.pos.A[0] - 3, 11.5, c.pos.A[2] + 3]);
  // energy exchange
  c.stance('B', t, 'air', 0.3);
  const bp = c.pos.B, ap = c.pos.A;
  c.add('charB', 'charge', t, 1.3, { kind: 'ki', level: 0.7 }); c.add('vfx', 'energyBall', t + 0.3, 1.5, { attach: 'B', bone: 'fistR', scale: 1.0, intensity: 1.2, color: '#9fc8ff', color2: '#6a4cff', pos: [0.2, 0, 0.3] });
  c.add('sfx', 'sfx_charge', t, 1.3, { power: 0.6 }); c.add('vfx', 'lightning', t, 1.6, { attach: 'B', scale: 1, intensity: 0.8, color: '#a8c8ff', seed: 4 });
  t += 1.3;
  c.add('charB', 'blast', t, 0.9, { kind: 'ball', side: 'R', power: 0.8 });
  c.add('vfx', 'energyBall', t + 0.1, 0.7, { attach: 'B', bone: 'fistR', scale: 1.1, intensity: 1.5, color: '#9fc8ff', color2: '#6a4cff', pos: [0, 0, 0], to: v3([ap[0], ap[1] + 1.3, ap[2]]), seed: 7 });
  c.add('sfx', 'sfx_release', t + 0.1, 0.7, { power: 0.7 });
  const dodgeTo: V3 = [ap[0] + 4, ap[1] + 2, ap[2] + 2];
  c.add('charA', 'defend', t + 0.3, 0.5, { kind: 'airDodge', power: 0.8, to: v3(dodgeTo) }); c.pos.A = dodgeTo;
  c.add('vfx', 'explosion', t + 0.85, 0.3, { attach: 'world', pos: v3([ap[0] - 1, ap[1] - 1, ap[2]]), intensity: 1.2, scale: 1.5, seed: 12, color: '#bcd6ff', color2: '#5a5cff' });
  c.add('sfx', 'sfx_explosion', t + 0.85, 1, { power: 0.7 }); c.add('vfx', 'flash', t + 0.85, 0.1, { attach: 'world', pos: v3(ap), intensity: 1.0, color: '#cfe0ff' });
  t += 1.6;
  c.add('charB', 'blast', t, 1.1, { kind: 'wave', power: 0.9 }); c.add('charB', 'charge', t - 0.9, 0.9, { kind: 'beam', level: 0.9 });
  c.add('vfx', 'beam', t + 0.15, 0.9, { attach: 'B', bone: 'chest', pos: [0, 0, 0.5], scale: 1.4, intensity: 1.5, color: '#a8c8ff', color2: '#7a4cff', to: v3([c.pos.A[0] - 1.5, c.pos.A[1] + 3, c.pos.A[2] - 5]), seed: 3 });
  c.add('sfx', 'sfx_release', t + 0.15, 0.9, { power: 0.9 }); c.add('vfx', 'heatDistort', t + 0.15, 1.0, { attach: 'B', bone: 'chest', scale: 1, intensity: 1 });
  c.add('charA', 'defend', t + 0.35, 0.6, { kind: 'airDodge', power: 0.9, to: v3([c.pos.A[0] - 3, c.pos.A[1] + 1.5, c.pos.A[2] - 4]) });
  c.pos.A = [c.pos.A[0] - 3, c.pos.A[1] + 1.5, c.pos.A[2] - 4];
  t += 1.2;
  c.add('charB', 'stance', t, 2, { kind: 'air', blend: 0.3 });
  // A dives and kicks B down: hard slam into the ground
  const B2 = c.pos.B;
  c.move('A', t, 0.35, [B2[0] - 2, B2[1] + 3, B2[2] - 1], 'fly'); c.pos.A = [B2[0] - 2, B2[1] + 3, B2[2] - 1];
  t += 0.35;
  t = c.ex(t, 'A', 'kickRound', 0.88, 'hit', { react: 'airHit', knock: 1, dir: [0, -1, 0], dur: 0.5, target: 'head', noSlow: false });
  // B falls to the ground
  const land: V3 = [B2[0] + 4, 0.3, B2[2] + 5];
  c.add('charB', 'react', t - 0.6, 1.0, { kind: 'slam', power: 1, to: v3(land) });
  c.pos.B = [land[0], 0, land[2]];
  c.add('vfx', 'crater', t + 0.3, 0.3, { attach: 'world', pos: v3([land[0], 0, land[2]]), scale: 1.8, intensity: 1.6, seed: 9 });
  c.add('vfx', 'groundHit', t + 0.3, 0.3, { attach: 'world', pos: v3([land[0], 0, land[2]]), intensity: 2.2, scale: 1.8, seed: 19 });
  c.add('vfx', 'explosion', t + 0.32, 0.3, { attach: 'world', pos: v3([land[0], 0.5, land[2]]), intensity: 0.9, scale: 1.4, seed: 2, color: '#ffcf90', color2: '#c8642a' });
  c.add('sfx', 'sfx_boom', t + 0.3, 1, { power: 0.9 }); c.add('sfx', 'hit', t + 0.3, 0.8, { kind: 'crush', power: 0.95, seed: 31, space: 'rock' });
  c.add('vfx', 'impactFrame', t + 0.3, 0.09, { who: 'neutral', color: '#ffffff' }); c.add('time', 'speed', t + 0.27, 0.25, { speed: 0.12, ramp: 0.04 });
  c.add('environment', 'rockBreak', t + 0.3, 0.2, { pos: v3([land[0], 0, land[2]]), radius: 8 }); c.add('sfx', 'sfx_rockBreak', t + 0.35, 1, { power: 0.9, seed: 6 });
  c.add('sfx', 'sfx_rumble', t + 0.4, 2, { power: 0.9 });
  // A descends and lands
  c.add('charA', 'air', t + 0.6, 1.4, { kind: 'ascend', to: v3([land[0] - 4.5, 0, land[2] - 2]) });
  c.move('A', t + 0.7, 1.4, [land[0] - 4.5, 0, land[2] - 2], 'land', 'inOut'); c.pos.A = [land[0] - 4.5, 0, land[2] - 2];
  c.add('charA', 'stance', t + 2.2, 2, { kind: 'guard', blend: 0.4 });
  c.add('vfx', 'dust', t + 2.0, 0.3, { attach: 'world', pos: v3([c.pos.A[0], 0, c.pos.A[2]]), intensity: 1.4, scale: 1.2 });
  c.add('sfx', 'hit', t + 2.0, 0.5, { kind: 'body', power: 0.5, seed: 8 });
  t += 3.5;
  const p6end = Math.max(t, 189);

  // ================================================================ PHASE 7 - POWER AWAKENING (190 - 226)
  const T0 = 191;
  c.add('music', 'section', 188, 4, { mood: 'tension', intensity: 0.4, bpm: 90 });
  c.add('music', 'duck', 190.2, 14, { level: 0 });
  c.add('sfx', 'breathing', 192, 12, { who: 'A', rate: 0.6, power: 0.7 }); c.add('sfx', 'breathing', 192, 12, { who: 'B', rate: 0.7, power: 0.8 });
  // B climbs out of the crater, A stands still - a moment of calm
  c.add('charB', 'react', 191, 1.3, { kind: 'getup', to: v3(c.pos.B) }); c.stance('B', 192.5, 'guardLow', 0.6);
  const ap2 = c.pos.A, bp2 = c.pos.B;
  c.stance('A', T0, 'relaxed', 1.0);
  c.line(194, 'B', 'Finished already? Get up!', 'انتهيت؟ انهض!', 'angry', 2.2);
  c.add('charB', 'move', 196.5, 1.5, { to: v3(V.lerp(bp2, ap2, 0.35)), style: 'walk' }); c.pos.B = V.lerp(bp2, ap2, 0.35); c.steps('B', 196.5, 1.4, 1.6, 0.6);
  c.line(198.6, 'A', 'Enough.', 'كفى.', 'calm', 1.1);
  // awakening: A stops, silence, then nine ordered layers
  const aw = 200.4;
  c.add('charA', 'charge', aw, 12, { kind: 'awaken', level: 1, to: v3(c.pos.A), moveTo: false });
  c.add('sfx', 'sfx_riser', aw + 0.5, 9, { power: 0.9 }); c.add('sfx', 'sfx_charge', aw + 2.5, 8, { power: 0.9 });
  c.add('sfx', 'sfx_rumble', aw + 6.2, 6, { power: 0.9 });
  c.add('vfx', 'aura', aw + 3.2, 10, { attach: 'A', who: 'A', scale: 1.0, intensity: 1.0, color: '#fff1b0', color2: '#ffb63b' });         // 2 energy appears
  c.add('vfx', 'burst', aw + 5.4, 0.3, { attach: 'A', bone: 'chest', scale: 1.1, intensity: 0.8, color: '#fff1b0', color2: '#ffb63b', seed: 3 }); // 4 particles
  c.add('vfx', 'dust', aw + 6.4, 5, { attach: 'world', pos: v3([ap2[0], 0, ap2[2]]), intensity: 1.4, scale: 1.4, opacity: 0.9 });          // 6 dust rises
  c.add('vfx', 'groundCrack', aw + 7.2, 0.3, { attach: 'world', pos: v3([ap2[0], 0, ap2[2]]), scale: 2.2, intensity: 1.2, seed: 33 });         // 7 ground cracks
  c.add('vfx', 'groundCrack', aw + 8.2, 0.3, { attach: 'world', pos: v3([ap2[0], 0, ap2[2]]), scale: 3.4, intensity: 1.2, seed: 34 });
  c.add('vfx', 'lightning', aw + 8.4, 3.6, { attach: 'A', scale: 1.4, intensity: 1.2, color: '#fff2b0', seed: 8 });
  c.add('vfx', 'shockwave', aw + 10.6, 1.1, { attach: 'world', pos: v3([ap2[0], 0, ap2[2]]), rot: [0, 0, 0], intensity: 1.6, scale: 7, color: '#fff2c0', opacity: 1 });  // 8 energy wave
  c.add('vfx', 'shockwave', aw + 10.7, 1.4, { attach: 'world', pos: v3([ap2[0], 1.2, ap2[2]]), rot: [0, 0, 0], who: 'A', intensity: 1.2, scale: 5, color: '#fff2c0', opacity: 1 });
  c.add('vfx', 'explosion', aw + 10.7, 0.3, { attach: 'world', pos: v3([ap2[0], 0.5, ap2[2]]), intensity: 1.2, scale: 1.5, seed: 4, color: '#fff2c0', color2: '#ffc060' });
  c.add('vfx', 'flash', aw + 10.7, 0.3, { attach: 'world', pos: v3([ap2[0], 1.4, ap2[2]]), intensity: 1.4, color: '#fff8e0' });       // 9 short flash
  c.add('vfx', 'crater', aw + 10.7, 0.3, { attach: 'world', pos: v3([ap2[0], 0, ap2[2]]), scale: 1.5, intensity: 1.0, seed: 6 });
  c.add('sfx', 'sfx_explosion', aw + 10.7, 1, { power: 0.8 }); c.add('sfx', 'sfx_release', aw + 10.7, 0.8, { power: 0.9 });
  c.add('time', 'speed', aw + 10.6, 0.5, { speed: 0.25, ramp: 0.1 });
  c.add('environment', 'rockBreak', aw + 10.7, 0.2, { pos: v3([ap2[0], 0, ap2[2]]), radius: 8 });
  c.add('charB', 'defend', aw + 10.8, 0.9, { kind: 'blockCross', power: 0.9, to: v3(V.add(c.pos.B, dirXZ(ap2, c.pos.B).map((x) => x * 3) as V3)) });
  c.pos.B = V.add(c.pos.B, dirXZ(ap2, c.pos.B).map((x) => x * 3) as V3);
  c.add('charB', 'emote', aw + 4, 5, { kind: 'stare', expr: 'shock' });
  c.line(aw + 12.2, 'B', 'What... is this?', 'ما هذا...؟', 'shock', 1.6);
  c.add('music', 'section', aw + 10.6, 6, { mood: 'awakening', intensity: 0.9, bpm: 84 });
  c.stance('A', aw + 11.0, 'powered', 0.5);
  const p7end = aw + 14.6;

  // ================================================================ POST-AWAKENING (215 - 244): A's new animation language
  c.add('music', 'section', 214.5, 30, { mood: 'final', intensity: 1.0, bpm: 156 });
  t = p7end;
  c.add('vfx', 'aura', 214.6, 30, { attach: 'A', who: 'A', scale: 1.0, intensity: 0.8, color: '#fff1b0', color2: '#ffb63b' });
  c.add('vfx', 'aura', 214.6, 30, { attach: 'B', who: 'B', scale: 0.9, intensity: 0.5, color: '#7ab0ff', color2: '#8a52ff' });
  c.pos.A = c.pos.A; c.stance('B', t, 'guardLow', 0.2);
  // B goes all-in: heavy punches, energy attacks; A barely moves
  const bAtk = (kind: string, pw: number, res: string, o: ExOpts = {}) => { c.add('vfx', 'afterimage', t, 0.7, { attach: 'B', intensity: 0.8, color: '#7ab0ff', scale: 1.0 }); t = c.ex(t, 'B', kind, pw, res, o) + 0.05; };
  bAtk('cross', 0.78, 'microDodge', { dur: 0.42 });
  t = c.ex(t, 'A', 'jab', 0.6, 'hit', { react: 'stagger', dur: 0.32 }) + 0.05;
  bAtk('hook', 0.82, 'microDodge', { dur: 0.4 });
  bAtk('kickHigh', 0.84, 'microDodge', { dur: 0.42 });
  t = c.ex(t, 'A', 'cross', 0.72, 'hit', { react: 'knockback', knock: 3, dur: 0.32 }) + 0.3;
  // B: energy ball barrage, A dodges with blinks
  c.add('charB', 'blast', t, 1.4, { kind: 'barrage', power: 0.9 });
  for (let i = 0; i < 5; i++) {
    const tt = t + 0.15 + i * 0.22, tgt: V3 = [c.pos.A[0] + (R() - 0.5) * 2.5, 1.3, c.pos.A[2] + (R() - 0.5) * 2.5];
    c.add('vfx', 'energyBall', tt, 0.5, { attach: 'B', bone: i % 2 ? 'fistL' : 'fistR', scale: 0.55, intensity: 1.2, color: '#9fc8ff', color2: '#6a4cff', to: v3(tgt), seed: i });
    c.add('vfx', 'explosion', tt + 0.5, 0.2, { attach: 'world', pos: v3([tgt[0] + 0.4, 0.6, tgt[2]]), intensity: 0.6, scale: 0.7, seed: i + 5, color: '#bcd6ff', color2: '#5a5cff' });
    c.add('sfx', 'sfx_explosion', tt + 0.5, 0.6, { power: 0.4 }); c.add('sfx', 'sfx_release', tt, 0.3, { power: 0.3 });
  }
  const blinkTo: V3[] = [[c.pos.A[0] + 3, 0, c.pos.A[2] + 1], [c.pos.A[0] - 1, 0, c.pos.A[2] + 3], [c.pos.A[0] - 4, 0, c.pos.A[2] - 1]];
  blinkTo.forEach((bt, i) => { const tt = t + 0.3 + i * 0.4; c.add('charA', 'defend', tt, 0.16, { kind: 'blink', power: 0.8, to: v3(bt) }); c.add('vfx', 'afterimage', tt - 0.1, 0.6, { attach: 'A', intensity: 1, color: '#fff1b0', scale: 1.4 }); c.add('vfx', 'burst', tt, 0.1, { attach: 'world', pos: v3([bt[0], 1.2, bt[2]]), intensity: 0.5, scale: 0.5, color: '#fff1b0', color2: '#ffb63b' }); });
  c.pos.A = blinkTo[2];
  t += 1.9;
  // heavy punch dodged: A appears behind B and counters
  t = c.ex(t, 'B', 'cross', 0.92, 'blink', { dur: 0.42 }) + 0.02;
  t = c.ex(t, 'A', 'cross', 0.85, 'hit', { react: 'knockback', knock: 4, dur: 0.34 }) + 0.05;
  t = c.ex(t + 0.2, 'B', 'slam', 0.9, 'microDodge', { dur: 0.5 }) + 0.02;
  c.add('vfx', 'crater', t - 0.6, 0.2, { attach: 'world', pos: v3([c.pos.B[0] + 0.7, 0, c.pos.B[2]]), scale: 1.6, intensity: 1.3, seed: 15 });
  c.add('sfx', 'sfx_boom', t - 0.6, 0.6, { power: 0.7 });
  t = c.combo(t, 'A', [['uppercut', 0.86, 'hit', { react: 'knockback', knock: 3.5 }], ['spinKick', 0.9, 'hit', { react: 'slam', knock: 8 }]]) + 0.5;
  c.add('charB', 'react', t - 0.2, 1.3, { kind: 'getup', to: v3(c.pos.B) }); c.stance('B', t + 1.0, 'guardLow', 0.3);
  const p8end = Math.max(t + 1.2, 242);

  // ================================================================ FINALE (242 - 270)
  t = p8end;
  c.add('music', 'duck', t - 0.2, 4.5, { level: 0.05 });
  c.add('music', 'section', t + 4.4, 20, { mood: 'final', intensity: 1.0, bpm: 160 });
  // both fighters gather energy: charge -> silence -> close-up -> buildup
  const fa = c.pos.A, fb = c.pos.B;
  c.move('A', t, 1.2, [-6, 0, 0], 'walk'); c.move('B', t, 1.2, [6, 0, 0], 'walk'); c.pos.A = [-6, 0, 0]; c.pos.B = [6, 0, 0];
  void fa; void fb;
  const ch = t + 1.4;
  c.add('charA', 'charge', ch, 6, { kind: 'fistCharge', level: 1, to: v3([-6, 0, 0]), moveTo: false }); c.add('charB', 'charge', ch, 6, { kind: 'beam', level: 1, to: v3([6, 0, 0]), moveTo: false });
  c.add('sfx', 'sfx_charge', ch, 6, { power: 1 }); c.add('sfx', 'sfx_riser', ch + 1, 5, { power: 1 }); c.add('sfx', 'sfx_rumble', ch + 1.5, 6, { power: 0.9 });
  c.add('vfx', 'aura', ch, 12, { attach: 'A', who: 'A', scale: 1.3, intensity: 1.3, color: '#fff8d0', color2: '#ffb63b' });
  c.add('vfx', 'aura', ch, 12, { attach: 'B', who: 'B', scale: 1.2, intensity: 1.2, color: '#7ab0ff', color2: '#8a52ff' });
  c.add('vfx', 'energyBall', ch + 1, 5, { attach: 'B', bone: 'chest', pos: [0, 0, 0.55], scale: 2.1, intensity: 1.6, color: '#9fc8ff', color2: '#6a4cff', seed: 5 });
  c.add('vfx', 'lightning', ch + 1, 5.5, { attach: 'A', scale: 1.6, intensity: 1.3, color: '#fff2b0', seed: 2 }); c.add('vfx', 'lightning', ch + 1, 5.5, { attach: 'B', scale: 1.6, intensity: 1.3, color: '#a8c8ff', seed: 6 });
  for (const [x, z] of [[-10, 2], [-3, -6], [4, 7], [9, -4], [0, 3]] as [number, number][]) c.add('vfx', 'groundCrack', ch + 2.5 + R() * 2.5, 0.3, { attach: 'world', pos: [x, 0, z], scale: 1.6, intensity: 1, seed: Math.floor(R() * 99) });
  for (let i = 0; i < 4; i++) c.add('vfx', 'debris', ch + 2 + i * 1.0, 0.3, { attach: 'world', pos: [(R() - 0.5) * 16, 0.2, (R() - 0.5) * 12], intensity: 0.8, scale: 0.9, seed: i + 44 });
  c.add('vfx', 'dust', ch, 6, { attach: 'world', pos: [-6, 0, 0], intensity: 1.2, scale: 1.5, opacity: 0.8 }); c.add('vfx', 'dust', ch, 6, { attach: 'world', pos: [6, 0, 0], intensity: 1.2, scale: 1.5, opacity: 0.8 });
  c.add('vfx', 'heatDistort', ch + 2, 5, { attach: 'world', pos: [0, 1.5, 0], scale: 2, intensity: 0.8 });
  c.line(ch + 0.6, 'A', 'This is the last one.', 'هذه هي الأخيرة.', 'awakened', 2.0);
  c.line(ch + 2.9, 'B', "Then don't hold back!", 'إذن لا تتراجع!', 'scream', 1.7);
  const fin = ch + 6.2;
  c.add('music', 'duck', fin - 0.6, 0.9, { level: 0 });
  // FINAL ATTACK: B fires a giant beam, A blinks through it and delivers the finishing blow
  c.add('charB', 'blast', fin - 0.9, 1.6, { kind: 'beam', power: 1 });
  c.add('vfx', 'beam', fin - 0.5, 1.3, { attach: 'B', bone: 'chest', pos: [0, 0, 0.6], scale: 2.6, intensity: 2.2, color: '#a8c8ff', color2: '#7a4cff', to: [-6, 1.4, 0], seed: 3 });
  c.add('sfx', 'sfx_release', fin - 0.5, 1.3, { power: 1 }); c.add('vfx', 'heatDistort', fin - 0.5, 1.3, { attach: 'B', bone: 'chest', scale: 2, intensity: 1.4 });
  c.add('charA', 'defend', fin + 0.2, 0.16, { kind: 'blink', power: 1, to: [3.6, 0, 0.1] }); c.pos.A = [3.6, 0, 0.1];
  c.add('vfx', 'afterimage', fin, 0.8, { attach: 'A', intensity: 1.2, color: '#fff1b0', scale: 1.6 });
  c.add('vfx', 'trail', fin, 0.8, { attach: 'A', bone: 'fistR', intensity: 1.5, scale: 1.8, color: '#fff8d0', color2: '#ffb63b' });
  c.pos.B = [6, 0, 0];
  t = c.ex(fin + 0.45, 'A', 'cross', 1.0, 'hit', { react: 'slam', knock: 13, dur: 0.6, contact: 0.4 });
  // massive impact
  const ip: V3 = [5.4, 1.3, 0.1], ft = fin + 0.45 + 0.6 * 0.4;
  c.add('vfx', 'explosion', ft, 0.4, { attach: 'world', pos: v3(ip), intensity: 2.4, scale: 3.2, seed: 21, color: '#fff2c0', color2: '#ffb63b' });
  c.add('vfx', 'explosion', ft + 0.3, 0.4, { attach: 'world', pos: [12, 0.5, 0], intensity: 2, scale: 3, seed: 22, color: '#ffe0a0', color2: '#e0602a' });
  c.add('vfx', 'shockwave', ft, 1.6, { attach: 'world', pos: [4.6, 0.2, 0], rot: [0, 0, 0], intensity: 2.2, scale: 9, color: '#fff4d0', opacity: 1 });
  c.add('vfx', 'shockwave', ft + 0.1, 1.9, { attach: 'world', pos: [4.6, 1.3, 0], rot: [0, 0, 0], who: 'A', intensity: 1.6, scale: 7, color: '#fff4d0', opacity: 1 });
  c.add('vfx', 'groundHit', ft + 0.05, 0.3, { attach: 'world', pos: [4.6, 0, 0], intensity: 3, scale: 2.4, seed: 88 }); c.add('vfx', 'crater', ft + 0.05, 0.3, { attach: 'world', pos: [4.8, 0, 0], scale: 2.2, intensity: 1.6, seed: 90 });
  c.add('vfx', 'flash', ft, 0.4, { attach: 'world', pos: v3(ip), intensity: 1.6, color: '#ffffff' }); c.add('vfx', 'impactFrame', ft, 0.1, { who: 'neutral', color: '#ffffff' });
  c.add('vfx', 'debris', ft, 0.4, { attach: 'world', pos: [5, 1, 0], intensity: 3, scale: 2.2, seed: 61 }); c.add('vfx', 'debris', ft + 0.2, 0.4, { attach: 'world', pos: [7, 1, 2], intensity: 2.4, scale: 2, seed: 62 });
  c.add('vfx', 'smoke', ft + 0.2, 4, { attach: 'world', pos: [5, 0.5, 0], intensity: 1.4, scale: 2.2, seed: 5 });
  c.add('vfx', 'dust', ft + 0.2, 4, { attach: 'world', pos: [4.6, 0, 0], intensity: 2.5, scale: 2.4, opacity: 1 });
  c.add('sfx', 'sfx_boom', ft, 2, { power: 1 }); c.add('sfx', 'sfx_explosion', ft, 2.5, { power: 1 }); c.add('sfx', 'sfx_rockBreak', ft + 0.1, 1.5, { power: 1, seed: 40 }); c.add('sfx', 'sfx_rumble', ft + 0.2, 4.5, { power: 1 });
  c.add('sfx', 'hit', ft, 1, { kind: 'crush', power: 1, seed: 66, space: 'rock' });
  c.add('time', 'speed', ft - 0.05, 0.5, { speed: 0.08, ramp: 0.05 }); c.add('time', 'speed', ft + 0.45, 1.6, { speed: 0.3, ramp: 0.3 });
  c.add('environment', 'rockBreak', ft, 0.2, { pos: [8, 0, 4], radius: 12 }); c.add('environment', 'pillarFall', ft + 0.2, 0.2, { pos: [14, 0, 38], radius: 8, yaw: 0 });
  c.add('music', 'duck', ft - 0.1, 3.4, { level: 0 });
  c.add('charB', 'stance', ft + 1.4, 3, { kind: 'lie', blend: 0.1 });
  c.pos.B = [17, 0, 0.5];
  c.add('charA', 'stance', ft + 0.7, 4, { kind: 'powered', blend: 0.9 });
  const endT = ft + 3.6;

  // ================================================================ ENDING
  c.add('music', 'section', endT - 0.6, 20, { mood: 'ending', intensity: 0.5, bpm: 64 });
  c.add('sfx', 'sfx_wind', endT - 1, 16, { power: 0.5 });
  c.line(endT + 3.2, 'A', 'It is over.', 'لقد انتهى.', 'calm', 1.6);
  c.add('charA', 'move', endT + 0.6, 4.2, { to: [3.4, 0, -0.6], style: 'walk' }); c.steps('A', endT + 0.8, 3.8, 1.0, 0.35); c.pos.A = [3.4, 0, -0.6];
  c.add('vfx', 'aura', ft + 1.0, 6, { attach: 'A', who: 'A', scale: 0.8, intensity: 0.4, color: '#fff1b0', color2: '#ffb63b' });
  const total = Math.ceil(endT + 15.4);

  // ================================================================ CAMERA DIRECTION (phases 2-8: coverage + cut-ins on important beats)
  const beats = c.beats.slice().sort((a, b) => a.t - b.t);
  const coverage = (t0: number, t1: number, style: 'wide' | 'mid' | 'fast' | 'tight') => {
    let tt = t0, i = 0;
    while (tt < t1 - 0.3) {
      const len = style === 'fast' ? 1.5 + R() * 1.1 : style === 'tight' ? 2 + R() * 1.4 : style === 'mid' ? 2.6 + R() * 1.8 : 3.2 + R() * 2.4;
      const d = Math.min(len, t1 - tt);
      const v = i % 5;
      const az = [8, -25, 35, -60, 60][v] * (i % 2 ? -1 : 1);
      const base = style === 'wide' ? 11 : style === 'mid' ? 7.5 : style === 'fast' ? 9 : 5.5;
      if (v === 4 && style !== 'tight') c.shot(tt, d, { shot: 'high', d0: base + 6, d1: base + 3, h0: 9, h1: 6, az0: az, az1: az * 0.4, fov0: 40, fov1: 40, lag: 0.2 });
      else if (v === 3) c.shot(tt, d, { shot: 'low', d0: base - 3, d1: base - 5.5, h0: 0.25, h1: 0.5, az0: az, az1: az * 0.6, fov0: 44, fov1: 42, lag: 0.12 });
      else if (v === 2 && style !== 'wide') c.shot(tt, d, { shot: 'orbit', d0: base, d1: base - 1.5, h0: 1.5, h1: 1.7, az0: az, az1: az + 45 * (i % 2 ? -1 : 1), fov0: 38, fov1: 36, lag: 0.1 });
      else c.shot(tt, d, { shot: 'tracking', d0: base, d1: base - 1.2, h0: 1.4, h1: 1.5, az0: az, az1: az * 0.85, fov0: 38, fov1: 36, lag: 0.16 });
      tt += d; i++;
    }
  };
  coverage(27, 60, 'wide'); coverage(60, 96, 'mid'); coverage(96, 128, 'wide'); coverage(128, 158, 'fast');
  // aerial (both fighters high): dolly/orbit rig
  c.shot(158, 3.5, { shot: 'low', d0: 12, d1: 9, h0: 0.5, h1: 2, az0: 20, az1: -15, fov0: 42, fov1: 40, lag: 0.1 });
  for (let a = 161.5, k = 0; a < 190 - 0.5; a += 3.6, k++) c.shot(a, Math.min(3.6, 189.5 - a), { shot: 'orbit', d0: 11, d1: 9.5, h0: 3, h1: 4, az0: -50 + k * 70, az1: 20 + k * 70, fov0: 40, fov1: 38, lag: 0.25, shake: 0.05 });
  // awakening: wide -> slow push-in -> close-ups (calm, deliberate)
  c.shot(190, 3.4, { shot: 'wide', d0: 32, d1: 24, h0: 3, h1: 2, az0: 0, az1: 10, fov0: 34, fov1: 34, lag: 0.3 });
  c.shot(193.4, 2.4, { shot: 'medium', subject: 'B', bone: 'head', d0: 4, d1: 3.2, h0: 1.7, h1: 1.65, az0: -35, az1: -20, fov0: 30, fov1: 28, lag: 0 });
  c.shot(195.8, 2.8, { shot: 'ots', subject: 'B', d0: 1.5, d1: 1.7, h0: 1.7, h1: 1.7, az0: 0, az1: 0, fov0: 32, fov1: 30, lag: 0 });
  c.shot(198.6, 1.7, { shot: 'close', subject: 'A', bone: 'head', d0: 1.6, d1: 1.2, h0: 1.62, h1: 1.62, az0: 40, az1: 30, fov0: 24, fov1: 20, lag: 0 });
  c.shot(200.3, 3.2, { shot: 'wide', d0: 20, d1: 14, h0: 2, h1: 1.2, az0: 25, az1: 0, fov0: 36, fov1: 36, lag: 0.25 });                                   // 1 light changes
  c.shot(203.5, 2.5, { shot: 'low', subject: 'A', bone: 'chest', d0: 7, d1: 5.5, h0: 0.3, h1: 0.5, az0: 20, az1: 8, fov0: 38, fov1: 36, lag: 0.1, shake: 0.12 });       // 2-3 aura + hair
  c.shot(206, 2.4, { shot: 'eyes', subject: 'A', bone: 'eyes', d0: 0.7, d1: 0.55, h0: 1.64, h1: 1.64, az0: 55, az1: 50, fov0: 20, fov1: 17, lag: 0, shake: 0.2 });       // 5 eyes
  c.shot(208.4, 2.4, { shot: 'feet', subject: 'A', bone: 'feet', d0: 3, d1: 3.6, h0: 0.2, h1: 0.6, az0: 25, az1: 25, fov0: 46, fov1: 46, lag: 0, shake: 0.35 });      // 6-7 dust + cracks
  c.shot(210.8, 1.5, { shot: 'low', subject: 'A', bone: 'chest', d0: 9, d1: 6, h0: 0.2, h1: 1.2, az0: 12, az1: -8, fov0: 46, fov1: 38, lag: 0, shake: 0.5 });                // 8 wave
  c.shot(212.3, 2.6, { shot: 'wide', d0: 22, d1: 26, h0: 6, h1: 8, az0: 30, az1: 40, fov0: 38, fov1: 38, lag: 0.3 });
  c.shot(214.9, 2.2, { shot: 'medium', subject: 'B', bone: 'head', d0: 3.2, d1: 2.8, h0: 1.6, h1: 1.6, az0: -30, az1: -25, fov0: 30, fov1: 28, lag: 0 });
  coverage(217.1, 242, 'fast');
  // finale
  c.shot(242, 2.4, { shot: 'wide', d0: 28, d1: 22, h0: 3, h1: 2, az0: 0, az1: -8, fov0: 34, fov1: 34, lag: 0.3 });
  c.shot(244.4, 2.4, { shot: 'orbit', d0: 15, d1: 13, h0: 1.2, h1: 1.4, az0: 10, az1: 60, fov0: 38, fov1: 36, lag: 0.1, shake: 0.2 });
  c.shot(246.8, 2.2, { shot: 'eyes', subject: 'A', bone: 'eyes', d0: 0.7, d1: 0.5, h0: 1.64, h1: 1.64, az0: 55, az1: 48, fov0: 20, fov1: 15, lag: 0, shake: 0.25 });
  c.shot(249, 2.0, { shot: 'eyes', subject: 'B', bone: 'eyes', d0: 0.8, d1: 0.55, h0: 1.75, h1: 1.75, az0: -55, az1: -48, fov0: 20, fov1: 15, lag: 0, shake: 0.25 });
  c.shot(251, 2.4, { shot: 'low', d0: 16, d1: 11, h0: 0.25, h1: 1.5, az0: 12, az1: 0, fov0: 46, fov1: 36, lag: 0, shake: 0.35 });
  c.shot(fin - 0.9, 0.9, { shot: 'close', subject: 'B', bone: 'chest', d0: 4, d1: 2.6, h0: 1.4, h1: 1.4, az0: -30, az1: -20, fov0: 26, fov1: 22, lag: 0, shake: 0.5 });
  c.shot(fin, 0.45, { shot: 'whipPan', subject: 'A', bone: 'chest', d0: 13, d1: 13, h0: 1.4, h1: 1.4, az0: 8, az1: 8, fov0: 36, fov1: 36, lag: 0 });
  c.shot(fin + 0.45, 0.9, { shot: 'tracking', subject: 'A', bone: 'fistR', d0: 3.8, d1: 4.6, h0: 1.4, h1: 1.5, az0: 12, az1: 20, fov0: 30, fov1: 34, lag: 0.05, shake: 0.4 });
  c.shot(ft + 0.1, 1.2, { shot: 'wide', d0: 20, d1: 30, h0: 2.5, h1: 4, az0: 20, az1: 30, fov0: 40, fov1: 46, lag: 0.3, shake: 0.6 });
  c.shot(ft + 1.3, 2.4, { shot: 'high', d0: 26, d1: 32, h0: 12, h1: 18, az0: 40, az1: 60, fov0: 42, fov1: 42, lag: 0.3, shake: 0.25 });
  // ending
  c.shot(endT, 3.4, { shot: 'low', subject: 'A', bone: 'chest', d0: 9, d1: 7, h0: 0.3, h1: 0.9, az0: 60, az1: 40, fov0: 36, fov1: 34, lag: 0.2 });
  c.shot(endT + 3.4, 2.6, { shot: 'close', subject: 'A', bone: 'head', d0: 2.0, d1: 1.7, h0: 1.62, h1: 1.62, az0: 38, az1: 28, fov0: 26, fov1: 22, lag: 0.1 });
  c.shot(endT + 6, 9.4, { shot: 'wide', d0: 26, d1: 42, h0: 3, h1: 16, az0: 30, az1: -10, fov0: 34, fov1: 32, lag: 0.3 });

  // cut-ins on the biggest hits: quick close reaction shots between coverage shots (never in silence phases)
  const cuts: { a: number; b: number }[] = [];
  for (const b of beats) {
    if (b.power < 0.6 || b.t < 61 || (b.t > 189 && b.t < 214) || b.t > 242 || (b.t > 156 && b.t < 190)) continue;
    if (cuts.length && b.t - cuts[cuts.length - 1].b < 2.2) continue;
    const a = b.t - 0.26, len = 0.5 + 0.35 * b.power;
    const kinds = [{ shot: 'close', subject: b.atk === 'A' ? 'B' : 'A', bone: 'chest', d0: 3.2, d1: 2.4, h0: 1.4, h1: 1.4, az0: 40, az1: 25, fov0: 30, fov1: 26 }, { shot: 'ots', subject: b.atk, d0: 1.5, d1: 1.9, h0: 1.7, h1: 1.7, fov0: 34, fov1: 30 }, { shot: 'low', subject: 'both', d0: 6, d1: 4, h0: 0.3, h1: 0.6, az0: 30, az1: 15, fov0: 44, fov1: 38 }];
    c.shot(a, len, { ...kinds[cuts.length % 3], lag: 0, shake: 0.1 });
    cuts.push({ a, b: a + len });
    // return to wide so the audience can re-orient
    c.shot(a + len, 1.3, { shot: 'tracking', d0: 11, d1: 10, h0: 1.4, h1: 1.5, az0: -20 + (cuts.length % 3) * 20, az1: 0, fov0: 38, fov1: 36, lag: 0.15 });
  }
  c.clips.forEach((cl) => { if (cl.track === 'camera') cl.params = { ...cl.params }; });
  // ensure camera shots are sorted; the camera picks the latest shot that has started, so ordering by start is what matters.

  // ================================================================ AUDIO extras: battle cries, breath, footsteps
  for (const b of beats) {
    if (b.power > 0.75 && b.t > 60 && R() < 0.75) c.add('voice', 'cry', b.t - 0.2, 0.7 + b.power * 0.4, { speaker: b.atk, kind: 'shout', power: r2(b.power) });
    if (b.power > 0.6 && R() < 0.4) c.add('voice', 'cry', b.t + 0.05, 0.5, { speaker: b.atk === 'A' ? 'B' : 'A', kind: 'pain', power: r2(b.power) });
  }
  c.add('voice', 'cry', aw + 9.2, 2.6, { speaker: 'A', kind: 'roar', power: 1 });
  c.add('voice', 'cry', ch + 5.4, 1.4, { speaker: 'B', kind: 'roar', power: 1 }); c.add('voice', 'cry', ch + 5.4, 1.2, { speaker: 'A', kind: 'shout', power: 1 });
  c.add('sfx', 'breathing', 60, 30, { who: 'B', rate: 0.6, power: 0.5 }); c.add('sfx', 'breathing', 96, 30, { who: 'A', rate: 0.75, power: 0.6 });

  // finale lighting (timed from the actual finale events)
  c.light(p8end + 0.6, 4.5, { sunEl: 9, sunCol: '#b09ad8', sunI: 1.1, ambSky: '#5a5c98', skyTop: '#221540', skyHor: '#7a3a5a', fogCol: '#4a2c48', fogDen: 0.005, exposure: 0.9, bloom: 0.6, saturation: 1.0, contrast: 1.25, grade: '#f0e8ff' });
  c.light(ft - 0.06, 0.14, { sunEl: 40, sunCol: '#ffffff', sunI: 3.2, skyTop: '#ffffff', skyHor: '#fff4e0', fogCol: '#ffe6c8', fogDen: 0.008, exposure: 1.4, bloom: 1.4, grade: '#ffffff', saturation: 0.9 });
  c.light(ft + 0.5, 2.6, { sunAz: -25, sunEl: 13, sunCol: '#ffc890', sunI: 1.7, ambSky: '#98a4c8', skyTop: '#3a3a78', skyHor: '#f0a070', fogCol: '#c09070', fogDen: 0.0075, exposure: 0.95, bloom: 0.5, saturation: 1.05, contrast: 1.15, grade: '#ffffff', vignette: 0.4 });
  c.light(endT, 9, { sunAz: -30, sunEl: 11, sunCol: '#ffc8a0', sunI: 1.5, ambSky: '#98a4c8', skyTop: '#6f8fd0', skyHor: '#ffcfb0', fogCol: '#e0b89c', fogDen: 0.0045, cloudCover: 0.5, exposure: 1.0, bloom: 0.42, saturation: 1.05, contrast: 1.1, vignette: 0.35 });
  const markers = [
    { t: 0, label: 'PHASE 1 · SILENCE', color: '#8fc4ff' }, { t: 27, label: 'PHASE 2 · TESTING', color: '#6fd0b0' }, { t: 60, label: 'PHASE 3 · CLOSE COMBAT', color: '#e0c060' },
    { t: 96, label: 'PHASE 4 · ENVIRONMENT DAMAGE', color: '#e0904a' }, { t: 128, label: 'PHASE 5 · HIGH SPEED', color: '#ff6a4a' }, { t: 158, label: 'PHASE 6 · AERIAL COMBAT', color: '#6aa8ff' },
    { t: 190, label: 'PHASE 7 · POWER AWAKENING', color: '#ffd45a' }, { t: 214.5, label: 'POWER STATE', color: '#fff0a0' }, { t: p8end, label: 'FINALE', color: '#ff7ab0' }, { t: endT, label: 'ENDING', color: '#c0b0ff' },
  ];
  return { version: 1, name: 'Duel at Shattered Ridge', duration: total, fps: 30, startPos: { A: [-5.2, 0, 0.4], B: [5.2, 0, -0.3] }, clips: c.clips, markers };
}
void lerp; void rad;
