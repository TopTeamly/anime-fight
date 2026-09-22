import type { CharacterSpec, ClumpSpec, ClothSpec } from './spec.js';

const m = (x: number): number => x;
const sym = (c: ClumpSpec): ClumpSpec[] => (Math.abs(c.at[0]) < 0.001 ? [c] : [c, { ...c, at: [-c.at[0], c.at[1], c.at[2]], dir: [-c.dir[0], c.dir[1], c.dir[2]] }]);
const C = (at: [number, number, number], dir: [number, number, number], len: number, w: number, stiff: number, group: ClumpSpec['group'], seg = 4): ClumpSpec[] => sym({ at, dir, len, w, stiff, group, seg });

/** CHARACTER A - "Sael": calm, precise, silver hair, charcoal tunic with a crimson sash and long scarf */
const hairA: ClumpSpec[] = [
  ...C([0, 0.23, -0.03], [0, 0.25, -1], 0.24, 0.036, 0.16, 'back'), ...C([0.04, 0.222, -0.04], [0.25, 0.2, -1], 0.22, 0.034, 0.16, 'back'),
  ...C([0.075, 0.2, -0.03], [0.6, 0.1, -0.9], 0.18, 0.03, 0.18, 'back'), ...C([0, 0.195, -0.085], [0, -0.35, -1], 0.27, 0.04, 0.12, 'back'),
  ...C([0.05, 0.178, -0.09], [0.2, -0.5, -1], 0.24, 0.036, 0.12, 'back'),
  ...C([0, 0.24, 0.03], [0, 0.55, -0.9], 0.17, 0.034, 0.2, 'top'), ...C([0.045, 0.235, 0.02], [0.3, 0.4, -0.8], 0.17, 0.032, 0.2, 'top'),
  ...C([0.03, 0.23, 0.07], [0.15, -0.75, 0.6], 0.14, 0.028, 0.13, 'front'), ...C([0.06, 0.215, 0.062], [0.5, -0.95, 0.3], 0.16, 0.026, 0.12, 'front'),
  ...C([0, 0.236, 0.062], [0, -0.55, 0.85], 0.11, 0.028, 0.14, 'front'), ...C([0.09, 0.16, 0.02], [0.35, -1, 0.1], 0.13, 0.022, 0.1, 'side'),
];
const clothA: ClothSpec[] = [
  { tag: 'coatL', bone: 'hips', at: [0.1, -0.02, -0.09], dir: [0.06, -1, -0.32], len: 0.72, w0: 0.17, w1: 0.12, seg: 6, stiff: 0.05, color: '#24272f', color2: '#8a90a0', drag: 0.9 },
  { tag: 'coatR', bone: 'hips', at: [-0.1, -0.02, -0.09], dir: [-0.06, -1, -0.32], len: 0.72, w0: 0.17, w1: 0.12, seg: 6, stiff: 0.05, color: '#24272f', color2: '#8a90a0', drag: 0.9 },
  { tag: 'coatC', bone: 'hips', at: [0, -0.03, -0.115], dir: [0, -1, -0.28], len: 0.62, w0: 0.19, w1: 0.13, seg: 6, stiff: 0.05, color: '#1c1e25', color2: '#6d7382' },
  { tag: 'scarfA', bone: 'neck', at: [0.02, 0.055, -0.05], dir: [0.12, -0.25, -1], len: 0.66, w0: 0.085, w1: 0.06, seg: 7, stiff: 0.03, color: '#9b1c2e', color2: '#c83a4d' },
  { tag: 'scarfB', bone: 'neck', at: [-0.02, 0.05, -0.05], dir: [-0.2, -0.45, -1], len: 0.5, w0: 0.08, w1: 0.055, seg: 6, stiff: 0.03, color: '#7f1d2c', color2: '#b53347' },
  { tag: 'sash', bone: 'hips', at: [0.14, 0.1, 0.04], dir: [0.4, -1, 0.3], len: 0.5, w0: 0.07, w1: 0.05, seg: 5, stiff: 0.05, color: '#7f1d2c', color2: '#b53347' },
];
export const SPEC_A: CharacterSpec = {
  id: 'A', name: 'Sael', style: 'A', scale: 1.0, shoulderW: 1.0, hipW: 1.0, torsoDepth: 1.0, limbThick: 1.0, headScale: 1.0, chest: 1.0,
  skin: '#eac9b4', skinShade: '#c99d8a', hair: '#c5cbd6', hairTip: '#f5f7fb', iris: '#8fb3d4', irisRing: '#3d566e',
  eye: { w: 0.03, h: 0.019, tilt: 0.16, lash: 1.2, y: 0.133, x: 0.043 }, brow: { thick: 0.0016, x: 0.046, y: 0.168, len: 0.05 },
  top: '#24272f', topAccent: '#c8ced9', pants: '#30323a', boots: '#1b1c22', bootAccent: '#9aa1af', glove: '#17181d', belt: '#7f1d2c', trim: '#c8ced9',
  aura: { base: '#cfe3ff', base2: '#8fb6ff', power: '#fff1b0', power2: '#ffb63b' }, glow: '#ffe9a0',
  clumps: hairA, cloth: clothA, voice: { pitch: 0.8, rate: 0.9, speaker: 'sael' },
};

