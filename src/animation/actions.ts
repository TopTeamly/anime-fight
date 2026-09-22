import type { V3 } from '../utils/math.js';
import type { EaseName } from '../utils/ease.js';
import { neutralPose, EXPRESSIONS, type Pose, type FaceParams, type ExpressionName } from './pose.js';

/** IK goal: plain character-local vector, a point relative to the opponent's hit point, or a fixed world point. */
export type Goal = V3 | { opp: V3; tgt?: 'head' | 'chest' | 'gut' | 'feet' } | { pt: V3 };
export type PIn = Partial<Omit<Pose, 'handL' | 'handR' | 'footL' | 'footR' | 'face'>> & { handL?: Goal; handR?: Goal; footL?: Goal; footR?: Goal; face?: Partial<FaceParams> | ExpressionName };
export type Key = [t: number, p: PIn, ease?: EaseName];

export interface ActionParams {
  kind?: string; side?: 'L' | 'R'; power?: number; to?: V3; target?: 'head' | 'chest' | 'gut' | 'ground' | 'feet'; miss?: boolean; contact?: number;
  point?: V3; expr?: ExpressionName; level?: number; dir?: V3; look?: string; mv?: [number, number]; ease?: EaseName; spd?: number;
  [k: string]: unknown;
}

const o = (x: number, y: number, z: number, tgt: 'head' | 'chest' | 'gut' | 'feet' = 'chest'): Goal => ({ opp: [x, y, z], tgt });

// ------------------------------------------------------------------------------------------------ stances
export type StanceName = 'neutral' | 'relaxed' | 'guard' | 'guardLow' | 'armsCrossed' | 'powered' | 'air' | 'crouch' | 'exhausted' | 'lie' | 'charge' | 'awakenPose';

const pose = (p: PIn): Pose => applyIn(neutralPose(), p);
export function applyIn(base: Pose, p: PIn): Pose {
  const out: any = { ...base, face: { ...base.face } };
  for (const k in p) {
    const v: any = (p as any)[k];
    if (k === 'face') out.face = typeof v === 'string' ? { ...EXPRESSIONS[v as ExpressionName] } : { ...out.face, ...v };
    else out[k] = v;
  }
  return out as Pose;
}

const GUARD: PIn = {
  hipsOff: [0, -0.13, 0.02], pelvis: [0.02, -0.45, 0], spine: [0.1, 0.22, 0], chest: [0.04, 0.14, 0], neck: [-0.04, 0.0, 0], head: [-0.02, 0.1, 0],
  handL: [0.15, 1.23, 0.34], handR: [-0.1, 1.26, 0.24], poleL: [0.7, -0.5, -0.4], poleR: [-0.7, -0.5, -0.4], fist: [0.95, 0.95],
  footL: [0.17, 0.08, 0.28], footR: [-0.15, 0.08, -0.22], kneeL: [0.25, 0, 1], kneeR: [-0.1, 0, 1], face: 'focus',
};
export const STANCES: Record<StanceName, PIn> = {
  neutral: {},
  relaxed: { hipsOff: [0, -0.03, 0], head: [0.05, 0, 0], handL: [0.28, 0.9, 0.1], handR: [-0.28, 0.9, 0.06], fist: [0.3, 0.3], face: 'calm', footL: [0.12, 0.08, 0.04], footR: [-0.12, 0.08, -0.04], pelvis: [0, 0.05, 0.02] },
  guard: GUARD,
  guardLow: {
    ...GUARD, hipsOff: [0, -0.2, 0.0], pelvis: [0.02, -0.35, 0], spine: [0.14, 0.15, 0], head: [0.02, 0.05, 0],
    handL: [0.28, 1.05, 0.34], handR: [-0.22, 1.1, 0.24], footL: [0.27, 0.08, 0.24], footR: [-0.25, 0.08, -0.2], kneeL: [0.6, 0, 1], kneeR: [-0.6, 0, 1], face: 'angry',
  },
  armsCrossed: {
    hipsOff: [0, -0.03, 0], pelvis: [0, -0.12, 0], spine: [0.02, 0.06, 0], head: [0.06, 0.15, 0.05], handL: [-0.17, 1.2, 0.16], handR: [0.17, 1.14, 0.18],
    poleL: [0, -1, 0.2], poleR: [0, -1, 0.2], fist: [0.6, 0.6], footL: [0.17, 0.08, 0.03], footR: [-0.17, 0.08, -0.03], face: 'smirk',
  },
  powered: {
    hipsOff: [0, -0.02, 0], pelvis: [0, 0.04, 0], spine: [-0.02, 0, 0], head: [-0.06, 0, 0], handL: [0.27, 0.95, 0.1], handR: [-0.27, 0.95, 0.08], fist: [0.15, 0.15],
    poleL: [0.7, -0.2, -1], poleR: [-0.7, -0.2, -1], footL: [0.13, 0.08, 0.06], footR: [-0.13, 0.08, -0.06], face: 'awakened',
  },
  air: {
    hipsOff: [0, 0.0, 0], pelvis: [0.1, 0, 0], spine: [0.08, 0, 0], head: [-0.05, 0, 0], handL: [0.24, 1.2, 0.3], handR: [-0.14, 1.24, 0.24], fist: [0.9, 0.9],
    footL: [0.12, 0.3, -0.1], footR: [-0.12, 0.16, -0.26], kneeL: [0.1, 0.2, 1], kneeR: [-0.1, 0.2, 1], face: 'focus',
  },
  crouch: { hipsOff: [0, -0.32, 0.03], spine: [0.45, 0, 0], head: [-0.4, 0, 0], handL: [0.25, 0.75, 0.3], handR: [-0.25, 0.75, 0.3], footL: [0.2, 0.08, 0.18], footR: [-0.2, 0.08, -0.14], kneeL: [0.4, 0, 1], kneeR: [-0.4, 0, 1] },
  exhausted: {
    hipsOff: [0, -0.1, 0.03], spine: [0.42, 0, 0.04], chest: [0.1, 0, 0], head: [-0.32, 0, 0.05], handL: [0.26, 0.82, 0.16], handR: [-0.26, 0.8, 0.14], fist: [0.35, 0.35],
    footL: [0.15, 0.08, 0.1], footR: [-0.15, 0.08, -0.1], kneeL: [0.3, 0, 1], kneeR: [-0.3, 0, 1], face: 'exhausted',
  },
  lie: {
    hipsOff: [0, -0.7, 0], bodyPitch: -1.5, head: [0.2, 0, 0], handL: [0.4, 0.4, 0.1], handR: [-0.4, 0.4, 0.1], footL: [0.15, 0.2, 0.2], footR: [-0.15, 0.2, 0.2], face: 'pain',
  },
  charge: {
    hipsOff: [0, -0.24, 0], spine: [0.2, 0, 0], head: [0.05, 0, 0], handL: [0.14, 0.95, 0.32], handR: [-0.14, 0.95, 0.32], fist: [0.2, 0.2],
    footL: [0.26, 0.08, 0.06], footR: [-0.26, 0.08, -0.06], kneeL: [0.6, 0, 1], kneeR: [-0.6, 0, 1], face: 'strain',
  },
  awakenPose: { hipsOff: [0, -0.02, 0], spine: [-0.08, 0, 0], chest: [-0.12, 0, 0], head: [-0.32, 0, 0], handL: [0.5, 1.0, 0.0], handR: [-0.5, 1.0, 0.0], poleL: [0.3, -1, 0], poleR: [-0.3, -1, 0], fist: [0.9, 0.9], footL: [0.14, 0.08, 0.02], footR: [-0.14, 0.08, -0.02], face: 'strain' },
};

