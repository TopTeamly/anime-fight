import type { V3 } from '../utils/math.js';

export interface CameraState { pos: V3; target: V3; fov: number; roll: number; near: number; far: number }
export interface ShockDistort { x: number; y: number; radius: number; amp: number; thick: number }
export interface FlashLight { pos: V3; color: V3; intensity: number }

/** screen-space effects gathered from the active VFX and camera each frame */
export interface PostState {
  flash: [number, number, number, number];
  impact: number;          // 0 off, 1 ink (white bg), 2 negative
  impactTint: V3;
  speedLines: number; speedColor: V3; speedCx: number; speedCy: number;
  radial: number; radialCx: number; radialCy: number;
  whip: number; whipAngle: number;
  chroma: number; heat: number; fade: number; grain: number;
  distort: ShockDistort[];
}
export const emptyPost = (): PostState => ({
  flash: [0, 0, 0, 0], impact: 0, impactTint: [1, 1, 1], speedLines: 0, speedColor: [1, 1, 1], speedCx: 0.5, speedCy: 0.5,
  radial: 0, radialCx: 0.5, radialCy: 0.5, whip: 0, whipAngle: 0, chroma: 0, heat: 0, fade: 0, grain: 0.02, distort: [],
});
