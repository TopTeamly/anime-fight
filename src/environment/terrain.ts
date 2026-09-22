import { V, clamp, lerp, smoothstep, type V3 } from '../utils/math.js';
import { fbm2, noise2, mulberry32 } from '../utils/rng.js';
import { Mesh, LAYOUT, type GL2, type Program } from '../engine/gl.js';
import { MeshBuilder } from '../engine/meshbuilder.js';
import { MAX_CRATERS } from '../engine/shaders.js';

export const ARENA_RADIUS = 58;

const terrace = (v: number, step: number, sharp: number) => {
  const s = v / step, f = Math.floor(s), fr = s - f;
  return (f + smoothstep(1 - sharp, 1, fr)) * step;
};

/** Base (undamaged) terrain height. Pure function: used by the mesh, cracks, debris and camera collision. */
export function terrainHeight(x: number, z: number): number {
  const r = Math.hypot(x, z);
  const arena = 1 - smoothstep(ARENA_RADIUS, ARENA_RADIUS + 26, r);
  let h = (fbm2(x * 0.09 + 5, z * 0.09 - 2, 3) - 0.5) * 0.5 * arena;
  const outer = smoothstep(ARENA_RADIUS + 10, 150, r);
  if (outer > 0) {
    const n = fbm2(x * 0.011 + 40, z * 0.011 + 11, 4);
    const ridges = terrace(n * 92, 13, 0.55) * outer;
    const far = smoothstep(150, 240, r) * 46 * fbm2(x * 0.02, z * 0.02, 3);
    h += ridges + far + noise2(x * 0.25, z * 0.25) * 1.2 * outer;
  }
  return h;
}

const SAND: V3 = [0.52, 0.42, 0.34], PALE: V3 = [0.62, 0.51, 0.4], ROCK: V3 = [0.4, 0.32, 0.31], DARK: V3 = [0.2, 0.16, 0.18];
function terrainColor(x: number, z: number, h: number): V3 {
  const r = Math.hypot(x, z);
  const n = fbm2(x * 0.05, z * 0.05, 3);
  let c = V.lerp(SAND, PALE, n);
  // faint fracture veins on the arena floor
  const vein = Math.abs(noise2(x * 0.32, z * 0.32) - 0.5);
  c = V.lerp(c, DARK, (1 - smoothstep(0.0, 0.035, vein)) * 0.22 * (1 - smoothstep(60, 100, r)));
  const outer = smoothstep(ARENA_RADIUS - 6, 110, r);
  c = V.lerp(c, ROCK, outer * 0.85);
  const band = Math.abs(((h / 13) % 1 + 1) % 1 - 0.5);
  c = V.lerp(c, DARK, outer * smoothstep(0.42, 0.5, band) * 0.35);
  return V.lerp(c, [0.72, 0.62, 0.55], smoothstep(60, 140, h) * 0.5);
}

export class Terrain {
  mesh: Mesh;
  triangles = 0;
  constructor(gl: GL2) {
    const NR = 150, NS = 192, R = 300, k = 3.4;
    const mb = new MeshBuilder();
    for (let i = 0; i <= NR; i++) {
      const u = i / NR, r = R * ((Math.exp(k * u) - 1) / (Math.exp(k) - 1));
      for (let j = 0; j < NS; j++) {
        const a = (j / NS) * Math.PI * 2, x = Math.cos(a) * r, z = Math.sin(a) * r;
        const h = terrainHeight(x, z);
        const e = 0.6;
        const n = V.norm([terrainHeight(x - e, z) - terrainHeight(x + e, z), 2 * e, terrainHeight(x, z - e) - terrainHeight(x, z + e)]);
        mb.vert([x, h, z], terrainColor(x, z, h), 0, 0, 1, 0, 0, n);
      }
    }
    for (let i = 0; i < NR; i++) for (let j = 0; j < NS; j++) {
      const j1 = (j + 1) % NS;
      const a = i * NS + j, b = i * NS + j1, c = (i + 1) * NS + j1, d = (i + 1) * NS + j;
      mb.tri(a, b, c); mb.tri(a, c, d);
    }
    this.triangles = mb.idx.length / 3;
    this.mesh = mb.toStaticMesh(gl);
  }
  draw() { this.mesh.draw(); }
}