// ------------------------------------------------------------------------------------------------ helpers
const swapLR = (k: string) => (k.endsWith('L') ? k.slice(0, -1) + 'R' : k.endsWith('R') ? k.slice(0, -1) + 'L' : k);
const mv3 = (v: V3): V3 => [-v[0], v[1], v[2]];
const mirrorGoal = (g: Goal): Goal => (Array.isArray(g) ? mv3(g) : 'opp' in g ? { ...g, opp: mv3(g.opp) } : { pt: mv3(g.pt) });
/** mirror a pose delta across the sagittal plane (left <-> right) */
export function mirrorIn(p: PIn): PIn {
  const out: any = {};
  for (const k in p) {
    const v: any = (p as any)[k];
    if (['handL', 'handR', 'footL', 'footR'].includes(k)) out[swapLR(k)] = mirrorGoal(v);
    else if (['poleL', 'poleR', 'kneeL', 'kneeR'].includes(k)) out[swapLR(k)] = mv3(v);
    else if (['clavL', 'clavR'].includes(k)) out[swapLR(k)] = [v[0], -v[1], -v[2]];
    else if (['pelvis', 'spine', 'chest', 'neck', 'head'].includes(k)) out[k] = [v[0], -v[1], -v[2]];
    else if (k === 'hipsOff') out[k] = mv3(v);
    else if (k === 'bodyRoll' || k === 'twist') out[k] = -v;
    else if (k === 'rollL' || k === 'rollR') out[swapLR(k)] = -v;
    else if (k === 'fist' || k === 'spread' || k === 'footPitch') out[k] = [v[1], v[0]];
    else if (k === 'gaze') out[k] = [-v[0], v[1]];
    else out[k] = v;
  }
  return out;
}
const mirrorKeys = (ks: Key[]): Key[] => ks.map(([t, p, e]) => [t, mirrorIn(p), e] as Key);

/** the recipe context: power in 0..1 scales wind-ups, lunges and leans */
export interface RecipeCtx { power: number; side: 'L' | 'R'; target: 'head' | 'chest' | 'gut' | 'ground' | 'feet'; miss: boolean; contact: number; point?: V3; dir?: V3; params: ActionParams }
type Recipe = (c: RecipeCtx) => Key[];

const tgt = (c: RecipeCtx): 'head' | 'chest' | 'gut' | 'feet' => (c.target === 'ground' ? 'feet' : c.target);
/** goal at the opponent (or slightly past their head/side when the attack is meant to miss) */
const at = (c: RecipeCtx, z = 0.13, x = 0, y = 0): Goal => (c.miss ? o(0.36 + x, 0.14 + y, z + 0.05, tgt(c)) : o(x, y, z, tgt(c)));

