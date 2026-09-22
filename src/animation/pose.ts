import type { V3 } from '../utils/math.js';

/** Facial rig controls. All values are simple scalars so they can be keyed, blended and edited in the inspector. */
export interface FaceParams {
  browL: number; browR: number;     // -1 lowered .. +1 raised
  tiltL: number; tiltR: number;     // -1 relaxed/sad .. +1 angry (inner end pulled down)
  lidL: number; lidR: number;       // upper eyelid openness 0 closed .. 1 open (1.15 = wide)
  squint: number;                   // lower lid pushes up 0..1
  mouthOpen: number;                // 0..1
  mouthWide: number;                // -1 pursed .. +1 stretched
  smile: number;                    // -1 frown .. +1 smile
  teeth: number;                    // 0..1 how much of the teeth show
  pupil: number;                    // 0.6 tiny .. 1.3 dilated
}

export interface LimbFK { sh: V3; el: number; wr: V3 }     // arm: shoulder euler, elbow bend, wrist euler
export interface LegFK { hip: V3; knee: number; ank: number }

export interface Pose {
  hipsOff: V3;
  bodyPitch: number; bodyRoll: number; twist: number;
  pelvis: V3; spine: V3; chest: V3; neck: V3; head: V3; clavL: V3; clavR: V3;
  handL: V3; handR: V3; footL: V3; footR: V3;        // IK goals, character space (x left, y up, z forward), height-1.8 units
  poleL: V3; poleR: V3; kneeL: V3; kneeR: V3;         // pole hints (direction the elbow / knee points to)
  rollL: number; rollR: number;                       // hand roll about the forearm
  fist: [number, number]; spread: [number, number];
  footPitch: [number, number];
  gaze: [number, number];                             // eye yaw, pitch (positive = up)
  face: FaceParams;
}

export interface FKOverride { armL?: LimbFK; armR?: LimbFK; legL?: LegFK; legR?: LegFK }

export const neutralFace = (): FaceParams => ({
  browL: 0, browR: 0, tiltL: 0, tiltR: 0, lidL: 0.9, lidR: 0.9, squint: 0, mouthOpen: 0, mouthWide: 0, smile: 0, teeth: 0, pupil: 1,
});

export const neutralPose = (): Pose => ({
  hipsOff: [0, -0.03, 0], bodyPitch: 0, bodyRoll: 0, twist: 0,
  pelvis: [0, 0, 0], spine: [0, 0, 0], chest: [0, 0, 0], neck: [0, 0, 0], head: [0, 0, 0], clavL: [0, 0, 0], clavR: [0, 0, 0],
  handL: [0.3, 0.93, 0.08], handR: [-0.3, 0.93, 0.08], footL: [0.12, 0.08, 0.02], footR: [-0.12, 0.08, -0.02],
  poleL: [0.6, -0.2, -1], poleR: [-0.6, -0.2, -1], kneeL: [0.15, 0, 1], kneeR: [-0.15, 0, 1],
  rollL: 0, rollR: 0, fist: [0.15, 0.15], spread: [0, 0], footPitch: [0, 0], gaze: [0, 0], face: neutralFace(),
});

/** deep numeric lerp over plain objects / arrays (used for pose blending) */
export function lerpDeep<T>(a: T, b: T, t: number): T {
  const x: any = a, y: any = b;
  if (typeof x === 'number') return (x + (y - x) * t) as any;
  if (Array.isArray(x)) return x.map((v: any, i: number) => lerpDeep(v, y[i], t)) as any;
  if (x && typeof x === 'object') {
    const o: any = {};
    for (const k in x) o[k] = lerpDeep(x[k], y[k], t);
    return o;
  }
  return (t < 0.5 ? a : b);
}
export const blendPose = (a: Pose, b: Pose, t: number): Pose => (t <= 0 ? a : t >= 1 ? b : lerpDeep(a, b, t));
export const clonePose = (p: Pose): Pose => JSON.parse(JSON.stringify(p));

export type ExpressionName = 'neutral' | 'focus' | 'angry' | 'shock' | 'scream' | 'pain' | 'smile' | 'smirk' | 'calm' | 'exhausted' | 'awakened' | 'blink' | 'strain' | 'grit';
const F = (o: Partial<FaceParams>): FaceParams => ({ ...neutralFace(), ...o });
export const EXPRESSIONS: Record<ExpressionName, FaceParams> = {
  neutral: F({}),
  calm: F({ lidL: 0.72, lidR: 0.72, browL: 0.05, browR: 0.05 }),
  focus: F({ lidL: 0.68, lidR: 0.68, tiltL: 0.45, tiltR: 0.45, browL: -0.25, browR: -0.25, squint: 0.2 }),
  angry: F({ lidL: 0.62, lidR: 0.62, tiltL: 1, tiltR: 1, browL: -0.6, browR: -0.6, squint: 0.35, mouthOpen: 0.1, teeth: 0.7, mouthWide: 0.3, smile: -0.4 }),
  grit: F({ lidL: 0.6, lidR: 0.6, tiltL: 0.9, tiltR: 0.9, browL: -0.5, browR: -0.5, squint: 0.5, mouthOpen: 0.06, teeth: 1, mouthWide: 0.6, smile: -0.2 }),
  shock: F({ lidL: 1.2, lidR: 1.2, browL: 0.9, browR: 0.9, mouthOpen: 0.45, mouthWide: -0.3, pupil: 0.6 }),
  scream: F({ lidL: 0.5, lidR: 0.5, tiltL: 0.9, tiltR: 0.9, browL: -0.4, browR: -0.4, mouthOpen: 1, mouthWide: 0.5, teeth: 0.9, squint: 0.4 }),
  pain: F({ lidL: 0.32, lidR: 0.32, tiltL: -0.6, tiltR: -0.6, browL: 0.35, browR: 0.35, mouthOpen: 0.25, teeth: 1, mouthWide: 0.5, smile: -0.5, squint: 0.7 }),
  smile: F({ lidL: 0.78, lidR: 0.78, smile: 0.9, mouthOpen: 0.1, mouthWide: 0.25, browL: 0.15, browR: 0.15 }),
  smirk: F({ lidL: 0.65, lidR: 0.7, smile: 0.6, browL: 0.35, browR: -0.1, tiltL: 0.15, mouthWide: 0.1 }),
  exhausted: F({ lidL: 0.5, lidR: 0.5, tiltL: -0.25, tiltR: -0.25, browL: 0.05, browR: 0.05, mouthOpen: 0.28, teeth: 0.2, smile: -0.25 }),
  awakened: F({ lidL: 0.7, lidR: 0.7, tiltL: 0.5, tiltR: 0.5, browL: -0.3, browR: -0.3, squint: 0.15, smile: 0.1, pupil: 0.55 }),
  blink: F({ lidL: 0, lidR: 0 }),
  strain: F({ lidL: 0.42, lidR: 0.42, tiltL: 0.8, tiltR: 0.8, browL: -0.55, browR: -0.55, squint: 0.6, mouthOpen: 0.15, teeth: 1, mouthWide: 0.55 }),
};
