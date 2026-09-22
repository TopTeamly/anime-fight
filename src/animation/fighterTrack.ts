import { V, Q, clamp, lerp, smoothstep, wrapPi, type V3 } from '../utils/math.js';
import { ease, type EaseName } from '../utils/ease.js';
import { hash1 } from '../utils/rng.js';
import type { Clip } from '../timeline/model.js';
import { SPECS } from '../characters/specs.js';
import type { CharacterSpec } from '../characters/spec.js';
import type { FighterFrame, FighterVisual } from '../characters/fighter.js';
import { blendPose, EXPRESSIONS, lerpDeep, type Pose, type FaceParams } from './pose.js';
import { applyIn, recipeFor, stancePose, type Goal, type Key, type PIn, type StanceName, type ActionParams } from './actions.js';
import { buildFsm, metersAt, stateFor, contactTime, type FsmData, type Meters } from './fsm.js';

interface Seg { t0: number; t1: number; from: V3; to: V3; ease: EaseName; len: number; cum: number }
const MV: Record<string, [number, number]> = { move: [0, 1], strike: [0.04, 0.95], defend: [0, 0.6], react: [0.02, 0.75], air: [0.05, 0.95], blast: [0, 0.4], charge: [0, 0.3] };
const MV_EASE: Record<string, EaseName> = { move: 'inOut', strike: 'inOut', defend: 'outCubic', react: 'outCubic', air: 'inOut', blast: 'out', charge: 'inOut' };
const ACTION_TYPES = new Set(['move', 'strike', 'defend', 'react', 'air', 'charge', 'blast', 'emote']);
const HIT_H = { head: 1.6, chest: 1.3, gut: 1.05, feet: 0.1 };

export interface Override { face?: FaceParams; faceW?: number; mouth?: number; lookAway?: number }
export interface TrackEval {
  frame: FighterFrame; meters: Meters; speed: number; velWorld: V3; activeType: string | null; activeKind: string | null; chargeLevel: number; root: V3; yaw: number;
}

/** Evaluates one fighter at any time t: root path, stance blending, action keyframes, state modifiers and procedural layers. */
export class FighterTrack {
  spec: CharacterSpec;
  S: number;
  opp!: FighterTrack;
  clips: Clip[] = [];
  private segs: Seg[] = [];
  private stances: Clip[] = [];
  private actions: Clip[] = [];
  fsm: FsmData;
  private start: V3 = [0, 0, 0];
  private defaultYaw: number;
  private seed: number;

  constructor(readonly id: 'A' | 'B') {
    this.spec = SPECS[id];
    this.S = this.spec.scale;
    this.fsm = buildFsm(id, [], []);
    this.defaultYaw = id === 'A' ? Math.PI / 2 : -Math.PI / 2;
    this.seed = id === 'A' ? 3.1 : 7.7;
  }