// ------------------------------------------------------------------------------------------------ STRIKES (authored for the right hand/foot, mirrored for left)
const R_CROSS: Recipe = (c) => { const a = 0.75 + 0.5 * c.power, f = c.contact; return [
  [0, {}],
  [f * 0.55, { pelvis: [0.02, -0.45 - 0.35 * a, 0], spine: [0.12, 0.22 + 0.12 * a, 0], chest: [0.02, 0.14 + 0.14 * a, 0], hipsOff: [0, -0.16, -0.07 * a], handR: [-0.18, 1.2, 0.08], handL: [0.12, 1.28, 0.28] }, 'inOut'],
  [f, { pelvis: [0.02, 0.2, 0], spine: [0.24 * a, -0.12, 0], chest: [0.05, -0.2, 0], hipsOff: [0, -0.11, 0.17 * a], handR: at(c), handL: [0.06, 1.34, 0.26], footR: [-0.15, 0.08, -0.12], poleR: [-0.6, -0.3, -0.6], head: [0.0, -0.05, 0] }, 'in'],
  [Math.min(0.92, f + 0.18), { pelvis: [0.02, 0.15, 0], spine: [0.2 * a, -0.1, 0], handR: at(c, 0.09), hipsOff: [0, -0.12, 0.15 * a], head: [0, -0.05, 0] }, 'out'],
  [1, {}, 'inOut'],
]; };
const L_JAB: Recipe = (c) => { const a = 0.75 + 0.5 * c.power, f = c.contact; return [
  [0, {}],
  [f * 0.5, { handL: [0.13, 1.24, 0.2], spine: [0.1, 0.16, 0], hipsOff: [0, -0.13, -0.02] }, 'inOut'],
  [f, { handL: at(c, 0.12), spine: [0.14 * a, 0.42, 0], chest: [0.05, 0.34, 0], pelvis: [0.02, -0.35, 0], hipsOff: [0, -0.12, 0.12 * a], poleL: [0.2, -0.9, -0.3] }, 'in'],
  [Math.min(0.9, f + 0.15), { handL: at(c, 0.08), spine: [0.13 * a, 0.4, 0] }, 'out'],
  [1, {}, 'inOut'],
]; };
const R_HOOK: Recipe = (c) => { const a = 0.75 + 0.5 * c.power, f = c.contact; return [
  [0, {}],
  [f * 0.6, { pelvis: [0.02, -0.9 * a, 0], spine: [0.12, 0.4, 0], chest: [0, 0.3, -0.1], handR: [-0.42, 1.34, 0.2], poleR: [-0.5, -0.4, 0.8], hipsOff: [0, -0.17, -0.06] }, 'inOut'],
  [f, { pelvis: [0.02, 0.35, 0], spine: [0.18 * a, -0.35, 0], chest: [0.05, -0.32, 0.1], handR: at(c, 0.16, -0.12, 0.02), poleR: [-0.9, 0.2, 0.2], hipsOff: [0, -0.12, 0.14 * a], footR: [-0.15, 0.08, -0.05], head: [0, -0.1, 0.08] }, 'in'],
  [Math.min(0.94, f + 0.16), { spine: [0.16 * a, -0.3, 0], handR: at(c, 0.1, -0.1, 0.02) }, 'out'],
  [1, {}, 'inOut'],
]; };
const R_UPPER: Recipe = (c) => { const a = 0.75 + 0.5 * c.power, f = c.contact; return [
  [0, {}],
  [f * 0.6, { hipsOff: [0, -0.3 * a, -0.03], spine: [0.3, -0.1, 0.1], handR: [-0.16, 0.92, 0.2], pelvis: [0, -0.5, 0], handL: [0.1, 1.3, 0.26] }, 'inOut'],
  [f, { hipsOff: [0, -0.06, 0.13 * a], spine: [-0.05, -0.25, -0.08], chest: [-0.2, -0.1, 0], handR: at(c, 0.14, 0, -0.14), poleR: [-0.8, -0.6, -0.2], head: [-0.15, 0, 0], footR: [-0.15, 0.08, -0.06] }, 'in'],
  [1, {}, 'inOut'],
]; };
const R_ELBOW: Recipe = (c) => { const f = c.contact; return [
  [0, {}],
  [f * 0.5, { pelvis: [0, -0.7, 0], handR: [-0.25, 1.35, 0.12], spine: [0.15, 0.3, 0] }, 'inOut'],
  [f, { pelvis: [0, 0.35, 0], spine: [0.2, -0.3, 0], handR: at(c, 0.35, -0.08, 0.06), poleR: [-1, 0.2, -0.3], fist: [0.9, 0.9], hipsOff: [0, -0.13, 0.12] }, 'in'],
  [1, {}, 'inOut'],
]; };
const R_KNEE: Recipe = (c) => { const f = c.contact; return [
  [0, {}],
  [f * 0.6, { hipsOff: [0, -0.16, -0.05], handL: [0.14, 1.2, 0.3], handR: [-0.1, 1.24, 0.24], spine: [0.15, 0.2, 0] }, 'inOut'],
  [f, { hipsOff: [0, -0.03, 0.12], footR: at(c, 0.14, 0, 0) as Goal, kneeR: [-0.1, 0.5, 1], spine: [-0.1, -0.1, 0], handL: at(c, 0.05, 0.1, 0.4), footL: [0.17, 0.08, 0.12], head: [0.1, 0, 0] }, 'in'],
  [1, {}, 'inOut'],
]; };
const R_KICK_FRONT: Recipe = (c) => { const f = c.contact; return [
  [0, {}],
  [f * 0.6, { hipsOff: [0, -0.1, -0.03], footR: [-0.14, 0.62, 0.16], kneeR: [-0.1, 0.6, 1], spine: [0.05, 0.1, 0], handL: [0.15, 1.3, 0.3], footL: [0.17, 0.08, 0.16] }, 'inOut'],
  [f, { footR: at(c, 0.16), kneeR: [-0.1, 0.5, 1], footPitch: [0, -0.6], spine: [-0.15, 0.1, 0], hipsOff: [0, -0.02, 0.06], footL: [0.17, 0.08, 0.14] }, 'in'],
  [1, {}, 'inOut'],
]; };
const R_KICK_ROUND: Recipe = (c) => { const a = 0.7 + 0.5 * c.power, f = c.contact; return [
  [0, {}],
  [f * 0.55, { pelvis: [0, -0.9, 0], bodyRoll: 0.1, footR: [-0.35, 0.65, -0.1], kneeR: [-0.9, 0.3, 0.5], spine: [0.1, 0.4, 0], hipsOff: [0, -0.15, -0.04], handL: [0.15, 1.3, 0.3], handR: [-0.2, 1.3, 0.2] }, 'inOut'],
  [f, { pelvis: [0.05, 0.6, 0], bodyRoll: 0.42 * a, spine: [0.05, -0.4, -0.2], footR: at(c, 0.18, -0.1, tgt(c) === 'head' ? 0.0 : -0.05), kneeR: [-0.8, 0.2, 0.5], footPitch: [0, -0.6], handR: [-0.55, 1.35, -0.15], handL: [0.4, 1.0, 0.1], footL: [0.17, 0.08, 0.05], hipsOff: [0, -0.04, 0.06] }, 'in'],
  [Math.min(0.94, f + 0.18), { bodyRoll: 0.3 * a, pelvis: [0, 0.4, 0], footR: at(c, 0.08, -0.15, -0.05) }, 'out'],
  [1, {}, 'inOut'],
]; };
const R_SPIN_KICK: Recipe = (c) => { const f = c.contact; return [
  [0, {}],
  [f * 0.45, { twist: 1.6, pelvis: [0, -0.5, 0], spine: [0.15, 0, 0], hipsOff: [0, -0.2, 0], handL: [0.3, 1.1, 0.2], handR: [-0.3, 1.1, 0.2] }, 'in'],
  [f, { twist: 3.6, bodyRoll: 0.4, footR: at(c, 0.2, -0.1, -0.02), kneeR: [-0.5, 0.2, 0.6], handR: [-0.6, 1.3, -0.1], handL: [0.5, 1.2, 0.1], hipsOff: [0, -0.05, 0.05] }, 'in'],
  [Math.min(0.95, f + 0.2), { twist: 4.4, bodyRoll: 0.2, footR: at(c, 0.1, -0.2) }, 'out'],
  [1, { twist: 0 }, 'inOut'],
]; };
const AXE: Recipe = (c) => { const a = 0.75 + 0.5 * c.power, f = c.contact; return [
  [0, {}],
  [f * 0.6, { spine: [-0.3, 0, 0], chest: [-0.2, 0, 0], handL: [0.14, 1.95, -0.05], handR: [-0.14, 1.95, -0.05], poleL: [0.5, 0.6, -0.7], poleR: [-0.5, 0.6, -0.7], hipsOff: [0, -0.06, -0.1], fist: [1, 1], head: [-0.2, 0, 0] }, 'inOut'],
  [f, { spine: [0.6 * a, 0, 0], chest: [0.2, 0, 0], handL: at(c, 0.12, 0.08, 0.1), handR: at(c, 0.12, -0.08, 0.1), hipsOff: [0, -0.24, 0.16], head: [0.2, 0, 0], footL: [0.22, 0.08, 0.18], footR: [-0.22, 0.08, -0.16], poleL: [0.6, -0.4, -0.6], poleR: [-0.6, -0.4, -0.6] }, 'in'],
  [1, {}, 'inOut'],
]; };
const SLAM: Recipe = (c) => { const a = 0.75 + 0.5 * c.power, f = c.contact; const P = c.point ?? [0, 0, 0]; return [
  [0, {}],
  [f * 0.6, { hipsOff: [0, -0.06, -0.05], spine: [-0.25, 0, 0], handR: [-0.1, 1.85, 0.0], handL: [0.1, 1.85, 0.0], fist: [1, 1], poleL: [0.5, 0.5, -0.8], poleR: [-0.5, 0.5, -0.8] }, 'inOut'],
  [f, { hipsOff: [0, -0.4 * a, 0.12], spine: [0.75 * a, 0, 0], handR: { pt: [P[0], P[1] + 0.05, P[2]] }, handL: { pt: [P[0], P[1] + 0.05, P[2]] }, head: [0.3, 0, 0], footL: [0.3, 0.08, 0.14], footR: [-0.3, 0.08, -0.14], kneeL: [0.7, 0, 1], kneeR: [-0.7, 0, 1] }, 'in'],
  [1, {}, 'inOut'],
]; };
const PALM: Recipe = (c) => { const f = c.contact; return [
  [0, {}],
  [f * 0.5, { pelvis: [0, -0.7, 0], handR: [-0.2, 1.15, 0.1], fist: [0.95, 0.1], spread: [0, 1], spine: [0.1, 0.3, 0] }, 'inOut'],
  [f, { pelvis: [0, 0.3, 0], spine: [0.2, -0.1, 0], handR: at(c, 0.14), fist: [0.95, 0.0], spread: [0, 1], hipsOff: [0, -0.14, 0.15], poleR: [-0.6, -0.3, -0.6] }, 'in'],
  [1, {}, 'inOut'],
]; };
const GRAB_THROW: Recipe = (c) => { const f = c.contact; return [
  [0, {}],
  [f * 0.5, { handL: at(c, 0.2, 0.15, 0.2), handR: at(c, 0.2, -0.15, 0.1), hipsOff: [0, -0.15, 0.1], spine: [0.25, 0, 0], fist: [0.9, 0.9] }, 'inOut'],
  [f, { handL: at(c, 0.25, 0.15, 0.25), handR: at(c, 0.25, -0.15, 0.1), hipsOff: [0, -0.2, 0.05], spine: [0.15, 0.6, 0], pelvis: [0, -0.9, 0] }, 'in'],
  [Math.min(0.95, f + 0.28), { handL: [0.5, 1.5, -0.1], handR: [0.2, 1.0, 0.1], spine: [0.35, -0.7, 0], pelvis: [0, 0.4, 0], hipsOff: [0, -0.22, 0.15], twist: 0.7 }, 'out'],
  [1, {}, 'inOut'],
]; };

