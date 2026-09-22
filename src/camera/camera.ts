import { V, clamp, lerp, rad, type V3 } from '../utils/math.js';
import { ease } from '../utils/ease.js';
import { snoise1 } from '../utils/rng.js';
import type { Clip } from '../timeline/model.js';
import type { CameraState } from '../scene/types.js';
import { terrainHeight } from '../environment/terrain.js';

export interface ShakeEvent { t: number; mag: number; dur: number; seed: number }
export interface Subjects {
  point(who: 'A' | 'B', bone: string): V3;
  root(who: 'A' | 'B', t: number): V3;
  velocity(who: 'A' | 'B'): V3;
}
export interface CameraOut { cam: CameraState; whip: number; shakeAmount: number; shotType: string; shotIndex: number }

const DEFAULT_CAM: CameraState = { pos: [0, 4, 20], target: [0, 1.5, 0], fov: rad(38), roll: 0, near: 0.1, far: 1800 };

/** Director's camera. Every shot is a data clip; the camera is a pure function of (t, fighter positions). */
export class CameraSystem {
  shots: Clip[] = [];
  shakes: ShakeEvent[] = [];
  aspect = 16 / 9;
  avoid: ((p: V3, t: number) => number) | null = null;
  private prevSubject: 'A' | 'B' = 'A';

  set(shots: Clip[], shakes: ShakeEvent[]) {
    this.shots = shots.slice().sort((a, b) => a.start - b.start);
    this.shakes = shakes.slice().sort((a, b) => a.t - b.t);
  }
  shotAt(t: number): { clip: Clip; index: number } | null {
    let idx = -1;
    for (let i = 0; i < this.shots.length; i++) if (this.shots[i].start <= t) idx = i; else break;
    return idx < 0 ? null : { clip: this.shots[idx], index: idx };
  }

  /** shake magnitude (metres @ 6m) at time t */
  shakeAt(t: number): number {
    let m = 0;
    for (const s of this.shakes) {
      if (s.t > t) break;
      const a = t - s.t;
      if (a < s.dur) m += s.mag * Math.pow(1 - a / s.dur, 2);
    }
    return m;
  }

