import { V, Q, M, frameQuat, type V3, type Q4 } from '../utils/math.js';
import type { Pose, FKOverride } from '../animation/pose.js';
import type { CharacterSpec } from './spec.js';
import { MAX_BONES } from '../engine/shaders.js';

export const BONE_NAMES = [
  'root', 'hips', 'spine', 'chest', 'neck', 'head', 'jaw', 'eyeL', 'eyeR', 'clavL', 'clavR',
  'upperL', 'foreL', 'handL', 'upperR', 'foreR', 'handR',
  'thumbL0', 'thumbL1', 'idxL0', 'idxL1', 'midL0', 'midL1', 'ringL0', 'ringL1',
  'thumbR0', 'thumbR1', 'idxR0', 'idxR1', 'midR0', 'midR1', 'ringR0', 'ringR1',
  'thighL', 'shinL', 'footL', 'toeL', 'thighR', 'shinR', 'footR', 'toeR',
] as const;
export type BoneName = (typeof BONE_NAMES)[number];
export const BI = Object.fromEntries(BONE_NAMES.map((n, i) => [n, i])) as Record<BoneName, number>;
if (BONE_NAMES.length > MAX_BONES) throw new Error('too many bones for the skinning uniform array');

const PARENT: Record<BoneName, BoneName | null> = {
  root: null, hips: 'root', spine: 'hips', chest: 'spine', neck: 'chest', head: 'neck', jaw: 'head', eyeL: 'head', eyeR: 'head',
  clavL: 'chest', clavR: 'chest', upperL: 'clavL', foreL: 'upperL', handL: 'foreL', upperR: 'clavR', foreR: 'upperR', handR: 'foreR',
  thumbL0: 'handL', thumbL1: 'thumbL0', idxL0: 'handL', idxL1: 'idxL0', midL0: 'handL', midL1: 'midL0', ringL0: 'handL', ringL1: 'ringL0',
  thumbR0: 'handR', thumbR1: 'thumbR0', idxR0: 'handR', idxR1: 'idxR0', midR0: 'handR', midR1: 'midR0', ringR0: 'handR', ringR1: 'ringR0',
  thighL: 'hips', shinL: 'thighL', footL: 'shinL', toeL: 'footL', thighR: 'hips', shinR: 'thighR', footR: 'shinR', toeR: 'footR',
};

export const FINGERS = ['thumb', 'idx', 'mid', 'ring'] as const;

/** Bind pose: world-aligned, arms in a relaxed A-pose. Every bone has identity bind rotation, so local offsets are plain vectors. */
export class Skeleton {
  readonly n = BONE_NAMES.length;
  parent = new Int16Array(this.n);
  bind: V3[] = [];
  local: V3[] = [];
  armDir: V3[] = [[0, 0, 0], [0, 0, 0]];
  palmN: V3[] = [[0, 0, 0], [0, 0, 0]];
  curlAxis: V3[] = [[0, 0, 0], [0, 0, 0]];
  lenU = [0, 0]; lenF = [0, 0]; lenT = 0; lenS = 0;
  scale: number;