// ------------------------------------------------------------------------------------------------ DEFENCES
const DEF: Record<string, Recipe> = {
  blockHigh: (c) => [[0, {}], [0.25, { handL: [0.05, 1.56, 0.3], handR: [-0.05, 1.56, 0.3], poleL: [0.9, 0.3, 0], poleR: [-0.9, 0.3, 0], hipsOff: [0, -0.16, -0.03], head: [0.12, 0, 0], face: 'grit' }, 'out'], [0.75, { handL: [0.05, 1.56, 0.3], handR: [-0.05, 1.56, 0.3], poleL: [0.9, 0.3, 0], poleR: [-0.9, 0.3, 0], hipsOff: [0, -0.16, -0.04], spine: [0.05 + 0.1 * c.power, 0.1, 0], head: [0.12, 0, 0], face: 'grit' }], [1, {}, 'inOut']],
  blockCross: (c) => [[0, {}], [0.25, { handL: [-0.05, 1.28, 0.32], handR: [0.05, 1.3, 0.34], poleL: [0.4, -0.9, 0], poleR: [-0.4, -0.9, 0], hipsOff: [0, -0.2, -0.04], spine: [0.22, 0.1, 0], face: 'grit' }, 'out'], [0.75, { handL: [-0.05, 1.28, 0.32], handR: [0.05, 1.3, 0.34], hipsOff: [0, -0.2, -0.05 - 0.05 * c.power], spine: [0.22, 0.1, 0], face: 'grit' }], [1, {}, 'inOut']],
  parry: () => [[0, {}], [0.35, { handR: [-0.45, 1.3, 0.42], pelvis: [0, -0.2, 0], spine: [0.1, 0.5, 0], chest: [0, 0.3, 0] }, 'out'], [0.7, { handR: [-0.2, 1.3, 0.3], spine: [0.1, 0.3, 0] }], [1, {}, 'inOut']],
  duck: () => [[0, {}], [0.3, { hipsOff: [0, -0.5, 0.05], spine: [0.55, 0, 0], head: [-0.4, 0, 0], handL: [0.2, 0.9, 0.3], handR: [-0.2, 0.9, 0.3], kneeL: [0.5, 0, 1], kneeR: [-0.5, 0, 1] }, 'out'], [0.7, { hipsOff: [0, -0.5, 0.05], spine: [0.55, 0, 0], head: [-0.4, 0, 0], handL: [0.2, 0.9, 0.3], handR: [-0.2, 0.9, 0.3], kneeL: [0.5, 0, 1], kneeR: [-0.5, 0, 1] }], [1, {}, 'inOut']],
  lean: () => [[0, {}], [0.3, { hipsOff: [0.02, -0.14, -0.06], spine: [0.1, 0.1, -0.5], chest: [0, 0, -0.15], head: [0, 0, 0.35], bodyRoll: -0.15 }, 'out'], [0.7, { hipsOff: [0.02, -0.14, -0.06], spine: [0.1, 0.1, -0.5], chest: [0, 0, -0.15], head: [0, 0, 0.35], bodyRoll: -0.15 }], [1, {}, 'inOut']],
  sidestep: () => [[0, {}], [0.35, { hipsOff: [0, -0.2, 0], spine: [0.2, 0, 0.2], footL: [0.4, 0.08, 0.1], footR: [-0.05, 0.08, -0.1], bodyRoll: 0.08 }, 'out'], [1, {}, 'inOut']],
  backstep: () => [[0, {}], [0.3, { hipsOff: [0, -0.1, -0.1], spine: [-0.1, 0, 0], footL: [0.15, 0.08, -0.1], footR: [-0.15, 0.08, -0.4], head: [0.1, 0, 0] }, 'out'], [1, {}, 'inOut']],
  microDodge: () => [[0, {}], [0.25, { hipsOff: [0.05, -0.03, -0.02], chest: [0, 0.1, -0.12], head: [0, 0.05, 0.14], face: 'awakened' }, 'out'], [0.6, { hipsOff: [0.05, -0.03, -0.02], chest: [0, 0.1, -0.12], head: [0, 0.05, 0.14] }], [1, {}, 'inOut']],
  blink: () => [[0, {}], [0.5, { face: 'awakened' }], [1, {}]],
  flip: () => [[0, {}], [0.2, { hipsOff: [0, -0.25, 0], spine: [0.2, 0, 0] }, 'out'], [0.4, { bodyPitch: -3.14, hipsOff: [0, 0.1, 0], handL: [0.3, 0.6, 0.1], handR: [-0.3, 0.6, 0.1], footL: [0.15, 0.4, 0], footR: [-0.15, 0.4, 0] }, 'inOut'], [0.8, { bodyPitch: -6.28, hipsOff: [0, 0, 0] }, 'inOut'], [1, { bodyPitch: -6.28 }, 'out']],
  airDodge: () => [[0, {}], [0.4, { bodyRoll: 0.9, twist: 0.6, hipsOff: [0.1, 0, 0], handL: [0.5, 1.2, 0.1], handR: [-0.5, 1.0, 0.1] }, 'out'], [1, {}, 'inOut']],
};