  evaluate(t: number, S: Subjects): CameraOut {
    const found = this.shotAt(t);
    if (!found) return { cam: { ...DEFAULT_CAM }, whip: 0, shakeAmount: 0, shotType: 'none', shotIndex: -1 };
    const { clip, index } = found;
    const p = clip.params;
    const u = clamp((t - clip.start) / Math.max(clip.dur, 0.01));
    const e = ease(p.ease ?? 'inOut', u);
    const type: string = p.shot ?? 'medium';
    const subj: string = p.subject ?? 'both';
    const bone: string = p.bone ?? 'chest';
    const lag = p.lag ?? 0.15;

    const A = S.point('A', 'chest'), B = S.point('B', 'chest');
    const rA = S.root('A', t), rB = S.root('B', t);
    let axis = V.norm([rB[0] - rA[0], 0, rB[2] - rA[2]]);
    if (V.len([axis[0], axis[2], 0]) < 0.01) axis = [1, 0, 0];
    const perp = V.cross([0, 1, 0], axis);
    const sep = Math.hypot(rB[0] - rA[0], rB[2] - rA[2]);

    let focus: V3;
    if (subj === 'A' || subj === 'B') focus = S.point(subj, bone);
    else if (subj === 'point') focus = p.point ?? [0, 1, 0];
    else focus = V.lerp(A, B, 0.5);
    // smoothed follow: use the subject's earlier root position as an anchor (cheap deterministic camera lag)
    let anchor = focus;
    if (lag > 0 && (subj === 'A' || subj === 'B')) { const r0 = S.root(subj, t), r1 = S.root(subj, t - lag * 0.6); anchor = V.add(focus, V.sub(r1, r0)); }
    else if (lag > 0 && subj === 'both') { const d = V.mul(V.add(V.sub(S.root('A', t - lag * 0.6), rA), V.sub(S.root('B', t - lag * 0.6), rB)), 0.5); anchor = V.add(focus, d); }

    const fov = rad(lerp(p.fov0 ?? 40, p.fov1 ?? p.fov0 ?? 40, e));
    const fovH = 2 * Math.atan(Math.tan(fov / 2) * this.aspect);
    let dist = lerp(p.d0 ?? 6, p.d1 ?? p.d0 ?? 6, e);
    const h = lerp(p.h0 ?? 1.4, p.h1 ?? p.h0 ?? 1.4, e);
    const az = rad(lerp(p.az0 ?? 0, p.az1 ?? p.az0 ?? 0, e));
    let pos: V3, target: V3 = focus;
    let whip = 0;

    if (type === 'ots') {
      const who: 'A' | 'B' = subj === 'B' ? 'B' : 'A';
      const other: 'A' | 'B' = who === 'A' ? 'B' : 'A';
      const head = S.point(who, 'head'), tgt = S.point(other, 'head');
      const fwd = V.norm([tgt[0] - head[0], 0, tgt[2] - head[2]]);
      const side = V.cross([0, 1, 0], fwd);
      pos = V.add(V.add(V.mad(head, fwd, -dist), V.mul(side, -0.38 * (who === 'A' ? 1 : 1))), [0, 0.2 + (h - 1.4) * 0.3, 0]);
      target = V.lerp(tgt, V.mad(tgt, fwd, 0.5), 0.5);
    } else {
      if (subj === 'both' && type !== 'close' && type !== 'xclose') {
        const need = (sep * Math.abs(Math.cos(az)) * 0.5 + 1.7) / Math.tan(fovH / 2) + sep * Math.abs(Math.sin(az)) * 0.3;
        dist = Math.max(dist, need);
      }
      const dirH: V3 = V.add(V.mul(perp, Math.cos(az)), V.mul(axis, Math.sin(az)));
      pos = V.add(V.mad(anchor, dirH, dist), [0, h - (focus[1] < 3 ? 1.4 : 0) + 0.0, 0]);
      if (subj !== 'point' && focus[1] > 4) pos = V.add(V.mad(anchor, dirH, dist), [0, h - 1.4, 0]);
      if (type === 'fastPan' || type === 'whipPan') {
        const from = S.point('A', bone), to = S.point('B', bone);
        const k = ease('inOutCubic', u);
        const flip = p.subject === 'B';
        target = V.lerp(flip ? to : from, flip ? from : to, k);
        pos = V.add(V.mad(V.lerp(from, to, 0.5), dirH, dist), [0, h - 1.4, 0]);
        if (type === 'whipPan') whip = Math.sin(Math.PI * clamp(u * 1.05)) * 1.0;
      } else if (type === 'top') {
        pos = V.add(anchor, [0.01, Math.max(h, 6), 0.01]);
      }
      if (p.lookAhead) target = V.mad(target, S.velocity(subj === 'B' ? 'B' : 'A'), p.lookAhead * 0.12);
    }
    // keep the camera above the ground
    pos = [pos[0], Math.max(pos[1], terrainHeight(pos[0], pos[2]) + 0.35, this.avoid ? this.avoid(pos, t) : 0), pos[2]];

    // shake: event driven (impact power) + sustained (shot param)
    const distToTarget = V.dist(pos, target);
    const sc = clamp(distToTarget / 6, 0.4, 3);
    const mag = this.shakeAt(t) + (p.shake ?? 0) * 0.06;
    let roll = rad(p.roll ?? 0);
    if (mag > 0.0005) {
      const f = 38, ph = t * f;
      const right = V.norm(V.cross(V.sub(target, pos), [0, 1, 0]));
      pos = V.add(pos, V.add(V.mul(right, snoise1(ph + 3.1) * mag * sc), [0, snoise1(ph + 17.7) * mag * sc, 0]));
      target = V.add(target, V.add(V.mul(right, snoise1(ph + 9.3) * mag * sc * 0.6), [0, snoise1(ph + 41.2) * mag * sc * 0.6, 0]));
      roll += snoise1(ph + 27.3) * mag * 0.9;
    }
    return { cam: { pos, target, fov, roll, near: 0.08, far: 1800 }, whip, shakeAmount: mag, shotType: type, shotIndex: index };
  }
}

/** shake events derived from the timeline: impact sounds, explosions and big VFX */
export function shakeEventsFrom(clips: Clip[]): ShakeEvent[] {
  const out: ShakeEvent[] = [];
  for (const c of clips) {
    if (c.type === 'hit') { const p = c.params.power ?? 0.5; out.push({ t: c.start, mag: 0.012 + 0.2 * Math.pow(p, 1.6), dur: 0.14 + 0.5 * p, seed: c.params.seed ?? 0 }); }
    else if (c.type === 'sfx_explosion' || c.type === 'sfx_boom') { const p = c.params.power ?? 0.7; out.push({ t: c.start, mag: 0.05 + 0.32 * p, dur: 0.6 + 1.6 * p, seed: 0 }); }
    else if (c.type === 'sfx_rockBreak') { const p = c.params.power ?? 0.6; out.push({ t: c.start, mag: 0.02 + 0.1 * p, dur: 0.5 + 0.7 * p, seed: 0 }); }
    else if (c.type === 'sfx_rumble') { const p = c.params.power ?? 0.5; out.push({ t: c.start, mag: 0.012 + 0.05 * p, dur: c.dur, seed: 0 }); }
  }
  return out;
}
export type { Clip };