  constructor(spec: CharacterSpec) {
    const S = (this.scale = spec.scale);
    const sw = spec.shoulderW, hw = spec.hipW, hs = spec.headScale;
    const P: Partial<Record<BoneName, V3>> = {};
    const set = (n: BoneName, x: number, y: number, z: number) => { P[n] = [x * S, y * S, z * S]; };
    set('root', 0, 0, 0); set('hips', 0, 0.96, 0); set('spine', 0, 1.07, 0); set('chest', 0, 1.25, 0);
    set('neck', 0, 1.46, 0); set('head', 0, 1.56, 0); set('jaw', 0, 1.635, 0.0);
    set('eyeL', 0.04 * hs, 1.7, 0.085 * hs); set('eyeR', -0.04 * hs, 1.7, 0.085 * hs);
    for (const [side, sg] of [['L', 1], ['R', -1]] as const) {
      const dir = V.norm([0.42 * sg, -0.9, 0]);
      this.armDir[sg > 0 ? 0 : 1] = dir;
      const sh: V3 = [0.2 * sw * S * sg, 1.4 * S, 0];
      const el = V.mad(sh, dir, 0.3 * S), wr = V.mad(el, dir, 0.27 * S);
      P[`clav${side}` as BoneName] = [0.05 * sw * S * sg, 1.42 * S, 0.01 * S];
      P[`upper${side}` as BoneName] = sh; P[`fore${side}` as BoneName] = el; P[`hand${side}` as BoneName] = wr;
      const inward: V3 = [-sg, 0, 0];
      const nP = V.norm(V.sub(inward, V.mul(dir, V.dot(inward, dir))));
      this.palmN[sg > 0 ? 0 : 1] = nP;
      this.curlAxis[sg > 0 ? 0 : 1] = V.norm(V.cross(dir, nP));
      const k = V.mad(wr, dir, 0.085 * S * spec.limbThick);
      const finger = (nm: string, z: number, l1: number, l2: number) => {
        const p0 = V.add(k, [0, 0, z * S]);
        P[`${nm}${side}0` as BoneName] = p0;
        P[`${nm}${side}1` as BoneName] = V.mad(p0, dir, l1 * S);
        void l2;
      };
      finger('idx', 0.03, 0.036, 0.03); finger('mid', 0.008, 0.04, 0.032); finger('ring', -0.018, 0.036, 0.028);
      const tb = V.add(V.mad(wr, dir, 0.02 * S), [-sg * -0.0, 0, 0.038 * S]);
      const tdir = V.norm(V.add(dir, [0, 0, 0.7]));
      P[`thumb${side}0` as BoneName] = V.add(tb, V.mul(inward, 0.006 * S));
      P[`thumb${side}1` as BoneName] = V.mad(P[`thumb${side}0` as BoneName]!, tdir, 0.032 * S);
      set(`thigh${side}` as BoneName, 0.095 * hw * sg, 0.92, 0); set(`shin${side}` as BoneName, 0.095 * hw * sg, 0.5, 0.006);
      set(`foot${side}` as BoneName, 0.095 * hw * sg, 0.08, 0); set(`toe${side}` as BoneName, 0.095 * hw * sg, 0.03, 0.13);
    }
    for (let i = 0; i < this.n; i++) {
      const nm = BONE_NAMES[i], par = PARENT[nm];
      this.parent[i] = par ? BI[par] : -1;
      this.bind.push(P[nm]!);
    }
    for (let i = 0; i < this.n; i++) this.local.push(this.parent[i] < 0 ? [...this.bind[i]] as V3 : V.sub(this.bind[i], this.bind[this.parent[i]]));
    for (const [s, nm] of [[0, 'L'], [1, 'R']] as const) {
      this.lenU[s] = V.dist(this.bind[BI[`upper${nm}` as BoneName]], this.bind[BI[`fore${nm}` as BoneName]]);
      this.lenF[s] = V.dist(this.bind[BI[`fore${nm}` as BoneName]], this.bind[BI[`hand${nm}` as BoneName]]);
    }
    this.lenT = V.dist(this.bind[BI.thighL], this.bind[BI.shinL]);
    this.lenS = V.dist(this.bind[BI.shinL], this.bind[BI.footL]);
  }
}

/** analytic two-bone IK; returns joint (elbow/knee) and end positions */
export function solveTwoBone(root: V3, goal: V3, l1: number, l2: number, pole: V3): { mid: V3; end: V3 } {
  const to = V.sub(goal, root);
  const dRaw = V.len(to);
  const d = Math.min(Math.max(dRaw, Math.abs(l1 - l2) + 1e-3), l1 + l2 - 1e-3);
  const dir = dRaw > 1e-6 ? V.mul(to, 1 / dRaw) : ([0, -1, 0] as V3);
  const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(l1 * l1 - a * a, 0));
  let pp = V.sub(pole, V.mul(dir, V.dot(pole, dir)));
  if (V.len(pp) < 1e-4) pp = V.sub([0, 0, 1], V.mul(dir, dir[2]));
  pp = V.norm(pp);
  const mid = V.add(V.mad(root, dir, a), V.mul(pp, h));
  const end = V.mad(root, dir, d);
  return { mid, end };
}

const AX_X: V3 = [1, 0, 0];