// ------------------------------------------------------------------------------------------------ REACTIONS
const REACT: Record<string, Recipe> = {
  flinch: () => [[0, {}], [0.15, { head: [-0.4, 0.3, 0.1], chest: [-0.25, 0, 0], spine: [-0.15, 0, 0], hipsOff: [0, -0.1, -0.06], face: 'pain', handL: [0.3, 1.2, 0.25], handR: [-0.2, 1.2, 0.2] }, 'out'], [0.5, { head: [-0.2, 0.15, 0.05], chest: [-0.1, 0, 0], face: 'pain' }], [1, {}, 'inOut']],
  stagger: () => [[0, {}], [0.2, { head: [-0.5, 0.2, 0.1], chest: [-0.4, 0.1, 0], spine: [-0.2, 0, 0], hipsOff: [0, -0.12, -0.12], handL: [0.55, 1.15, 0.0], handR: [-0.55, 1.1, 0.0], footL: [0.15, 0.08, -0.2], footR: [-0.15, 0.08, -0.5], face: 'pain', poleL: [1, 0, 0], poleR: [-1, 0, 0] }, 'out'], [0.7, { head: [-0.25, 0, 0.1], chest: [-0.2, 0, 0], hipsOff: [0, -0.12, -0.1], handL: [0.4, 1.0, 0.1], handR: [-0.4, 1.0, 0.1], face: 'pain' }], [1, {}, 'inOut']],
  knockback: () => [[0, {}], [0.15, { bodyPitch: -0.55, head: [-0.5, 0, 0], handL: [0.6, 1.5, -0.2], handR: [-0.6, 1.3, -0.2], footL: [0.15, 0.4, 0.2], footR: [-0.15, 0.25, 0.3], face: 'pain', poleL: [1, 0, 0], poleR: [-1, 0, 0] }, 'out'], [0.7, { bodyPitch: -0.7, head: [-0.5, 0, 0], handL: [0.6, 1.6, -0.3], handR: [-0.6, 1.4, -0.3], footL: [0.2, 0.5, 0.1], footR: [-0.2, 0.3, 0.2], face: 'pain' }], [1, { bodyPitch: -0.4, face: 'pain' }, 'inOut']],
  slam: () => [[0, {}], [0.2, { bodyPitch: -0.9, face: 'pain', handL: [0.6, 1.4, -0.2], handR: [-0.6, 1.3, -0.2] }, 'out'], [0.45, { bodyPitch: -1.45, hipsOff: [0, -0.3, 0], face: 'pain', head: [-0.3, 0, 0], handL: [0.7, 0.4, 0], handR: [-0.7, 0.4, 0], footL: [0.15, 0.3, 0.2], footR: [-0.15, 0.3, 0.2] }, 'in'], [1, { bodyPitch: -1.5, hipsOff: [0, -0.35, 0], face: 'pain', handL: [0.7, 0.3, 0], handR: [-0.7, 0.3, 0] }]],
  thrown: () => [[0, {}], [0.15, { bodyPitch: -0.4, face: 'shock', handL: [0.5, 1.4, 0], handR: [-0.5, 1.4, 0] }, 'out'], [0.85, { bodyPitch: -6.5, face: 'pain', handL: [0.5, 1.3, 0.2], handR: [-0.5, 1.3, 0.2], footL: [0.15, 0.4, 0], footR: [-0.15, 0.4, 0] }, 'linear'], [1, { bodyPitch: -7.6, face: 'pain' }, 'out']],
  spinHit: () => [[0, {}], [0.2, { twist: 1.2, head: [-0.3, 0.4, 0], chest: [-0.2, 0, 0], face: 'pain' }, 'out'], [0.7, { twist: 4.4, head: [-0.2, 0, 0], face: 'pain', hipsOff: [0, -0.15, -0.1] }, 'inOut'], [1, { twist: 6.28 }, 'inOut']],
  airHit: () => [[0, {}], [0.2, { bodyPitch: -0.7, head: [-0.5, 0, 0], handL: [0.6, 1.5, -0.2], handR: [-0.6, 1.3, -0.2], face: 'pain' }, 'out'], [1, { bodyPitch: -0.5, face: 'pain', handL: [0.5, 1.3, -0.1], handR: [-0.5, 1.1, -0.1] }, 'inOut']],
  getup: () => [[0, { bodyPitch: -1.5, hipsOff: [0, -0.5, 0], face: 'pain', handL: [0.4, 0.4, 0.2], handR: [-0.4, 0.4, 0.2] }], [0.45, { bodyPitch: -0.5, hipsOff: [0, -0.35, 0], spine: [0.5, 0, 0], face: 'strain', handL: [0.35, 0.3, 0.3], handR: [-0.35, 0.3, 0.3], footL: [0.2, 0.08, 0.2], footR: [-0.2, 0.08, -0.1] }, 'inOut'], [1, {}, 'inOut']],
};

