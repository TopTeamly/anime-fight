import { V, lerp, type V3 } from '../utils/math.js';
import { mulberry32, noise2 } from '../utils/rng.js';
import { Mesh, LAYOUT, type GL2, type Program } from '../engine/gl.js';
import { MeshBuilder, icoPositions } from '../engine/meshbuilder.js';
import { terrainHeight } from './terrain.js';

export type RockKind = 'boulder' | 'pillar';
export interface RockInst { kind: RockKind; pos: V3; yaw: number; scale: V3; tint: V3; breakT: number; fallYaw: number; hero: boolean; id: number }
export interface RockBreak { x: number; z: number; radius: number; t: number; mode: 'shatter' | 'topple'; yaw: number }

function boulderMesh(gl: GL2, subdiv: number, seed: number): Mesh {
  const { verts, faces } = icoPositions(subdiv);
  const rnd = mulberry32(seed);
  const disp = verts.map((v, i) => {
    const r = 0.82 + noise2(v[0] * 2.2 + seed, v[2] * 2.2 + v[1] * 1.7) * 0.42 + (rnd() - 0.5) * 0.06;
    const p: V3 = [v[0] * r, Math.max(v[1] * r * 0.82, -0.32), v[2] * r * 1.05];
    return p;
  });
  const mb = new MeshBuilder();
  for (const [a, b, c] of faces) {
    const n = V.norm(V.cross(V.sub(disp[b], disp[a]), V.sub(disp[c], disp[a])));
    const up = Math.max(n[1], 0);
    const shade = lerp(0.62, 1.0, up) * (0.9 + rnd() * 0.16);
    mb.flatTri(disp[a], disp[b], disp[c], [0.47 * shade, 0.41 * shade, 0.39 * shade]);
  }
  return mb.toStaticMesh(gl);
}

function pillarMesh(gl: GL2, sides: number, rows: number, seed: number): Mesh {
  const mb = new MeshBuilder();
  const rnd = mulberry32(seed);
  const ring = (t: number): V3[] => {
    const out: V3[] = [];
    const taper = 1.0 - t * 0.22 + (t < 0.08 ? (0.08 - t) * 1.6 : 0);
    for (let s = 0; s < sides; s++) {
      const a = (s / sides) * Math.PI * 2;
      const j = 0.82 + noise2(s * 1.7 + seed, t * 6.5) * 0.4;
      out.push([Math.cos(a) * 0.5 * taper * j, t, Math.sin(a) * 0.5 * taper * j]);
    }
    return out;
  };
  const rs: V3[][] = [];
  for (let r = 0; r <= rows; r++) rs.push(ring(r / rows));
  for (let r = 0; r < rows; r++) {
    const band = 0.72 + 0.28 * (Math.floor(r * 1.7 + seed) % 2);
    const tone = band * (0.92 + rnd() * 0.12);
    for (let s = 0; s < sides; s++) {
      const s1 = (s + 1) % sides;
      const shade = 0.75 + 0.25 * Math.max(0, Math.cos((s / sides) * Math.PI * 2 - 0.9));
      const c: V3 = [0.48 * tone * shade, 0.4 * tone * shade, 0.36 * tone * shade];
      mb.flatQuad(rs[r][s], rs[r][s1], rs[r + 1][s1], rs[r + 1][s], c);
    }
  }
  // jagged cap
  const top = rs[rows], centre: V3 = [0, 1.02, 0.02];
  for (let s = 0; s < sides; s++) mb.flatTri(top[s], top[(s + 1) % sides], [centre[0], centre[1] + rnd() * 0.02, centre[2]], [0.78, 0.66, 0.55]);
  return mb.toStaticMesh(gl);
}

interface Bucket { mesh: Mesh; buf: WebGLBuffer; data: Float32Array; count: number }