/** CHARACTER B - "Korran": confident, aggressive, blue spiked hair, indigo vest, bronze pauldron */
const hairB: ClumpSpec[] = [
  ...C([0, 0.245, 0.02], [0, 1, 0.15], 0.19, 0.042, 0.28, 'top'), ...C([0.045, 0.24, 0.0], [0.35, 1, -0.1], 0.21, 0.042, 0.28, 'top'),
  ...C([0.082, 0.225, -0.01], [0.85, 0.8, -0.1], 0.17, 0.038, 0.28, 'top'), ...C([0, 0.24, -0.05], [0, 0.9, -0.5], 0.22, 0.044, 0.26, 'top'),
  ...C([0, 0.205, -0.09], [0, 0.3, -1], 0.32, 0.048, 0.2, 'back'), ...C([0.05, 0.195, -0.085], [0.35, 0.1, -1], 0.28, 0.046, 0.2, 'back'),
  ...C([0.086, 0.175, -0.05], [0.8, 0.1, -0.7], 0.22, 0.04, 0.22, 'back'), ...C([0.03, 0.23, 0.075], [0.2, 0.3, 0.9], 0.12, 0.032, 0.26, 'front'),
  ...C([0.07, 0.218, 0.055], [0.7, 0.2, 0.7], 0.13, 0.03, 0.26, 'front'), ...C([0, 0.236, 0.08], [0, 0.1, 1], 0.1, 0.032, 0.26, 'front'),
];
const clothB: ClothSpec[] = [
  { tag: 'sashL', bone: 'hips', at: [0.14, 0.1, 0.05], dir: [0.3, -1, 0.15], len: 0.55, w0: 0.1, w1: 0.08, seg: 5, stiff: 0.05, color: '#cd8b3b', color2: '#e6c07a' },
  { tag: 'sashR', bone: 'hips', at: [-0.14, 0.1, 0.05], dir: [-0.3, -1, 0.15], len: 0.48, w0: 0.1, w1: 0.08, seg: 5, stiff: 0.05, color: '#a96a26', color2: '#d4a35a' },
  { tag: 'cape', bone: 'chest', at: [0, 0.14, -0.115], dir: [0, -1, -0.12], len: 0.95, w0: 0.3, w1: 0.36, seg: 7, stiff: 0.03, color: '#182046', color2: '#d0742a', drag: 0.9 },
  { tag: 'band', bone: 'head', at: [0, 0.16, -0.098], dir: [0.35, -0.2, -1], len: 0.42, w0: 0.05, w1: 0.04, seg: 6, stiff: 0.04, color: '#cd8b3b', color2: '#e6c07a' },
];
export const SPEC_B: CharacterSpec = {
  id: 'B', name: 'Korran', style: 'B', scale: 1.07, shoulderW: 1.22, hipW: 1.12, torsoDepth: 1.18, limbThick: 1.28, headScale: 1.02, chest: 1.22,
  skin: '#c88e68', skinShade: '#a0684c', hair: '#2f7bff', hairTip: '#8fd3ff', iris: '#ffb02e', irisRing: '#7a3d10',
  eye: { w: 0.034, h: 0.021, tilt: 0.2, lash: 1.5, y: 0.132, x: 0.045 }, brow: { thick: 0.0023, x: 0.048, y: 0.166, len: 0.056 },
  top: '#1e2d5c', topAccent: '#cd8b3b', pants: '#26314f', boots: '#3b2a22', bootAccent: '#6d4a32', glove: '#2a2a2a', belt: '#cd8b3b', trim: '#e6b565',
  aura: { base: '#3a7dff', base2: '#8a52ff', power: '#ff5a3a', power2: '#ffb060' }, glow: '#5aa2ff',
  clumps: hairB, cloth: clothB, voice: { pitch: 0.55, rate: 1.0, speaker: 'korran' },
};
void m;
export const SPECS = { A: SPEC_A, B: SPEC_B };