// ------------------------------------------------------------------------------------------------ AIR
const AIR: Record<string, Recipe> = {
  ascend: () => [[0, {}], [0.25, { hipsOff: [0, -0.25, 0], spine: [0.3, 0, 0] }, 'out'], [0.6, { bodyPitch: 0.15, hipsOff: [0, 0.05, 0], handL: [0.3, 0.5, -0.35], handR: [-0.3, 0.5, -0.35], footL: [0.1, 0.25, -0.2], footR: [-0.1, 0.1, -0.3], head: [-0.25, 0, 0], face: 'focus' }, 'out'], [1, {}, 'inOut']],
  glide: () => [[0, {}], [0.3, { bodyPitch: 1.15, hipsOff: [0, 0, 0], handL: [0.18, 1.2, 0.7], handR: [-0.18, 1.2, 0.7], fist: [1, 1], footL: [0.1, 0.2, -0.55], footR: [-0.1, 0.15, -0.6], head: [-0.6, 0, 0], face: 'focus' }, 'out'], [0.8, { bodyPitch: 1.15, handL: [0.18, 1.2, 0.7], handR: [-0.18, 1.2, 0.7], fist: [1, 1], footL: [0.1, 0.2, -0.55], footR: [-0.1, 0.15, -0.6], head: [-0.6, 0, 0] }], [1, {}, 'inOut']],
  spin: () => [[0, {}], [0.5, { bodyRoll: 3.14, hipsOff: [0, 0.05, 0], handL: [0.4, 1.0, 0.2], handR: [-0.4, 1.0, 0.2] }, 'inOut'], [1, { bodyRoll: 6.28 }, 'inOut']],
  diveKick: () => [[0, {}], [0.3, { bodyPitch: 1.2, footR: [-0.1, 0.3, -0.5], handL: [0.3, 1.2, 0.5], handR: [-0.3, 1.2, 0.5] }, 'inOut'], [0.6, { bodyPitch: -0.9, footR: { opp: [-0.05, 0, 0.16], tgt: 'chest' }, kneeR: [-0.1, 0.4, 1], handL: [0.5, 1.4, -0.2], handR: [-0.5, 1.3, -0.2], footL: [0.15, 0.4, -0.3] }, 'in'], [1, {}, 'inOut']],
};