  setClips(all: Clip[], startPos: V3, oppClips: Clip[]) {
    this.clips = all.slice().sort((a, b) => a.start - b.start);
    this.start = startPos;
    this.stances = this.clips.filter((c) => c.type === 'stance');
    this.actions = this.clips.filter((c) => ACTION_TYPES.has(c.type));
    this.fsm = buildFsm(this.id, this.clips, oppClips);
    // root-motion path (each clip with a "to" target owns a window inside itself)
    this.segs = [];
    let cum = 0;
    const movers = this.actions.filter((c) => Array.isArray(c.params.to) && c.params.to.length === 3 && !(c.type === 'charge' && !c.params.moveTo));
    for (const c of movers) {
      const w: [number, number] = c.params.mv ?? (c.type === 'strike' ? [0.04, (c.params.contact ?? 0.45) * 0.95] : MV[c.type] ?? [0, 1]);
      const t0 = c.start + c.dur * w[0], t1 = c.start + c.dur * w[1];
      const from = this.posAtSegs(t0);
      const to: V3 = [c.params.to[0], c.params.to[1], c.params.to[2]];
      const len = V.dist(from, to);
      this.segs.push({ t0, t1: Math.max(t1, t0 + 0.02), from, to, ease: c.params.ease ?? MV_EASE[c.type] ?? 'inOut', len, cum });
      cum += len;
    }
  }
  private posAtSegs(t: number): V3 {
    let cur: V3 = this.start;
    for (const s of this.segs) {
      if (t >= s.t1) cur = s.to;
      else if (t > s.t0) return V.lerp(s.from, s.to, ease(s.ease, (t - s.t0) / (s.t1 - s.t0)));
      else break;
    }
    return cur;
  }
  rootAt(t: number): V3 { return this.posAtSegs(t); }
  motionSegments() { return this.segs.map((s) => ({ t0: s.t0, t1: s.t1, from: s.from, to: s.to, ease: s.ease, len: s.len })); }
  /** distance travelled along the path up to t (drives walk cycles) */
  travelAt(t: number): number {
    let d = 0;
    for (const s of this.segs) {
      if (t >= s.t1) d += s.len;
      else if (t > s.t0) { d += s.len * ease(s.ease, (t - s.t0) / (s.t1 - s.t0)); break; } else break;
    }
    return d;
  }
  yawAt(t: number): number {
    const me = this.rootAt(t), op = this.opp.rootAt(t - 0.05);
    const dx = op[0] - me[0], dz = op[2] - me[2];
    return Math.hypot(dx, dz) < 0.08 ? this.defaultYaw : Math.atan2(dx, dz);
  }
  metersAt(t: number): Meters { return metersAt(this.fsm, t, this.rootAt(t)[1]); }
  hitPoint(t: number, tgt: keyof typeof HIT_H): V3 { const r = this.rootAt(t); return [r[0], r[1] + HIT_H[tgt] * this.S, r[2]]; }

  private stanceBase(t: number, rootY: number): Pose {
    let cur = -1;
    for (let i = 0; i < this.stances.length; i++) if (this.stances[i].start <= t) cur = i; else break;
    const kindOf = (i: number): StanceName => (i < 0 ? 'guard' : (this.stances[i].params.kind as StanceName) ?? 'guard');
    let base = stancePose(kindOf(cur));
    if (cur >= 0) {
      const c = this.stances[cur], bl = c.params.blend ?? 0.4;
      const k = clamp((t - c.start) / bl);
      if (k < 1) base = blendPose(stancePose(kindOf(cur - 1)), base, smoothstep(0, 1, k));
    }
    const airW = smoothstep(0.3, 1.0, rootY);
    return airW > 0 ? blendPose(base, stancePose('air'), airW) : base;
  }

  private goalLocal(g: Goal, ctx: { root: V3; yaw: number; t: number }, m: Pose): V3 {
    const S = this.S;
    let W: V3;
    if (Array.isArray(g)) return g;
    if ('opp' in g) {
      const hit = this.opp.hitPoint(ctx.t, g.tgt ?? 'chest');
      let toward = V.norm([ctx.root[0] - hit[0], 0, ctx.root[2] - hit[2]]);
      if (V.len([toward[0], toward[2], 0]) < 0.01) toward = V.fromYaw(ctx.yaw + Math.PI);
      const fwd = V.neg(toward), left = V.cross([0, 1, 0], fwd);
      W = V.add(V.add(V.add(hit, V.mul(toward, g.opp[2])), V.mul(left, g.opp[0])), [0, g.opp[1], 0]);
    } else W = g.pt;
    let rel = V.sub(W, ctx.root);
    rel = Q.rotate(Q.axisAngle([0, 1, 0], -(ctx.yaw + m.twist)), rel);
    const pivot: V3 = [0, 0.96 * S, 0];
    const qBody = Q.mul(Q.axisAngle([1, 0, 0], m.bodyPitch), Q.axisAngle([0, 0, 1], m.bodyRoll));
    const v = V.add(pivot, Q.rotate(Q.conj(qBody), V.sub(rel, pivot)));
    return V.mul(v, 1 / S);
  }

  private keyPose(base: Pose, key: PIn, ctx: { root: V3; yaw: number; t: number }): Pose {
    const goalKeys = ['handL', 'handR', 'footL', 'footR'] as const;
    const plain: PIn = { ...key };
    const goals: Partial<Record<(typeof goalKeys)[number], Goal>> = {};
    for (const k of goalKeys) if (k in plain) { goals[k] = (plain as any)[k]; delete (plain as any)[k]; }
    const merged = applyIn(base, plain);
    for (const k of goalKeys) { const g = goals[k]; if (g) (merged as any)[k] = this.goalLocal(g, ctx, merged); }
    return merged;
  }