// ------------------------------------------------------------------ damage (craters + cracks), all time-parametric
export interface CraterDef { x: number; z: number; radius: number; depth: number; start: number; grow: number; seed: number }
export interface CrackDef { x: number; z: number; length: number; width: number; yaw: number; start: number; seed: number; glow: number; branches: number; speed: number }

export class EnvDamage {
  craters: CraterDef[] = [];
  cracks: CrackDef[] = [];
  private crackMesh: Mesh | null = null;
  private A = new Float32Array(MAX_CRATERS * 4);
  private B = new Float32Array(MAX_CRATERS * 4);
  crackVerts = 0;
  constructor(private gl: GL2) {}

  set(craters: CraterDef[], cracks: CrackDef[]) {
    this.craters = craters.slice(0, MAX_CRATERS);
    this.cracks = cracks;
    this.crackMesh?.dispose();
    this.crackMesh = this.buildCracks();
    this.A.fill(0); this.B.fill(0);
    this.craters.forEach((c, i) => {
      this.A.set([c.x, c.z, c.radius, c.depth], i * 4);
      this.B.set([c.start, c.grow, c.seed, 0], i * 4);
    });
  }

  /** upload crater uniforms into a program that includes the CRATER chunk */
  bind(p: Program, time: number) {
    p.f('uTime', time).i('uCraterN', this.craters.length);
    p.fv('uCraterA', this.A, 4).fv('uCraterB', this.B, 4);
  }

  drawCracks() { this.crackMesh?.draw(); }
  get hasCracks() { return !!this.crackMesh; }

  private buildCracks(): Mesh | null {
    if (!this.cracks.length) return null;
    const out: number[] = [];
    let n = 0;
    const idx: number[] = [];
    const strip = (pts: V3[], dists: number[], widths: number[], birth: number, glow: number) => {
      const base = n;
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i], t = i < pts.length - 1 ? V.sub(pts[i + 1], p) : V.sub(p, pts[i - 1]);
        const side = V.norm([-t[2], 0, t[0]]);
        for (const s of [-1, 1]) {
          out.push(p[0] + side[0] * widths[i] * s, p[1], p[2] + side[2] * widths[i] * s, birth, dists[i], s, glow);
          n++;
        }
      }
      for (let i = 0; i < pts.length - 1; i++) {
        const a = base + i * 2;
        idx.push(a, a + 1, a + 3, a, a + 3, a + 2);
      }
    };
    for (const c of this.cracks) {
      const rnd = mulberry32(c.seed);
      for (let b = 0; b < c.branches; b++) {
        const ang = c.yaw + (b / c.branches) * Math.PI * 2 + (rnd() - 0.5) * 0.7;
        const len = c.length * (0.55 + rnd() * 0.45);
        const walk = (start: V3, dir: number, l: number, w0: number, d0: number, depth: number) => {
          const seg = Math.max(4, Math.round(l / 0.75));
          const pts: V3[] = [], dists: number[] = [], widths: number[] = [];
          let p = start, a = dir;
          for (let i = 0; i <= seg; i++) {
            const t = i / seg;
            pts.push([p[0], terrainHeight(p[0], p[2]), p[2]]);
            dists.push(d0 + (i / seg) * l);
            widths.push(Math.max(0.02, w0 * (1 - t * 0.92)));
            a += (rnd() - 0.5) * 0.55;
            p = [p[0] + Math.cos(a) * (l / seg), 0, p[2] + Math.sin(a) * (l / seg)];
            if (depth < 1 && i > 2 && i < seg - 1 && rnd() < 0.16) walk([...pts[i]] as V3, a + (rnd() < 0.5 ? -1 : 1) * (0.5 + rnd() * 0.5), l * (0.25 + rnd() * 0.25), w0 * 0.55 * (1 - t), dists[i], depth + 1);
          }
          strip(pts, dists, widths, c.start, c.glow);
        };
        walk([c.x, 0, c.z], ang, len, c.width, 0, 0);
      }
    }
    if (!out.length) return null;
    this.crackVerts = n;
    return new Mesh(this.gl, LAYOUT.crack, new Float32Array(out), new Uint32Array(idx));
  }
}

export function craterFromPower(x: number, z: number, power: number, start: number, seed: number): CraterDef {
  const p = clamp(power);
  return { x, z, radius: lerp(1.6, 7.5, p), depth: lerp(0.25, 1.8, p), start, grow: lerp(0.12, 0.35, p), seed };
}