// ------------------------------------------------------------------------------------------------ CHARGE / BLAST / EMOTE
const CHARGE: Record<string, Recipe> = {
  ki: (c) => [[0, {}], [0.25, { ...STANCES.charge, handL: [0.12, 0.95, 0.22], handR: [-0.12, 0.95, 0.22], face: 'strain' }, 'out'], [1, { ...STANCES.charge, handL: [0.14, 1.0 + 0.05 * c.power, 0.3], handR: [-0.14, 1.0 + 0.05 * c.power, 0.3], spine: [0.24, 0, 0], face: 'strain' }]],
  fistCharge: () => [[0, {}], [0.3, { pelvis: [0, -0.8, 0], handR: [-0.3, 1.1, -0.05], handL: [0.2, 1.3, 0.3], hipsOff: [0, -0.22, -0.08], face: 'grit', spine: [0.15, 0.3, 0] }, 'out'], [1, { pelvis: [0, -0.85, 0], handR: [-0.32, 1.12, -0.06], handL: [0.2, 1.3, 0.3], hipsOff: [0, -0.24, -0.08], face: 'grit', spine: [0.15, 0.3, 0] }]],
  beam: () => [[0, {}], [0.4, { hipsOff: [0, -0.2, -0.05], spine: [0.1, 0, 0], handL: [0.08, 1.15, 0.25], handR: [-0.08, 1.15, 0.25], face: 'strain', footL: [0.25, 0.08, 0.15], footR: [-0.25, 0.08, -0.2] }, 'out'], [1, { hipsOff: [0, -0.22, -0.06], handL: [0.08, 1.15, 0.22], handR: [-0.08, 1.15, 0.22], spine: [0.12, 0, 0], face: 'strain', footL: [0.25, 0.08, 0.15], footR: [-0.25, 0.08, -0.2] }]],
  awaken: () => [
    [0, {}], [0.15, { ...STANCES.awakenPose, hipsOff: [0, -0.08, 0], face: 'calm' }, 'inOut'],
    [0.55, { ...STANCES.awakenPose, hipsOff: [0, -0.04, 0], head: [-0.4, 0, 0], handL: [0.62, 0.95, -0.05], handR: [-0.62, 0.95, -0.05], face: 'strain' }, 'inOut'],
    [0.85, { ...STANCES.awakenPose, head: [-0.5, 0, 0], chest: [-0.2, 0, 0], handL: [0.72, 1.15, -0.1], handR: [-0.72, 1.15, -0.1], face: 'scream', bodyPitch: -0.05 }, 'out'],
    [1, { ...STANCES.powered }, 'inOut'],
  ],
  aura: () => [[0, {}], [0.3, { spine: [-0.25, 0, 0], head: [-0.4, 0, 0], handL: [0.5, 1.2, 0.05], handR: [-0.5, 1.2, 0.05], fist: [1, 1], face: 'scream' }, 'out'], [1, { spine: [-0.25, 0, 0], head: [-0.4, 0, 0], handL: [0.5, 1.2, 0.05], handR: [-0.5, 1.2, 0.05], fist: [1, 1], face: 'scream' }]],
};
const BLAST: Record<string, Recipe> = {
  ball: (c) => [[0, {}], [0.3, { handR: [-0.25, 1.35, 0.1], handL: [0.15, 1.3, 0.3], pelvis: [0, -0.7, 0], face: 'grit', fist: [0.9, 0] }, 'inOut'], [0.5, { handR: [-0.1, 1.35, 0.6 + 0.1 * c.power], pelvis: [0, 0.1, 0], spine: [0.2, -0.1, 0], fist: [0.9, 0], spread: [0, 1], face: 'scream' }, 'in'], [1, {}, 'inOut']],
  wave: (c) => [[0, {}], [0.3, { handL: [0.1, 1.2, 0.15], handR: [-0.1, 1.2, 0.15], hipsOff: [0, -0.2, -0.06], face: 'strain' }, 'inOut'], [0.5, { handL: [0.07, 1.3, 0.62], handR: [-0.07, 1.3, 0.62], hipsOff: [0, -0.16, 0.06], spine: [0.15 + 0.1 * c.power, 0, 0], spread: [1, 1], fist: [0, 0], face: 'scream', poleL: [0.6, -0.4, -0.3], poleR: [-0.6, -0.4, -0.3] }, 'in'], [0.85, { handL: [0.07, 1.3, 0.6], handR: [-0.07, 1.3, 0.6], hipsOff: [0, -0.16, 0.05], spine: [0.15, 0, 0], spread: [1, 1], fist: [0, 0], face: 'scream' }], [1, {}, 'inOut']],
  beam: () => [[0, {}], [0.2, { handL: [0.07, 1.3, 0.62], handR: [-0.07, 1.3, 0.62], hipsOff: [0, -0.16, 0.06], spine: [0.15, 0, 0], spread: [1, 1], fist: [0, 0], face: 'scream' }, 'in'], [0.9, { handL: [0.07, 1.3, 0.66], handR: [-0.07, 1.3, 0.66], hipsOff: [0, -0.16, 0.05], spine: [0.15, 0, 0], spread: [1, 1], fist: [0, 0], face: 'scream' }], [1, {}, 'inOut']],
  barrage: () => [[0, {}], [0.15, { handR: [-0.1, 1.3, 0.55], handL: [0.2, 1.2, 0.2], fist: [0.8, 0], face: 'scream' }, 'in'], [0.3, { handL: [0.1, 1.3, 0.55], handR: [-0.2, 1.2, 0.2], fist: [0, 0.8], face: 'scream' }, 'in'], [0.45, { handR: [-0.1, 1.35, 0.55], handL: [0.2, 1.25, 0.2], fist: [0.8, 0], face: 'scream' }, 'in'], [0.6, { handL: [0.1, 1.3, 0.55], handR: [-0.2, 1.2, 0.2], fist: [0, 0.8], face: 'scream' }, 'in'], [0.8, { handR: [-0.1, 1.35, 0.55], handL: [0.2, 1.25, 0.2], fist: [0.8, 0], face: 'scream' }, 'in'], [1, {}, 'inOut']],
};
const EMOTE: Record<string, Recipe> = {
  shout: () => [[0, {}], [0.2, { head: [-0.25, 0, 0], chest: [-0.15, 0, 0], face: 'scream' }, 'out'], [0.8, { head: [-0.25, 0, 0], chest: [-0.15, 0, 0], face: 'scream' }], [1, {}, 'inOut']],
  taunt: () => [[0, {}], [0.3, { head: [0.05, 0.15, 0.12], handL: [0.3, 1.05, 0.35], poleL: [1, 0, 0], fist: [0.1, 0.9], face: 'smirk', chest: [0, 0.1, 0.05] }, 'out'], [1, {}, 'inOut']],
  talk: () => [[0, {}], [0.4, { head: [0.03, 0.06, 0.03], face: 'calm' }], [1, {}]],
  look: () => [[0, {}], [1, {}]],
  stare: () => [[0, {}], [0.5, { head: [-0.03, 0, 0], face: 'focus' }], [1, {}]],
  wince: () => [[0, {}], [0.3, { face: 'strain', head: [0.1, 0, 0] }, 'out'], [1, {}]],
};
const STEP: Recipe = (c) => [[0, {}], [0.5, { hipsOff: [0, -0.02 - 0.03 * c.power, 0] }], [1, {}]];

