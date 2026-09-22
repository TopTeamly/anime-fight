import { clamp } from './math.js';

export type EaseName =
  | 'linear' | 'in' | 'out' | 'inOut' | 'inCubic' | 'outCubic' | 'inOutCubic' | 'outExpo' | 'inExpo'
  | 'outBack' | 'inOutSine' | 'snap' | 'hold';

const fns: Record<EaseName, (t: number) => number> = {
  linear: (t) => t,
  in: (t) => t * t,
  out: (t) => 1 - (1 - t) * (1 - t),
  inOut: (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
  inCubic: (t) => t * t * t,
  outCubic: (t) => 1 - Math.pow(1 - t, 3),
  inOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  outExpo: (t) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t)),
  inExpo: (t) => (t <= 0 ? 0 : Math.pow(2, 10 * t - 10)),
  outBack: (t) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); },
  inOutSine: (t) => -(Math.cos(Math.PI * t) - 1) / 2,
  snap: (t) => (t < 0.85 ? 0.05 * (t / 0.85) : 0.05 + 0.95 * Math.pow((t - 0.85) / 0.15, 0.6)),
  hold: (t) => (t < 1 ? 0 : 1),
};

export function ease(name: EaseName | undefined, t: number): number {
  return (fns[name ?? 'linear'] ?? fns.linear)(clamp(t));
}
export const EASE_NAMES = Object.keys(fns) as EaseName[];