export class RockField {
  instances: RockInst[] = [];
  private buckets: Record<string, Bucket> = {};
  drawn = 0;
  constructor(private gl: GL2, seed = 7) {
    this.populate(seed);
    const make = (key: string, mesh: Mesh, cap: number) => {
      const buf = gl.createBuffer()!;
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, cap * 12 * 4, gl.DYNAMIC_DRAW);
      mesh.addInstances(buf, [{ loc: 6, size: 4 }, { loc: 7, size: 4 }, { loc: 8, size: 4 }], 12);
      this.buckets[key] = { mesh, buf, data: new Float32Array(cap * 12), count: 0 };
    };
    const nb = this.instances.filter((i) => i.kind === 'boulder').length, np = this.instances.filter((i) => i.kind === 'pillar').length;
    // LOD0 = detailed mesh, LOD1 = cheap mesh for distant instances (lazy variants are built once and shared)
    make('boulder0', boulderMesh(gl, 2, 3), nb);
    make('boulder1', boulderMesh(gl, 1, 3), nb);
    make('pillar0', pillarMesh(gl, 11, 9, 5), np);
    make('pillar1', pillarMesh(gl, 6, 4, 5), np);
  }

  private populate(seed: number) {
    const rnd = mulberry32(seed);
    let id = 0;
    const add = (kind: RockKind, x: number, z: number, sc: V3, hero = false) => {
      const tone = 0.86 + rnd() * 0.26;
      this.instances.push({ kind, pos: [x, terrainHeight(x, z) - 0.15, z], yaw: rnd() * 6.28, scale: sc, tint: [tone, tone * (0.96 + rnd() * 0.06), tone * (0.92 + rnd() * 0.1)], breakT: 1e9, fallYaw: -1, hero, id: id++ });
    };
    // hero pillars close to the fight zone (destructible by the timeline)
    for (const [x, z, h, w] of [[-30, 18, 15, 5], [28, -20, 19, 6], [4, -40, 24, 7], [14, 38, 13, 4.5], [-36, -22, 17, 5.5]]) add('pillar', x, z, [w, h, w], true);
    // boulders near the arena (some are hero boulders that shatter)
    for (const [x, z, s] of [[-19, 12, 1.9], [21, 9, 2.1], [-8, -20, 1.8], [14, -21, 2.2], [-25, -7, 2.0], [26, 17, 1.9], [2, 24, 1.8]]) add('boulder', x, z, [s * 1.2, s, s * 1.1], true);
    for (let i = 0; i < 130; i++) { const a = rnd() * 6.283, r = 4 + rnd() * 54, s = 0.25 + rnd() * 0.55; add('boulder', Math.cos(a) * r, Math.sin(a) * r, [s * 1.3, s, s * 1.1]); }
    for (let i = 0; i < 34; i++) { const a = rnd() * 6.283, r = 32 + rnd() * 40, s = 1.8 + rnd() * 3.2; add('boulder', Math.cos(a) * r, Math.sin(a) * r, [s * 1.3, s, s * 1.1]); }
    for (let i = 0; i < 20; i++) { const a = (i / 20) * 6.283 + rnd() * 0.3, r = 62 + rnd() * 70, h = 18 + rnd() * 60, w = 4 + rnd() * 6; add('pillar', Math.cos(a) * r, Math.sin(a) * r, [w, h, w]); }
  }

  /** assign break times from timeline events (deterministic, resets everything first) */
  applyBreaks(breaks: RockBreak[]) {
    for (const r of this.instances) { r.breakT = 1e9; r.fallYaw = -1; }
    for (const b of breaks) {
      for (const r of this.instances) {
        if (b.mode === 'topple' && r.kind !== 'pillar') continue;
        if (b.mode === 'shatter' && r.kind !== 'boulder') continue;
        if (Math.hypot(r.pos[0] - b.x, r.pos[2] - b.z) <= b.radius + r.scale[0] && r.breakT > b.t) {
          r.breakT = b.t;
          r.fallYaw = b.mode === 'topple' ? b.yaw : -1;
        }
      }
    }
  }
  nearest(x: number, z: number, kind: RockKind): RockInst | undefined {
    let best: RockInst | undefined, bd = 1e9;
    for (const r of this.instances) if (r.kind === kind) { const d = Math.hypot(r.pos[0] - x, r.pos[2] - z); if (d < bd) { bd = d; best = r; } }
    return best;
  }

  /** bucket instances by level of detail and upload */
  update(cam: V3) {
    for (const b of Object.values(this.buckets)) b.count = 0;
    for (const r of this.instances) {
      const d = Math.hypot(r.pos[0] - cam[0], r.pos[2] - cam[2]);
      const far = r.kind === 'boulder' ? d > 55 + r.scale[1] * 6 : d > 130;
      const b = this.buckets[r.kind + (far ? '1' : '0')];
      const o = b.count * 12;
      b.data.set([r.pos[0], r.pos[1], r.pos[2], r.yaw, r.scale[0], r.scale[1], r.scale[2], r.breakT, r.tint[0], r.tint[1], r.tint[2], r.fallYaw], o);
      b.count++;
    }
    const gl = this.gl;
    for (const b of Object.values(this.buckets)) {
      if (!b.count) continue;
      gl.bindBuffer(gl.ARRAY_BUFFER, b.buf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, b.data, 0, b.count * 12);
    }
  }

  draw(shadowPass: boolean, prog: Program) {
    prog.f('uShadowPass', shadowPass ? 1 : 0);
    this.drawn = 0;
    for (const b of Object.values(this.buckets)) if (b.count) { b.mesh.draw(this.gl.TRIANGLES, b.count); this.drawn += b.count; }
  }
}

export function blockingRock(field: RockField, p: V3, t: number): number {
  let lift = 0;
  for (const r of field.instances) {
    if (r.breakT <= t && r.kind === 'boulder') continue;
    const rad = (r.kind === 'pillar' ? r.scale[0] * 0.6 : r.scale[0] * 1.0) + 0.9;
    const top = r.kind === 'pillar' ? r.pos[1] + r.scale[1] : r.pos[1] + r.scale[1] * 0.85;
    if (r.kind === 'pillar' && r.breakT <= t) continue;
    if (Math.hypot(p[0] - r.pos[0], p[2] - r.pos[2]) < rad && p[1] < top + 0.2) lift = Math.max(lift, top + 0.35);
  }
  return lift;
}

/** height the camera must be lifted to so a rock does not block the line of sight from `cam` to `target` */
export function lineBlock(field: RockField, cam: V3, target: V3, t: number): number {
  let lift = 0;
  const d = V.sub(target, cam), L2 = V.dot(d, d) || 1;
  for (const r of field.instances) {
    if (r.kind === 'boulder' && (r.breakT <= t || r.scale[0] < 1.3)) continue;
    if (r.kind === 'pillar' && r.breakT <= t) continue;
    const rad = r.kind === 'pillar' ? r.scale[0] * 0.55 : r.scale[0] * 0.95;
    const c: V3 = [r.pos[0], r.pos[1] + (r.kind === 'pillar' ? Math.min(r.scale[1] * 0.5, 6) : r.scale[1] * 0.4), r.pos[2]];
    const k = Math.max(0, Math.min(1, V.dot(V.sub(c, cam), d) / L2));
    if (k >= 0.97) continue;
    const p: V3 = V.mad(cam, d, k);
    if (V.dist(p, c) < rad * 1.05) lift = Math.max(lift, c[1] + rad * 1.1 + 0.4);
  }
  return lift;
}