const STRIKES: Record<string, { r: Recipe; left?: boolean }> = {
  cross: { r: R_CROSS }, jab: { r: L_JAB, left: true }, hook: { r: R_HOOK }, uppercut: { r: R_UPPER }, elbow: { r: R_ELBOW }, knee: { r: R_KNEE },
  kickFront: { r: R_KICK_FRONT }, kickRound: { r: R_KICK_ROUND }, kickHigh: { r: R_KICK_ROUND }, spinKick: { r: R_SPIN_KICK }, axe: { r: AXE }, slam: { r: SLAM },
  palm: { r: PALM }, grabThrow: { r: GRAB_THROW },
};

/** Resolve a clip (type, kind) into normalised pose keys. `L` side mirrors the recipe. */
export function recipeFor(type: string, p: ActionParams): Key[] | null {
  const kind = p.kind ?? '';
  const ctx: RecipeCtx = { power: p.power ?? 0.5, side: p.side ?? 'R', target: p.target ?? 'chest', miss: !!p.miss, contact: p.contact ?? 0.45, point: p.point, dir: p.dir, params: p };
  let keys: Key[] | null = null, native: 'L' | 'R' = 'R';
  switch (type) {
    case 'strike': { const s = STRIKES[kind]; if (!s) return null; keys = s.r(ctx); native = s.left ? 'L' : 'R'; break; }
    case 'defend': keys = (DEF[kind] ?? DEF.blockHigh)(ctx); native = kind === 'parry' ? 'R' : 'R'; break;
    case 'react': keys = (REACT[kind] ?? REACT.flinch)(ctx); break;
    case 'air': keys = (AIR[kind] ?? AIR.ascend)(ctx); break;
    case 'charge': keys = (CHARGE[kind] ?? CHARGE.ki)(ctx); break;
    case 'blast': keys = (BLAST[kind] ?? BLAST.ball)(ctx); break;
    case 'emote': keys = (EMOTE[kind] ?? EMOTE.talk)(ctx); break;
    case 'move': keys = STEP(ctx); break;
    default: return null;
  }
  if (type === 'strike' && ctx.side !== native) keys = mirrorKeys(keys);
  if (type === 'blast' && ctx.side === 'L' && kind === 'ball') keys = mirrorKeys(keys);
  return keys;
}

export const STRIKE_KINDS = Object.keys(STRIKES);
export const DEFEND_KINDS = Object.keys(DEF);
export const REACT_KINDS = Object.keys(REACT);
export const AIR_KINDS = Object.keys(AIR);
export const CHARGE_KINDS = Object.keys(CHARGE);
export const BLAST_KINDS = Object.keys(BLAST);
export const EMOTE_KINDS = Object.keys(EMOTE);
export const stancePose = (n: StanceName): Pose => pose(STANCES[n] ?? {});
/** how far (m, root-to-root) a strike kind needs to be from the target for the limb to reach it */
export const STRIKE_REACH: Record<string, number> = {
  jab: 0.95, cross: 0.92, hook: 0.9, uppercut: 0.82, elbow: 0.62, knee: 0.66, kickFront: 1.28, kickRound: 1.3, kickHigh: 1.3, spinKick: 1.32, axe: 0.85, slam: 0.5, palm: 0.95, grabThrow: 0.8,
};
