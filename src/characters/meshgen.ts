import { V, clamp, lerp, smoothstep, type V3 } from '../utils/math.js';
import { MeshBuilder, loft, ringAt, hex, type Ring } from '../engine/meshbuilder.js';
import { BI, FINGERS, type BoneName, type Skeleton } from './rig.js';
import type { CharacterSpec } from './spec.js';

export const MAT = { skin: 0, cloth: 1, hair: 2, glow: 3, eye: 4, decal: 5, metal: 6, ribbon: 7 } as const;

interface R { c: V3; r: number; rz?: number; b0: BoneName; b1?: BoneName; w1?: number; col?: V3 }
interface TubeOpts { sides?: number; hint?: V3; mat?: number; col: V3; capStart?: boolean; capEnd?: boolean }

/** lofts rings along the given centres; ring orientation follows the path direction */
function tube(mb: MeshBuilder, rs: R[], o: TubeOpts) {
  const rings: Ring[] = rs.map((q, i) => {
    const a = rs[Math.max(0, i - 1)].c, b = rs[Math.min(rs.length - 1, i + 1)].c;
    const ring = ringAt(q.c, V.sub(b, a), q.r, q.rz ?? q.r, o.hint ?? [0, 0, 1]);
    ring.col = q.col ?? o.col;
    const w1 = q.b1 ? q.w1 ?? 0.5 : 0;
    ring.bones = [BI[q.b0], BI[q.b1 ?? q.b0]];
    ring.w = [1 - w1, w1];
    ring.mat = o.mat ?? MAT.skin;
    return ring;
  });
  loft(mb, rings, o.sides ?? 12, o.capStart ?? true, o.capEnd ?? true, o.col, o.mat ?? 0);
}

/** head shape shared by the skull mesh, the hair cap and the face decals (head-bone-local coordinates) */
export function headShape(spec: CharacterSpec) {
  const S = spec.scale * spec.headScale;
  const c: V3 = [0, 0.12 * spec.scale, 0.012 * spec.scale];
  const rx = 0.092 * S, ry = 0.116 * S, rz = 0.106 * S;
  /** x radius shrinks toward the chin */
  const rxAt = (y: number) => {
    const dy = (y - c[1]) / ry;
    const f = clamp((-dy - 0.05) / 0.95);
    return rx * (1 - 0.4 * Math.pow(f, 1.15));
  };
  const surfZ = (x: number, y: number) => {
    const dy = (y - c[1]) / ry, rr = rxAt(y);
    const v = 1 - (x / rr) ** 2 - dy * dy;
    return c[2] + rz * Math.sqrt(Math.max(v, 0.02)) * (1 - 0.1 * clamp((-dy - 0.1) / 0.9));
  };
  const normalAt = (x: number, y: number): V3 => {
    const z = surfZ(x, y);
    return V.norm([(x - c[0]) / (rx * rx), (y - c[1]) / (ry * ry), (z - c[2]) / (rz * rz)]);
  };
  return { c, rx, ry, rz, rxAt, surfZ, normalAt, S };
}

export interface BuiltBody { mb: MeshBuilder }

