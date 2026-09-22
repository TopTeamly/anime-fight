import type { V3 } from '../utils/math.js';

/** Hair clump = tapered prism driven by a spring chain. Positions are head-local (metres at scale 1). */
export interface ClumpSpec {
  at: V3; dir: V3; len: number; w: number; seg?: number; stiff: number; curl?: number; group: 'front' | 'top' | 'back' | 'side'; tint?: number;
}
/** Cloth ribbon driven by a spring chain, anchored to a bone. */
export interface ClothSpec {
  bone: string; at: V3; dir: V3; len: number; w0: number; w1: number; seg: number; stiff: number; color: string; color2?: string; drag?: number; tag: string;
}

export interface CharacterSpec {
  id: 'A' | 'B';
  name: string;
  style: 'A' | 'B';
  scale: number; shoulderW: number; hipW: number; torsoDepth: number; limbThick: number; headScale: number; chest: number;
  skin: string; skinShade: string; hair: string; hairTip: string; iris: string; irisRing: string;
  eye: { w: number; h: number; tilt: number; lash: number; y: number; x: number };
  brow: { thick: number; x: number; y: number; len: number };
  top: string; topAccent: string; pants: string; boots: string; bootAccent: string; glove: string; belt: string; trim: string;
  aura: { base: string; base2: string; power: string; power2: string };
  glow: string;
  clumps: ClumpSpec[];
  cloth: ClothSpec[];
  voice: { pitch: number; rate: number; speaker: string };
}
