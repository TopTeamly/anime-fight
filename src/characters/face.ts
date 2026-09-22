import { V, clamp, lerp, type V3 } from '../utils/math.js';
import type { FloatBatch } from '../engine/gl.js';
import type { FaceParams } from '../animation/pose.js';
import { BI } from './rig.js';
import { MAT, headShape } from './meshgen.js';
import { hex } from '../engine/meshbuilder.js';
import type { CharacterSpec } from './spec.js';

/** Builds the facial decals (eyes, lids, brows, mouth, nose) every frame from FaceParams.
 *  Geometry hugs the head surface and is skinned to the head bone, so it follows any head motion. */
export class FaceBuilder {
  private hd: ReturnType<typeof headShape>;
  private headBind: V3;
  private colors: Record<string, V3>;
  constructor(private spec: CharacterSpec, headBind: V3) {
    this.hd = headShape(spec);
    this.headBind = headBind;
    this.colors = {
      white: hex('#f4f1ee'), iris: hex(spec.iris), ring: hex(spec.irisRing), pupil: hex('#0b0b12'), hi: hex('#ffffff'),
      line: hex('#15121a'), brow: V.mul(hex(spec.hair), 0.8) as V3, mouth: hex('#4a0f18'), teeth: hex('#fbf8f4'), tongue: hex('#c4525f'),
      nose: V.mul(hex(spec.skinShade), 1) as V3, cheek: hex(spec.skinShade),
    };
  }

  private vtx(b: FloatBatch, x: number, y: number, off: number, col: V3, mat: number) {
    const hd = this.hd;
    const z = hd.surfZ(x, y) + off, n = hd.normalAt(x, y);
    b.push(this.headBind[0] + x, this.headBind[1] + y, this.headBind[2] + z, n[0], n[1], n[2], col[0], col[1], col[2], BI.head, BI.head, 1, 0, mat);
  }
  private tri(b: FloatBatch, a: [number, number], c: [number, number], d: [number, number], off: number, col: V3, mat: number = MAT.decal) {
    this.vtx(b, a[0], a[1], off, col, mat); this.vtx(b, c[0], c[1], off, col, mat); this.vtx(b, d[0], d[1], off, col, mat);
  }
  private quad(b: FloatBatch, a: [number, number], c: [number, number], d: [number, number], e: [number, number], off: number, col: V3, mat: number = MAT.decal) {
    this.tri(b, a, c, d, off, col, mat); this.tri(b, a, d, e, off, col, mat);
  }
  /** thick polyline strip */
  private strip(b: FloatBatch, pts: [number, number][], th: number[], off: number, col: V3, mat: number = MAT.decal) {
    for (let i = 0; i < pts.length - 1; i++) {
      const dx = pts[i + 1][0] - pts[i][0], dy = pts[i + 1][1] - pts[i][1], l = Math.hypot(dx, dy) || 1;
      const nx = -dy / l, ny = dx / l;
      const a: [number, number] = [pts[i][0] + nx * th[i], pts[i][1] + ny * th[i]], bb: [number, number] = [pts[i][0] - nx * th[i], pts[i][1] - ny * th[i]];
      const c: [number, number] = [pts[i + 1][0] - nx * th[i + 1], pts[i + 1][1] - ny * th[i + 1]], d: [number, number] = [pts[i + 1][0] + nx * th[i + 1], pts[i + 1][1] + ny * th[i + 1]];
      this.quad(b, a, bb, c, d, off, col, mat);
    }
  }