  private clipPose(c: Clip, u: number, base: Pose, ctx: { root: V3; yaw: number; t: number }): Pose | null {
    const keys: Key[] | null = recipeFor(c.type, c.params as ActionParams);
    if (!keys) return null;
    let i = 0;
    while (i < keys.length - 2 && u > keys[i + 1][0]) i++;
    const a = keys[i], b = keys[Math.min(i + 1, keys.length - 1)];
    const pa = this.keyPose(base, a[1], ctx);
    if (a === b) return pa;
    const k = clamp((u - a[0]) / Math.max(1e-4, b[0] - a[0]));
    const pb = this.keyPose(base, b[1], ctx);
    return lerpDeep(pa, pb, ease(b[2], k));
  }

  evaluate(t: number, wind: number, ov?: Override): TrackEval {
    const root = this.rootAt(t), yaw = this.yawAt(t), S = this.S;
    const meters = this.metersAt(t);
    const ctx = { root, yaw, t };
    let pose = this.stanceBase(t, root[1]);
    const base = pose;
    let activeType: string | null = null, activeKind: string | null = null, chargeLevel = 0;
    // sequential blend of all active action clips
    for (const c of this.actions) {
      if (c.start > t) break;
      const end = c.start + c.dur, fadeOut = Math.min(0.14, c.dur * 0.3);
      if (t > end + fadeOut) continue;
      const u = clamp((t - c.start) / c.dur);
      let cp = this.clipPose(c, u, base, ctx);
      if (!cp) continue;
      const fadeIn = Math.min(0.1, c.dur * 0.25);
      let w = smoothstep(0, fadeIn, t - c.start) * (t > end ? 1 - smoothstep(0, fadeOut, t - end) : 1);
      if (meters.power > 0 && (c.type === 'defend' || c.type === 'react' || c.type === 'move')) cp = blendPose(cp, base, 0.4 * meters.power);
      pose = blendPose(pose, cp, clamp(w));
      if (t <= end) { activeType = c.type; activeKind = c.params.kind ?? null; }
      if (c.type === 'charge' && t <= end + 0.3) chargeLevel = Math.max(chargeLevel, (c.params.level ?? 0.5) * smoothstep(0, Math.min(1.2, c.dur * 0.5), t - c.start));
    }
    const state = stateFor(activeType, meters, activeKind ?? undefined);
    meters.state = state;
    pose = JSON.parse(JSON.stringify(pose)) as Pose;

    // ---- state modifiers
    const f = meters.fatigue;
    pose.spine[0] += 0.28 * f; pose.hipsOff[1] -= 0.05 * f; pose.head[0] -= 0.1 * f;
    if (f > 0.05) { pose.handL[1] -= 0.1 * f; pose.handR[1] -= 0.1 * f; }
    // ---- procedural layers
    const breathRate = 0.28 + 0.9 * f;
    const br = Math.sin(t * Math.PI * 2 * breathRate + this.seed);
    pose.chest[0] += br * (0.018 + 0.05 * f); pose.head[0] -= br * 0.008; pose.hipsOff[0] += Math.sin(t * 0.55 + this.seed) * 0.006;
    // speed-based lean and footwork
    const dt = 0.03, p1 = this.rootAt(t - dt), p2 = this.rootAt(t + dt);
    const vel = V.mul(V.sub(p2, p1), 1 / (2 * dt));
    const vl = Q.rotate(Q.axisAngle([0, 1, 0], -yaw), vel);
    const speed = Math.hypot(vel[0], vel[2]);
    const grounded = 1 - smoothstep(0.3, 1.0, root[1]);
    pose.bodyPitch += clamp(vl[2] * 0.05, -0.35, 0.65) * (1 - smoothstep(0.5, 1.2, root[1]) * 0.5);
    pose.bodyRoll += clamp(vl[0] * -0.03, -0.4, 0.4);
    if (grounded > 0.5 && speed > 0.25) {
      const walk = smoothstep(0.2, 0.7, speed) * (1 - smoothstep(3, 4.2, speed));
      const ph = (this.travelAt(t) / (0.75 * S)) * Math.PI;
      const sw = Math.sin(ph), cw = Math.cos(ph);
      if (walk > 0.02) {
        pose.footL[2] += 0.26 * sw * walk; pose.footL[1] += 0.11 * Math.max(0, cw) * walk;
        pose.footR[2] -= 0.26 * sw * walk; pose.footR[1] += 0.11 * Math.max(0, -cw) * walk;
        pose.hipsOff[1] += 0.012 * Math.abs(sw) * walk;
      }
      const drag = smoothstep(3, 5.5, speed);
      if (drag > 0.02) { pose.footL[2] -= 0.28 * drag; pose.footR[2] -= 0.4 * drag; pose.footL[1] += 0.04 * drag; pose.spine[0] += 0.15 * drag; pose.handL[2] -= 0.15 * drag; pose.handR[2] -= 0.15 * drag; }
    }
    // gaze: eyes and head follow the opponent's head
    const op = this.opp.rootAt(t);
    const dxy: V3 = [op[0] - root[0], (op[1] + 1.55 * this.opp.S) - (root[1] + 1.6 * S), op[2] - root[2]];
    const gy = clamp(wrapPi(Math.atan2(dxy[0], dxy[2]) - yaw - pose.twist - pose.pelvis[1] - pose.spine[1] - pose.chest[1]), -0.7, 0.7);
    const gp = clamp(Math.atan2(dxy[1], Math.hypot(dxy[0], dxy[2])), -0.5, 0.5);
    const away = ov?.lookAway ?? 0;
    pose.gaze = [lerp(gy * 0.9, 0.5, away), lerp(gp, -0.15, away)];
    pose.head[1] += gy * 0.55 * (1 - away); pose.head[0] -= gp * 0.5 * (1 - away);
    // face: rage / power / fatigue blends, dialogue override, blink, lip-sync
    let face: FaceParams = pose.face;
    if (meters.rage > 0.05 && this.id === 'B') face = lerpDeep(face, EXPRESSIONS.angry, 0.55 * meters.rage);
    if (meters.power > 0.02) face = lerpDeep(face, EXPRESSIONS.awakened, 0.7 * meters.power);
    if (f > 0.05) face = lerpDeep(face, EXPRESSIONS.exhausted, 0.45 * f);
    if (ov?.face) face = lerpDeep(face, ov.face, ov.faceW ?? 1);
    const cyc = Math.floor(t / 3.3), ph = t - cyc * 3.3, at = 0.6 + hash1(cyc * 1.7 + this.seed) * 2.3, bl = Math.abs(ph - at);
    const blink = bl < 0.09 ? bl / 0.09 : 1;
    face = { ...face, lidL: face.lidL * blink, lidR: face.lidR * blink, mouthOpen: Math.max(face.mouthOpen, ov?.mouth ?? 0) };
    pose.face = face;

    const visual = this.visualFor(meters, chargeLevel);
    return {
      frame: { rootPos: root, yaw, pose, visual, time: t, wind }, meters, speed, velWorld: vel, activeType, activeKind, chargeLevel, root, yaw,
    };
  }

  private visualFor(m: Meters, charge: number): FighterVisual {
    const p = m.power, r = this.id === 'B' ? m.rage : 0;
    return {
      power: p, rage: m.rage, fatigue: m.fatigue,
      aura: Math.max(p, charge * 0.85, r > 0.35 ? (r - 0.35) * 0.7 : 0),
      auraMix: this.id === 'A' ? p : clamp((r - 0.5) * 2),
      eyeGlow: clamp(p + Math.max(0, r - 0.5) * 1.2 + charge * 0.3), hairGlow: clamp(p * 0.9 + charge * 0.45), bodyGlow: clamp(p * 0.7 + charge * 0.6),
      hairLift: this.id === 'A' ? clamp(p * 0.95 + charge * 0.4) : clamp(r * 0.3 + charge * 0.6),
    };
  }
}
export { contactTime };