/** Evaluates a Pose into world-space bone transforms and GPU skin matrices. */
export class Rig {
  pos: V3[] = [];
  rot: Q4[] = [];
  skin = new Float32Array(MAX_BONES * 16);
  private restU: Q4[];
  private restLegDir: Q4 = frameQuat([0, -1, 0], [0, 0, 1]);
  /** cached root transform of the last solve (used by cloth/hair and the face) */
  rootRot: Q4 = Q.ident();
  rootPos: V3 = [0, 0, 0];

  constructor(readonly skel: Skeleton) {
    for (let i = 0; i < skel.n; i++) { this.pos.push([0, 0, 0]); this.rot.push(Q.ident()); }
    this.restU = [frameQuat(skel.armDir[0], [0, 0, -1]), frameQuat(skel.armDir[1], [0, 0, -1])];
    for (let i = 0; i < MAX_BONES; i++) { this.skin[i * 16] = this.skin[i * 16 + 5] = this.skin[i * 16 + 10] = this.skin[i * 16 + 15] = 1; }
  }

  world(n: string): V3 { return this.pos[BI[n as BoneName]]; }

  solve(pose: Pose, rootPos: V3, yaw: number, fk?: FKOverride | null) {
    const sk = this.skel, S = sk.scale, pos = this.pos, rot = this.rot;
    const qYaw = Q.axisAngle([0, 1, 0], yaw + pose.twist);
    const qBody = Q.mul(Q.axisAngle(AX_X, pose.bodyPitch), Q.axisAngle([0, 0, 1], pose.bodyRoll));
    const Rt = Q.mul(qYaw, qBody);
    const pivot = sk.bind[BI.hips];
    const toWorld = (v: V3): V3 => V.add(rootPos, Q.rotate(qYaw, V.add(pivot, Q.rotate(qBody, V.sub(v, pivot)))));
    const goal = (g: V3): V3 => toWorld(V.mul(g, S));
    this.rootRot = Rt; this.rootPos = rootPos;
    pos[BI.root] = rootPos; rot[BI.root] = qYaw;

    const child = (i: number, e: V3 | null, extra?: Q4) => {
      const p = sk.parent[i];
      pos[i] = V.add(pos[p], Q.rotate(rot[p], sk.local[i]));
      rot[i] = e ? Q.mul(rot[p], extra ?? Q.euler(e[0], e[1], e[2])) : extra ? Q.mul(rot[p], extra) : rot[p];
    };
    // spine chain (FK)
    pos[BI.hips] = toWorld(V.add(sk.bind[BI.hips], V.mul(pose.hipsOff, S)));
    rot[BI.hips] = Q.mul(Rt, Q.euler(pose.pelvis[0], pose.pelvis[1], pose.pelvis[2]));
    child(BI.spine, pose.spine); child(BI.chest, pose.chest); child(BI.neck, pose.neck); child(BI.head, pose.head);
    child(BI.jaw, null, Q.axisAngle(AX_X, pose.face.mouthOpen * 0.36));
    const eq = Q.euler(-pose.gaze[1], pose.gaze[0], 0);
    child(BI.eyeL, null, eq); child(BI.eyeR, null, eq);

    // arms
    for (const [s, nm, clavE, hg, pl, roll] of [[0, 'L', pose.clavL, pose.handL, pose.poleL, pose.rollL], [1, 'R', pose.clavR, pose.handR, pose.poleR, pose.rollR]] as const) {
      const cl = BI[`clav${nm}` as BoneName], up = BI[`upper${nm}` as BoneName], fo = BI[`fore${nm}` as BoneName], ha = BI[`hand${nm}` as BoneName];
      child(cl, clavE);
      pos[up] = V.add(pos[cl], Q.rotate(rot[cl], sk.local[up]));
      const fkArm = fk ? (s === 0 ? fk.armL : fk.armR) : undefined;
      if (fkArm) {
        rot[up] = Q.mul(rot[cl], Q.euler(fkArm.sh[0], fkArm.sh[1], fkArm.sh[2]));
        pos[fo] = V.add(pos[up], Q.rotate(rot[up], sk.local[fo]));
        const ax = V.norm(V.cross([0, 0, -1], sk.armDir[s]));
        rot[fo] = Q.mul(rot[up], Q.axisAngle(ax, fkArm.el));
        pos[ha] = V.add(pos[fo], Q.rotate(rot[fo], sk.local[ha]));
        rot[ha] = Q.mul(rot[fo], Q.euler(fkArm.wr[0], fkArm.wr[1], fkArm.wr[2]));
      } else {
        const poleW = V.norm(Q.rotate(Rt, pl));
        const { mid, end } = solveTwoBone(pos[up], goal(hg), sk.lenU[s], sk.lenF[s], poleW);
        const d1 = V.norm(V.sub(mid, pos[up])), d2 = V.norm(V.sub(end, mid));
        const inv = Q.conj(this.restU[s]);
        rot[up] = Q.mul(frameQuat(d1, poleW), inv);
        pos[fo] = mid; rot[fo] = Q.mul(frameQuat(d2, poleW), inv);
        pos[ha] = end;
        const poleH = Q.rotate(Q.axisAngle(d2, roll), poleW);
        rot[ha] = Q.mul(frameQuat(d2, poleH), inv);
      }
      // fingers
      const fist = pose.fist[s], spread = pose.spread[s];
      const cAx = sk.curlAxis[s], pAx = sk.palmN[s];
      const spr = [0.55, 0.24, 0, -0.32];
      FINGERS.forEach((f, fi) => {
        const b0 = BI[`${f}${nm}0` as BoneName], b1 = BI[`${f}${nm}1` as BoneName];
        const c0 = f === 'thumb' ? 0.55 * fist : 1.25 * fist, c1 = f === 'thumb' ? 0.8 * fist : 1.45 * fist;
        const q0 = Q.mul(Q.axisAngle(pAx, spr[fi] * spread), Q.axisAngle(cAx, c0));
        pos[b0] = V.add(pos[ha], Q.rotate(rot[ha], sk.local[b0])); rot[b0] = Q.mul(rot[ha], q0);
        pos[b1] = V.add(pos[b0], Q.rotate(rot[b0], sk.local[b1])); rot[b1] = Q.mul(rot[b0], Q.axisAngle(cAx, c1));
      });
    }

    // legs
    for (const [s, nm, fg, kn, fp] of [[0, 'L', pose.footL, pose.kneeL, pose.footPitch[0]], [1, 'R', pose.footR, pose.kneeR, pose.footPitch[1]]] as const) {
      const th = BI[`thigh${nm}` as BoneName], sh = BI[`shin${nm}` as BoneName], ft = BI[`foot${nm}` as BoneName], to = BI[`toe${nm}` as BoneName];
      child(th, null);
      const fkLeg = fk ? (s === 0 ? fk.legL : fk.legR) : undefined;
      if (fkLeg) {
        rot[th] = Q.mul(rot[BI.hips], Q.euler(fkLeg.hip[0], fkLeg.hip[1], fkLeg.hip[2]));
        pos[sh] = V.add(pos[th], Q.rotate(rot[th], sk.local[sh]));
        rot[sh] = Q.mul(rot[th], Q.axisAngle(AX_X, fkLeg.knee));
        pos[ft] = V.add(pos[sh], Q.rotate(rot[sh], sk.local[ft]));
        rot[ft] = Q.mul(rot[sh], Q.axisAngle(AX_X, fkLeg.ank - fkLeg.knee * 0.5));
      } else {
        const poleW = V.norm(Q.rotate(Rt, kn));
        const { mid, end } = solveTwoBone(pos[th], goal(fg), sk.lenT, sk.lenS, poleW);
        const d1 = V.norm(V.sub(mid, pos[th])), d2 = V.norm(V.sub(end, mid));
        const inv = Q.conj(this.restLegDir);
        rot[th] = Q.mul(frameQuat(d1, poleW), inv);
        pos[sh] = mid; rot[sh] = Q.mul(frameQuat(d2, poleW), inv);
        pos[ft] = end; rot[ft] = Q.mul(Rt, Q.axisAngle(AX_X, fp));
      }
      pos[to] = V.add(pos[ft], Q.rotate(rot[ft], sk.local[to]));
      rot[to] = Q.mul(rot[ft], Q.axisAngle(AX_X, -0.25 * Math.max(0, fp)));
    }
    this.writeSkin();
  }

  private writeSkin() {
    const sk = this.skel;
    for (let i = 0; i < sk.n; i++) M.skin(this.rot[i], this.pos[i], sk.bind[i], this.skin, i * 16);
  }
}
