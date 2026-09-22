import { V, Q, lerp, type V3, type Q4 } from '../utils/math.js';
import type { FloatBatch } from '../engine/gl.js';
import { MAT } from './meshgen.js';

/** Verlet spring chain (hair clump / cloth strip). Anchored to a bone frame; every other point is pulled
 *  back to its rest position with a per-point stiffness so motion of the body makes it lag and stream. */
export class Chain {
  pts: V3[] = [];
  prev: V3[] = [];
  restL: V3[] = [];
  segLen: number;
  n: number;
  constructor(at: V3, dir: V3, len: number, segs: number, bend: V3, public stiff: number, public damp = 0.92, public gravity = 5) {
    this.n = segs + 1;
    const d = V.norm(dir);
    for (let i = 0; i < this.n; i++) {
      const t = i / segs;
      this.restL.push(V.add(V.add(at, V.mul(d, len * t)), V.mul(bend, t * t)));
      this.pts.push([0, 0, 0]); this.prev.push([0, 0, 0]);
    }
    this.segLen = len / segs;
  }
  reset(ap: V3, aq: Q4) {
    for (let i = 0; i < this.n; i++) {
      const p = V.add(ap, Q.rotate(aq, this.restL[i]));
      this.pts[i] = p; this.prev[i] = [...p] as V3;
    }
  }
  step(dt: number, ap: V3, aq: Q4, wind: V3, lift: number, flick: number) {
    const dt2 = dt * dt;
    for (let i = 0; i < this.n; i++) {
      const t = i / (this.n - 1);
      let rest = V.add(ap, Q.rotate(aq, this.restL[i]));
      if (lift > 0) {
        const up: V3 = V.add(V.add(ap, Q.rotate(aq, this.restL[0])), [Math.sin(flick * 9 + i * 1.7) * 0.03 * t, this.segLen * i * 1.05, Math.cos(flick * 7 + i) * 0.03 * t]);
        rest = V.lerp(rest, up, lift);
      }
      if (i === 0) { this.pts[0] = rest; this.prev[0] = rest; continue; }
      const p = this.pts[i], pr = this.prev[i];
      const vel = V.mul(V.sub(p, pr), this.damp);
      const k = this.stiff * (1 - 0.45 * t);
      const acc: V3 = [wind[0], wind[1] - this.gravity, wind[2]];
      this.prev[i] = p;
      this.pts[i] = [
        p[0] + vel[0] + acc[0] * dt2 + (rest[0] - p[0]) * k,
        p[1] + vel[1] + acc[1] * dt2 + (rest[1] - p[1]) * k,
        p[2] + vel[2] + acc[2] * dt2 + (rest[2] - p[2]) * k,
      ];
    }
    for (let it = 0; it < 2; it++) for (let i = 1; i < this.n; i++) {
      const a = this.pts[i - 1], b = this.pts[i], d = V.sub(b, a), l = V.len(d) || 1e-6;
      this.pts[i] = V.mad(a, d, this.segLen / l);
    }
  }
}

const pv = (b: FloatBatch, p: V3, n: V3, c: V3, mat: number) => b.push(p[0], p[1], p[2], n[0], n[1], n[2], c[0], c[1], c[2], 0, 0, 1, 0, mat);

/** tapered triangular prism along the chain (hair clump). `side` is a world-space reference direction. */
export function pushPrism(b: FloatBatch, ch: Chain, side: V3, w0: number, c0: V3, c1: V3) {
  const n = ch.n;
  const rings: V3[][] = [], norms: V3[][] = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const tan = V.norm(V.sub(ch.pts[Math.min(n - 1, i + 1)], ch.pts[Math.max(0, i - 1)]));
    let sd = V.sub(side, V.mul(tan, V.dot(side, tan)));
    if (V.len(sd) < 1e-4) sd = [1, 0, 0];
    sd = V.norm(sd);
    const nm = V.norm(V.cross(tan, sd));
    const w = w0 * Math.pow(1 - t, 0.85) * (i === n - 1 ? 0 : 1) * (1 + 0.25 * Math.sin(t * 3.14));
    const c = ch.pts[i];
    const a: V3 = V.mad(c, sd, w), bb: V3 = V.add(V.mad(c, sd, -w * 0.5), V.mul(nm, w * 0.87)), cc: V3 = V.add(V.mad(c, sd, -w * 0.5), V.mul(nm, -w * 0.87));
    rings.push([a, bb, cc]);
    norms.push([V.norm(V.sub(a, c)), V.norm(V.sub(bb, c)), V.norm(V.sub(cc, c))]);
    if (i === n - 1) { rings[i] = [c, c, c]; }
  }
  for (let i = 0; i < n - 1; i++) {
    const t = i / (n - 1), col = V.lerp(c0, c1, t * t);
    for (let s = 0; s < 3; s++) {
      const s1 = (s + 1) % 3;
      const a = rings[i][s], bq = rings[i][s1], c = rings[i + 1][s1], d = rings[i + 1][s];
      pv(b, a, norms[i][s], col, MAT.hair); pv(b, c, norms[i + 1][s1], col, MAT.hair); pv(b, bq, norms[i][s1], col, MAT.hair);
      pv(b, a, norms[i][s], col, MAT.hair); pv(b, d, norms[i + 1][s], col, MAT.hair); pv(b, c, norms[i + 1][s1], col, MAT.hair);
    }
  }
}

/** flat double-sided ribbon along the chain (cloth). `sides[i]` gives the world side axis for point i. */
export function pushRibbon(b: FloatBatch, ch: Chain, sideAt: (i: number) => V3, w0: number, w1: number, c0: V3, c1: V3) {
  const n = ch.n;
  const L: V3[] = [], R: V3[] = [], N: V3[] = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const tan = V.norm(V.sub(ch.pts[Math.min(n - 1, i + 1)], ch.pts[Math.max(0, i - 1)]));
    let sd = sideAt(i);
    sd = V.sub(sd, V.mul(tan, V.dot(sd, tan)));
    sd = V.len(sd) < 1e-4 ? [1, 0, 0] : V.norm(sd);
    const w = lerp(w0, w1, t) * 0.5;
    L.push(V.mad(ch.pts[i], sd, w)); R.push(V.mad(ch.pts[i], sd, -w)); N.push(V.norm(V.cross(tan, sd)));
  }
  for (let i = 0; i < n - 1; i++) {
    const t = (i + 0.5) / (n - 1), col = V.lerp(c0, c1, t);
    pv(b, L[i], N[i], col, MAT.ribbon); pv(b, R[i], N[i], col, MAT.ribbon); pv(b, R[i + 1], N[i + 1], col, MAT.ribbon);
    pv(b, L[i], N[i], col, MAT.ribbon); pv(b, R[i + 1], N[i + 1], col, MAT.ribbon); pv(b, L[i + 1], N[i + 1], col, MAT.ribbon);
  }
}