export function buildBody(spec: CharacterSpec, sk: Skeleton): BuiltBody {
  const mb = new MeshBuilder();
  const S = spec.scale, lt = spec.limbThick;
  const P = (n: BoneName) => sk.bind[BI[n]];
  const skin = hex(spec.skin), top = hex(spec.top), acc = hex(spec.topAccent), pants = hex(spec.pants), boots = hex(spec.boots);
  const bootAcc = hex(spec.bootAccent), glove = hex(spec.glove), belt = hex(spec.belt), trim = hex(spec.trim);
  const isA = spec.style === 'A';
  const add = (a: V3, b: V3, t: number): V3 => V.lerp(a, b, t);

  // ------------------------------------------------------------- legs
  for (const [nm, sg] of [['L', 1], ['R', -1]] as const) {
    const th = P(`thigh${nm}` as BoneName), kn = P(`shin${nm}` as BoneName), an = P(`foot${nm}` as BoneName);
    const T = `thigh${nm}` as BoneName, Sh = `shin${nm}` as BoneName, F = `foot${nm}` as BoneName, Tt = `toe${nm}` as BoneName;
    const rT = 0.098 * S * lt * (isA ? 1 : 1.12);
    const baggy = isA ? 1 : 1.18;
    tube(mb, [
      { c: V.add(th, [0, 0.07 * S, 0]), r: rT * 1.0, b0: 'hips', b1: T, w1: 0.45 },
      { c: th, r: rT * 1.03, b0: 'hips', b1: T, w1: 0.7 },
      { c: add(th, kn, 0.3), r: rT * 0.98, b0: T },
      { c: add(th, kn, 0.62), r: rT * 0.84 * baggy, b0: T },
      { c: add(th, kn, 0.9), r: rT * 0.7 * baggy, b0: T, b1: Sh, w1: 0.25 },
      { c: kn, r: rT * 0.64 * baggy, b0: T, b1: Sh, w1: 0.5 },
      { c: add(kn, an, 0.15), r: rT * 0.65 * baggy, b0: T, b1: Sh, w1: 0.75 },
      { c: add(kn, an, 0.42), r: rT * 0.68 * baggy, b0: Sh },
      { c: add(kn, an, 0.72), r: rT * 0.6 * (isA ? 1 : 1.25), b0: Sh },
    ], { col: pants, mat: MAT.cloth, sides: 12 });
    // boot shaft + foot
    const bootTop = add(kn, an, 0.66);
    tube(mb, [
      { c: bootTop, r: rT * 0.62, b0: Sh, col: bootAcc },
      { c: add(kn, an, 0.72), r: rT * 0.6, b0: Sh, col: bootAcc },
      { c: add(kn, an, 0.76), r: rT * 0.57, b0: Sh, col: boots },
      { c: add(kn, an, 0.95), r: rT * 0.5, b0: Sh, b1: F, w1: 0.4, col: boots },
      { c: V.add(an, [0, -0.012 * S, 0]), r: rT * 0.5, b0: Sh, b1: F, w1: 0.7, col: boots },
    ], { col: boots, mat: isA ? MAT.metal : MAT.cloth, sides: 12, capStart: false });
    const fx = an[0];
    const fr = (zt: number, cy: number, hw: number, hh: number, b0: BoneName, b1?: BoneName, w1 = 0): R & { u: V3 } => ({ c: [fx, cy * S, an[2] + zt * S], r: hw * S * lt, rz: hh * S, b0, b1, w1, u: [1, 0, 0] });
    const footRings = [
      fr(-0.062, 0.058, 0.044, 0.056, F), fr(-0.02, 0.05, 0.05, 0.054, F), fr(0.055, 0.04, 0.049, 0.04, F),
      fr(0.115, 0.034, 0.044, 0.032, F, Tt, 0.5), fr(0.185, 0.026, 0.03, 0.024, Tt),
    ];
    const rings: Ring[] = footRings.map((q) => ({ c: q.c, u: [q.r, 0, 0], v: [0, q.rz!, 0], col: boots, bones: [BI[q.b0], BI[q.b1 ?? q.b0]], w: [1 - q.w1!, q.w1!], mat: isA ? MAT.metal : MAT.cloth }));
    loft(mb, rings, 12, true, true, boots);
    // ankle wraps for B
    if (!isA) tube(mb, [
      { c: add(kn, an, 0.6), r: rT * 0.7, b0: Sh, col: hex('#d9caa6') }, { c: add(kn, an, 0.7), r: rT * 0.7, b0: Sh, col: hex('#d9caa6') },
    ], { col: hex('#d9caa6'), mat: MAT.cloth, sides: 12 });
    void sg;
  }

  // ------------------------------------------------------------- torso
  const sw = spec.shoulderW, td = spec.torsoDepth, ch = spec.chest;
  const ty = (y: number) => y * S;
  const torsoStart = mb.count;
  tube(mb, [
    { c: [0, ty(0.86), 0], r: 0.148 * S * spec.hipW, rz: 0.104 * S * td, b0: 'hips' },
    { c: [0, ty(0.96), 0], r: 0.162 * S * spec.hipW, rz: 0.112 * S * td, b0: 'hips' },
    { c: [0, ty(1.07), 0], r: 0.14 * S, rz: 0.098 * S * td, b0: 'hips', b1: 'spine', w1: 0.7 },
    { c: [0, ty(1.18), 0], r: 0.15 * S * ch, rz: 0.104 * S * td, b0: 'spine', b1: 'chest', w1: 0.55 },
    { c: [0, ty(1.29), 0], r: 0.188 * S * ch, rz: 0.118 * S * td, b0: 'chest' },
    { c: [0, ty(1.375), 0], r: 0.205 * S * sw, rz: 0.108 * S * td, b0: 'chest' },
    { c: [0, ty(1.435), 0], r: 0.115 * S, rz: 0.078 * S, b0: 'chest', b1: 'neck', w1: 0.4 },
    { c: [0, ty(1.47), 0], r: 0.06 * S, rz: 0.055 * S, b0: 'neck' },
  ], { col: top, mat: MAT.cloth, sides: 20 });
  const torsoEnd = mb.count;
  // garment colouring: hem trim, belt, and (style B) bare chest V-neck
  for (let i = torsoStart; i < torsoEnd; i++) {
    const x = mb.pos[i * 3], y = mb.pos[i * 3 + 1] / S, z = mb.pos[i * 3 + 2];
    let c = top;
    if (y < 0.9) c = pants;
    if (isA) { if (y > 1.4 && Math.abs(x) < 0.08 * S) c = acc; if (z > 0.09 * S && Math.abs(x) < 0.012 * S && y > 1.0) c = acc; }
    else {
      if (z > 0 && y > 1.16 && Math.abs(x) < (0.02 + (y - 1.16) * 0.55) * S) c = skin;
      if (y > 1.37) c = Math.abs(x) > 0.04 * S ? top : skin;
    }
    mb.col[i * 3] = c[0]; mb.col[i * 3 + 1] = c[1]; mb.col[i * 3 + 2] = c[2];
  }
  // belt
  tube(mb, [
    { c: [0, ty(1.035), 0], r: 0.152 * S, rz: 0.108 * S * td, b0: 'hips', b1: 'spine', w1: 0.4, col: belt },
    { c: [0, ty(1.09), 0], r: 0.15 * S, rz: 0.106 * S * td, b0: 'hips', b1: 'spine', w1: 0.5, col: belt },
  ], { col: belt, mat: MAT.cloth, sides: 20 });
  // buckle plate
  tube(mb, [
    { c: [0, ty(1.062), 0.108 * S * td], r: 0.026 * S, rz: 0.01 * S, b0: 'hips', b1: 'spine', w1: 0.5, col: trim },
    { c: [0, ty(1.064), 0.118 * S * td], r: 0.022 * S, rz: 0.006 * S, b0: 'hips', b1: 'spine', w1: 0.5, col: trim },
  ], { col: trim, mat: MAT.metal, sides: 8, hint: [1, 0, 0] });
  // collar (A): high stand-up collar. B: bronze neck-band
  tube(mb, [
    { c: [0, ty(1.43), 0], r: 0.082 * S, rz: 0.07 * S, b0: 'chest', b1: 'neck', w1: 0.4, col: isA ? top : hex(spec.topAccent) },
    { c: [0, ty(1.5), -0.006 * S], r: 0.074 * S, rz: 0.066 * S, b0: 'neck', col: isA ? acc : hex(spec.topAccent) },
  ], { col: top, mat: MAT.cloth, sides: 16, capStart: false, capEnd: false });

  // ------------------------------------------------------------- neck
  tube(mb, [
    { c: [0, ty(1.42), 0], r: 0.054 * S * (isA ? 1 : 1.25), b0: 'chest', b1: 'neck', w1: 0.5 },
    { c: [0, ty(1.5), 0.004 * S], r: 0.05 * S * (isA ? 1 : 1.25), b0: 'neck' },
    { c: [0, ty(1.6), 0.012 * S], r: 0.048 * S * (isA ? 1 : 1.25), b0: 'neck', b1: 'head', w1: 0.7 },
  ], { col: skin, mat: MAT.skin, sides: 12, capStart: false });

  // ------------------------------------------------------------- arms
  for (const [nm, sg] of [['L', 1], ['R', -1]] as const) {
    const s = sg > 0 ? 0 : 1;
    const sh = P(`upper${nm}` as BoneName), el = P(`fore${nm}` as BoneName), wr = P(`hand${nm}` as BoneName);
    const dir = sk.armDir[s];
    const U = `upper${nm}` as BoneName, Fo = `fore${nm}` as BoneName, H = `hand${nm}` as BoneName, Cl = `clav${nm}` as BoneName;
    const rA = 0.056 * S * lt * (isA ? 1 : 1.16);
    const sleeve = isA ? top : skin;
    const tt = (t: number) => t;
    tube(mb, [
      { c: V.mad(sh, dir, -0.025 * S), r: rA * 1.18, b0: Cl, b1: U, w1: 0.6 },
      { c: sh, r: rA * 1.16, b0: U },
      { c: add(sh, el, tt(0.4)), r: rA * 1.02, b0: U },
      { c: add(sh, el, 0.85), r: rA * 0.8, b0: U, b1: Fo, w1: 0.3 },
      { c: el, r: rA * 0.74, b0: U, b1: Fo, w1: 0.5 },
      { c: add(el, wr, 0.15), r: rA * 0.78, b0: U, b1: Fo, w1: 0.7 },
      { c: add(el, wr, 0.4), r: rA * 0.86, b0: Fo },
      { c: add(el, wr, 0.85), r: rA * 0.6, b0: Fo, b1: H, w1: 0.3 },
      { c: wr, r: rA * 0.55, b0: Fo, b1: H, w1: 0.5 },
    ], { col: sleeve, mat: isA ? MAT.cloth : MAT.skin, sides: 12 });
    // glove / wrist band
    tube(mb, [
      { c: add(el, wr, isA ? 0.6 : 0.78), r: rA * (isA ? 0.8 : 0.72), b0: Fo, col: isA ? glove : hex(spec.topAccent) },
      { c: add(el, wr, isA ? 0.92 : 0.96), r: rA * (isA ? 0.62 : 0.66), b0: Fo, b1: H, w1: 0.4, col: isA ? glove : hex(spec.topAccent) },
      { c: V.mad(wr, dir, 0.012 * S), r: rA * (isA ? 0.58 : 0.62), b0: H, col: isA ? glove : hex(spec.topAccent) },
    ], { col: glove, mat: isA ? MAT.cloth : MAT.metal, sides: 12 });
    // palm
    const palmN = sk.palmN[s];
    const handCol = isA ? glove : skin;
    const palm: Ring[] = [0.0, 0.035, 0.075].map((t, i) => ({
      c: V.mad(wr, dir, t * S), u: [0, 0, (0.036 - i * 0.002) * S * lt], v: V.mul(palmN, (0.02 - i * 0.002) * S * lt),
      col: handCol, bones: [BI[H], BI[H]] as [number, number], w: [1, 0] as [number, number], mat: MAT.skin,
    }));
    loft(mb, palm, 8, true, true, handCol);
    // fingers
    for (const f of FINGERS) {
      const b0 = `${f}${nm}0` as BoneName, b1 = `${f}${nm}1` as BoneName;
      const p0 = P(b0), p1 = P(b1);
      const d = V.norm(V.sub(p1, p0));
      const tip = V.mad(p1, d, (f === 'thumb' ? 0.028 : 0.03) * S);
      const fr = (f === 'thumb' ? 0.0125 : f === 'ring' ? 0.0135 : 0.0115) * S * lt;
      tube(mb, [
        { c: p0, r: fr, b0 }, { c: add(p0, p1, 0.7), r: fr * 0.94, b0 },
        { c: p1, r: fr * 0.9, b0, b1, w1: 0.5 }, { c: add(p1, tip, 0.6), r: fr * 0.82, b0: b1 }, { c: tip, r: fr * 0.62, b0: b1 },
      ], { col: handCol, mat: MAT.skin, sides: 6, hint: palmN });
    }
  }

  // ------------------------------------------------------------- shoulder armour (B) / shoulder mantle (A)
  if (!isA) {
    const sh = P('upperL'), rr = 0.088 * S * sw;
    tube(mb, [
      { c: V.add(sh, [0.0, 0.045 * S, 0]), r: rr * 0.9, rz: rr * 0.85, b0: 'chest', b1: 'upperL', w1: 0.5, col: hex(spec.topAccent) },
      { c: V.add(sh, [0.03 * S, 0.02 * S, 0]), r: rr * 1.3, rz: rr * 1.05, b0: 'upperL', col: hex(spec.topAccent) },
      { c: V.add(sh, [0.05 * S, -0.03 * S, 0]), r: rr * 1.2, rz: rr * 1.0, b0: 'upperL', col: hex('#8a5a22') },
      { c: V.add(sh, [0.05 * S, -0.075 * S, 0]), r: rr * 0.9, rz: rr * 0.8, b0: 'upperL', col: hex('#3b2a1a') },
    ], { col: hex(spec.topAccent), mat: MAT.metal, sides: 14, hint: [0, 0, 1] });
  } else {
    const sh = P('upperR');
    tube(mb, [
      { c: V.add(sh, [0.0, 0.04 * S, 0]), r: 0.078 * S, rz: 0.07 * S, b0: 'chest', b1: 'upperR', w1: 0.5, col: top },
      { c: V.add(sh, [-0.02 * S, 0.0, 0]), r: 0.088 * S, rz: 0.076 * S, b0: 'upperR', col: acc },
      { c: V.add(sh, [-0.03 * S, -0.03 * S, 0]), r: 0.08 * S, rz: 0.07 * S, b0: 'upperR', col: top },
    ], { col: top, mat: MAT.metal, sides: 14, hint: [0, 0, 1] });
  }

  // ------------------------------------------------------------- head
  const hd = headShape(spec);
  const headBind = P('head');
  const seg = 28, rows = 20, base = mb.count;
  for (let y = 0; y <= rows; y++) {
    const th = (y / rows) * Math.PI;
    for (let x = 0; x < seg; x++) {
      const ph = (x / seg) * Math.PI * 2;
      const dx = Math.sin(th) * Math.sin(ph), dy = Math.cos(th), dz = Math.sin(th) * Math.cos(ph);
      const f = clamp((-dy - 0.05) / 0.95);
      const px = hd.c[0] + dx * hd.rxAt(hd.c[1] + dy * hd.ry);
      const py = hd.c[1] + dy * hd.ry * (1 - 0.05 * f);
      const pz = hd.c[2] + dz * hd.rz * (1 - 0.1 * f) + (dz > 0.4 && dy < -0.6 ? 0.006 * S : 0);
      const yl = py;
      const wj = smoothstep(0.072 * S, 0.04 * S, yl) * smoothstep(-0.35, 0.3, dz);
      const p = V.add(headBind, [px, py, pz]);
      mb.vert(p, skin, BI.head, BI.jaw, 1 - wj, wj, MAT.skin);
    }
  }
  for (let y = 0; y < rows; y++) for (let x = 0; x < seg; x++) {
    const x1 = (x + 1) % seg, a = base + y * seg + x, b = base + y * seg + x1, c = base + (y + 1) * seg + x1, d = base + (y + 1) * seg + x;
    mb.tri(a, b, c); mb.tri(a, c, d);
  }
  // ears
  for (const sg of [1, -1]) {
    const cx = hd.c[0] + sg * hd.rx * 0.98, cy = hd.c[1] - 0.005 * S, cz = hd.c[2] - 0.004 * S;
    tube(mb, [
      { c: V.add(headBind, [cx - sg * 0.004 * S, cy, cz]), r: 0.02 * S, rz: 0.014 * S, b0: 'head' },
      { c: V.add(headBind, [cx + sg * 0.012 * S, cy + 0.006 * S, cz - 0.002 * S], ), r: 0.016 * S, rz: 0.008 * S, b0: 'head' },
    ], { col: skin, mat: MAT.skin, sides: 8, hint: [1, 0, 0] });
  }
  mb.computeNormals();

  // ------------------------------------------------------------- hair cap (static part of the hair; clumps are simulated separately)
  const hair = hex(spec.hair), hairTip = hex(spec.hairTip);
  const hb = mb.count, hseg = 30, hrows = 22, infl = 1.075;
  const hv: number[] = [];
  for (let y = 0; y <= hrows; y++) {
    const th = (y / hrows) * Math.PI * 0.86;
    for (let x = 0; x < hseg; x++) {
      const ph = (x / hseg) * Math.PI * 2;
      const dx = Math.sin(th) * Math.sin(ph), dy = Math.cos(th), dz = Math.sin(th) * Math.cos(ph);
      const px = hd.c[0] + dx * hd.rxAt(hd.c[1] + dy * hd.ry) * infl;
      const py = hd.c[1] + dy * hd.ry * infl + 0.004 * S;
      const pz = hd.c[2] + dz * hd.rz * infl - (dz < 0 ? 0.008 * S : 0);
      const front = smoothstep(0.1, 0.5, dz);
      const back = smoothstep(-0.2, -0.6, dz);
      let thr = lerp(lerp(0.2, 0.55, front), -0.62, back);
      if (Math.abs(dx) > 0.75 && dz > -0.35) thr = Math.min(thr, -0.05);
      const keep = dy > thr;
      hv.push(keep ? 1 : 0);
      const t = clamp((dy + 0.5) / 1.5);
      mb.vert(V.add(headBind, [px, py, pz]), V.lerp(hair, hairTip, Math.pow(1 - t, 2.2) * 0.5), BI.head, BI.head, 1, 0, MAT.hair);
    }
  }
  const capIdx: number[] = [];
  for (let y = 0; y < hrows; y++) for (let x = 0; x < hseg; x++) {
    const x1 = (x + 1) % hseg, a = y * hseg + x, b = y * hseg + x1, c = (y + 1) * hseg + x1, d = (y + 1) * hseg + x;
    if (hv[a] && hv[b] && hv[c] && hv[d]) capIdx.push(hb + a, hb + b, hb + c, hb + a, hb + c, hb + d);
  }
  mb.idx.push(...capIdx);
  // recompute normals for the whole mesh (cap uses the same buffer)
  mb.computeNormals();
  return { mb };
}
