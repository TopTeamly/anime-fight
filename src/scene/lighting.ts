import { V, lerp, type V3 } from '../utils/math.js';
import { hex } from '../engine/meshbuilder.js';

/** Everything the "Lighting" track animates: sun/ambient/rim, fog, sky palette and the post grade. */
export interface LightingState {
  sunDir: V3; sunCol: V3; ambSky: V3; ambGround: V3; rimCol: V3; rimDir: V3;
  fogCol: V3; fogDen: number;
  skyTop: V3; skyHor: V3; glow: number; cloudLit: V3; cloudShade: V3; cloudCover: number; wind: number;
  exposure: number; bloom: number; bloomThresh: number; contrast: number; saturation: number; vignette: number; grade: V3;
}
export type LightingKeys = Partial<{ [K in keyof LightingState]: LightingState[K] extends V3 ? V3 | string : LightingState[K] }>;

export const linHex = (h: string): V3 => { const v = hex(h); return [v[0] ** 2.2, v[1] ** 2.2, v[2] ** 2.2]; };
const c = (h: string): V3 => { const v = hex(h); return [v[0] ** 2.2, v[1] ** 2.2, v[2] ** 2.2]; };
export const DEFAULT_LIGHTING: LightingState = {
  sunDir: V.norm([-0.55, 0.42, 0.45]), sunCol: V.mul(c('#ffe0bb'), 1.7), ambSky: V.mul(c('#7f96d0'), 0.9), ambGround: V.mul(c('#8a6a58'), 0.7),
  rimCol: V.mul(c('#9fc8ff'), 0.9), rimDir: V.norm([0.6, 0.3, -0.6]),
  fogCol: c('#cfa98f'), fogDen: 0.0034,
  skyTop: c('#3c5fa8'), skyHor: c('#f0b98f'), glow: 1.0, cloudLit: c('#fff0dd'), cloudShade: c('#a5a2c6'), cloudCover: 0.56, wind: 1,
  exposure: 1.0, bloom: 0.35, bloomThresh: 1.0, contrast: 1.08, saturation: 1.1, vignette: 0.28, grade: [1, 1, 1],
};

const norm = (k: LightingKeys): Partial<LightingState> => {
  const o: any = {};
  for (const [key, v] of Object.entries(k)) o[key] = typeof v === 'string' ? c(v) : v;
  return o;
};
/** merge partial keys (hex strings allowed for colours) over a full state */
export function mergeLighting(base: LightingState, k: LightingKeys): LightingState {
  return { ...base, ...norm(k) } as LightingState;
}
export function lerpLighting(a: LightingState, b: LightingState, t: number): LightingState {
  const o: any = {};
  for (const key of Object.keys(a) as (keyof LightingState)[]) {
    const x: any = a[key], y: any = b[key];
    o[key] = Array.isArray(x) ? x.map((v: number, i: number) => lerp(v, y[i], t)) : lerp(x, y, t);
  }
  o.sunDir = V.norm(o.sunDir); o.rimDir = V.norm(o.rimDir);
  return o as LightingState;
}