  build(b: FloatBatch, f: FaceParams, gaze: [number, number], glow: number) {
    const sp = this.spec, S = sp.scale * sp.headScale, C = this.colors;
    const E = sp.eye;
    for (const sg of [1, -1]) {
      const cx = sg * E.x * S, cy = E.y * sp.scale;
      const w = E.w * S, h = E.h * S;
      const open = clamp(sg > 0 ? f.lidL : f.lidR, 0, 1.25);
      const tiltP = sg > 0 ? f.tiltL : f.tiltR;
      const tan = Math.tan(E.tilt);
      const N = 10;
      const xi = (i: number) => -1 + (2 * i) / N;
      const offY = (x: number) => x * w * tan;
      const yB = (x: number) => -h * 0.5 * Math.pow(Math.max(1 - x * x, 0), 0.7) * (1 - f.squint * 0.55) + offY(x) + f.squint * h * 0.22 * (1 - x * x);
      const yT = (x: number) => {
        const base = h * Math.pow(Math.max(1 - x * x, 0), 0.55) * Math.min(open, 1.2) + offY(x);
        const slant = -tiltP * h * 0.85 * clamp(0.5 - x * 0.5) + (tiltP < 0 ? -tiltP * h * 0.4 * clamp(0.5 + x * 0.5) : 0);
        return Math.max(yB(x) + 0.0006, base + slant * Math.min(open + 0.25, 1));
      };
      const X = (x: number) => cx + sg * x * w; // eye-local xi (+1 outer) -> head-local x
      const clampY = (x: number, y: number) => clamp(y, yB(x), yT(x));
      const inv = (px: number) => clamp(((px - cx) * sg) / w, -1, 1);
      // eye white
      for (let i = 0; i < N; i++) this.quad(b, [X(xi(i)), cy + yB(xi(i))], [X(xi(i + 1)), cy + yB(xi(i + 1))], [X(xi(i + 1)), cy + yT(xi(i + 1))], [X(xi(i)), cy + yT(xi(i))], 0.0012, C.white, MAT.eye);
      // iris (dark ring, iris, pupil, highlights) clamped to the lid opening
      const ix = cx + gaze[0] * w * 0.42, iy = cy + gaze[1] * h * 0.3 + offY(0) * 0.3;
      const disc = (rx: number, ry: number, col: V3, off: number, mat: number, dx = 0, dy = 0) => {
        const K = 14;
        const pt = (k: number): [number, number] => {
          const a = (k / K) * Math.PI * 2;
          const px = ix + dx + Math.cos(a) * rx, py0 = iy + dy + Math.sin(a) * ry;
          return [px, cy + clampY(inv(px), py0 - cy)];
        };
        const c0: [number, number] = [ix + dx, cy + clampY(inv(ix + dx), iy + dy - cy)];
        for (let k = 0; k < K; k++) this.tri(b, c0, pt(k), pt(k + 1), off, col, mat);
      };
      const ir = h * 0.98;
      disc(ir * 0.86, ir, C.ring, 0.002, MAT.eye);
      disc(ir * 0.72, ir * 0.88, C.iris, 0.0026, MAT.eye, 0, -h * 0.05);
      const pr = ir * 0.36 * f.pupil;
      disc(pr * 0.9, pr * 1.3, glow > 0.05 ? V.lerp(C.pupil, hex('#ffffff'), 0.0) : C.pupil, 0.0032, glow > 0.05 ? MAT.glow : MAT.eye);
      disc(ir * 0.2, ir * 0.24, C.hi, 0.0038, MAT.eye, -ir * 0.26, ir * 0.34);
      disc(ir * 0.1, ir * 0.11, C.hi, 0.0038, MAT.eye, ir * 0.24, -ir * 0.3);
      // upper lid line (thicker toward the outer corner, with a lash flick) and lower lid line
      const upper: [number, number][] = [], upTh: number[] = [], low: [number, number][] = [], lowTh: number[] = [];
      for (let i = 0; i <= N; i++) {
        const x = xi(i);
        upper.push([X(x), cy + yT(x)]); upTh.push(0.0016 * S * E.lash * (0.8 + 0.6 * (x + 1) * 0.5) + 0.0006);
        low.push([X(x), cy + yB(x)]); lowTh.push(0.0007 * S + 0.0003);
      }
      this.strip(b, upper, upTh, 0.0048, C.line);
      this.strip(b, low, lowTh, 0.0046, C.line);
      const o = upper[N];
      this.tri(b, [o[0], o[1] + 0.001 * S], [o[0] + sg * 0.012 * S, o[1] + 0.006 * S * E.lash], [o[0] + sg * 0.004 * S, o[1] - 0.002 * S], 0.005, C.line);
      if (open < 0.12) this.strip(b, upper, upTh.map((v) => v * 1.5), 0.0052, C.line); // closed-eye line
      // brow
      const br = sp.brow, bl = br.len * S, by = br.y * sp.scale + (sg > 0 ? f.browL : f.browR) * 0.014 * S;
      const bp: [number, number][] = [], bt: number[] = [];
      for (let i = 0; i <= 6; i++) {
        const t = i / 6, eta = -1 + 2 * t;
        const y = by + 0.006 * S * (1 - eta * eta) * 0.6 - tiltP * 0.016 * S * (1 - t) + tiltP * 0.004 * S * t + (eta > 0.4 ? -0.003 * S * (eta - 0.4) : 0);
        bp.push([sg * (br.x * S + eta * bl * 0.5), y]);
        bt.push(br.thick * S * (1 - 0.5 * t) + 0.0004);
      }
      this.strip(b, bp, bt, 0.0034, C.brow);
    }
    // nose
    const ny = 0.083 * sp.scale;
    this.tri(b, [0.0, ny + 0.006 * S], [-0.006 * S, ny - 0.004 * S], [0.002 * S, ny - 0.004 * S], 0.0028, C.nose);
    // mouth
    const my = 0.048 * sp.scale, mw = 0.03 * S * (1 + 0.55 * f.mouthWide), open = clamp(f.mouthOpen, 0, 1.1);
    const M = 10, mx = (i: number) => -1 + (2 * i) / M;
    const yU = (x: number) => my + f.smile * 0.011 * S * x * x + open * 0.004 * S;
    if (open < 0.05) {
      const pts: [number, number][] = [], th: number[] = [];
      for (let i = 0; i <= M; i++) { const x = mx(i); pts.push([x * mw, yU(x) - open * 0.004 * S]); th.push(0.0013 * S * (1 - x * x * 0.5) + 0.0004); }
      this.strip(b, pts, th, 0.003, C.line);
    } else {
      const hgt = open * 0.04 * S;
      const yL = (x: number) => yU(x) - hgt * Math.pow(Math.max(1 - x * x, 0), 0.8);
      for (let i = 0; i < M; i++) this.quad(b, [mx(i) * mw, yU(mx(i))], [mx(i) * mw, yL(mx(i))], [mx(i + 1) * mw, yL(mx(i + 1))], [mx(i + 1) * mw, yU(mx(i + 1))], 0.0028, C.mouth);
      if (f.teeth > 0.02) for (let i = 1; i < M - 1; i++) {
        const t = Math.min(f.teeth, 1) * 0.012 * S * Math.pow(Math.max(1 - mx(i) ** 2, 0), 0.6), t2 = Math.min(f.teeth, 1) * 0.012 * S * Math.pow(Math.max(1 - mx(i + 1) ** 2, 0), 0.6);
        this.quad(b, [mx(i) * mw, yU(mx(i))], [mx(i) * mw, yU(mx(i)) - Math.min(t, hgt * 0.7)], [mx(i + 1) * mw, yU(mx(i + 1)) - Math.min(t2, hgt * 0.7)], [mx(i + 1) * mw, yU(mx(i + 1))], 0.0032, C.teeth);
      }
      if (open > 0.3) for (let i = 2; i < M - 2; i++) {
        const a = mx(i), c2 = mx(i + 1);
        this.quad(b, [a * mw, yL(a)], [a * mw, yL(a) + hgt * 0.35 * (1 - a * a)], [c2 * mw, yL(c2) + hgt * 0.35 * (1 - c2 * c2)], [c2 * mw, yL(c2)], 0.0032, C.tongue);
      }
      const ol: [number, number][] = [], oth: number[] = [], ol2: [number, number][] = [];
      for (let i = 0; i <= M; i++) { const x = mx(i); ol.push([x * mw, yU(x)]); ol2.push([x * mw, yL(x)]); oth.push(0.0012 * S + 0.0003); }
      this.strip(b, ol, oth, 0.0036, C.line); this.strip(b, ol2, oth, 0.0036, C.line);
    }
    void lerp;
  }
}
