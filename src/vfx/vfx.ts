import { V, Q, M, clamp, lerp, rad, smoothstep, type V3 } from '../utils/math.js';
import { ease } from '../utils/ease.js';
import { mulberry32, hashStr, snoise1 } from '../utils/rng.js';
import { FloatBatch, Mesh, LAYOUT, type GL2 } from '../engine/gl.js';
import { MeshBuilder, discMesh, hex, icoPositions, uvSphere } from '../engine/meshbuilder.js';
import type { Renderer, VfxDrawable } from '../engine/renderer.js';
import type { Clip } from '../timeline/model.js';
import type { Fighter, FighterFrame } from '../characters/fighter.js';
import type { TrackEval } from '../animation/fighterTrack.js';
import { emptyPost, type PostState, type FlashLight } from '../scene/types.js';
import { EnvDamage, craterFromPower, terrainHeight, type CrackDef, type CraterDef } from '../environment/terrain.js';
import { InstancePool, quadMesh, type P } from './particles.js';

export interface VfxContext {
  t: number;
  fighters: { A: Fighter; B: Fighter };
  evals: { A: TrackEval; B: TrackEval };
  probe(who: 'A' | 'B', bone: string, t: number): V3;
  frameAt(who: 'A' | 'B', t: number): FighterFrame;
  camPos: V3; camRight: V3; camUp: V3; fovY: number;
}

interface Slot { pool: InstancePool; start: number; n: number }
interface RingSpec { c: V3; rot: V3; t0: number; dur: number; rmax: number; thick: number; color: V3; alpha: number; dome: boolean }
interface Inst { clip: Clip; slots: Slot[]; end: number; rings: RingSpec[]; origin: V3 }

/** tail = how long particles from this type can outlive the clip */
const TAIL: Record<string, number> = { sparks: 1.5, dust: 4.5, smoke: 7, fire: 2, burst: 2, debris: 16, explosion: 12, groundHit: 14, crater: 8, groundCrack: 5, aura: 1.5, shockwave: 0.2, energyBall: 0.5 };
const lin = (h: string, m = 1): V3 => { const c = hex(h); return [c[0] ** 2.2 * m, c[1] ** 2.2 * m, c[2] ** 2.2 * m]; };
const rgba = (c: V3, a: number): [number, number, number, number] => [c[0], c[1], c[2], a];

export class VfxSystem implements VfxDrawable {
  private add: InstancePool; private alpha: InstancePool; private debris: InstancePool;
  private glowB = new FloatBatch(60000);
  private glowMesh: Mesh;
  private disc: Mesh; private sphere: Mesh;
  private clips: Clip[] = [];
  private active = new Map<string, Inst>();
  post: PostState = emptyPost();
  flashes: FlashLight[] = [];
  private rings: RingSpec[] = [];
  private anchors = new Float32Array(30);
  private quality = 1;
  stats = { particles: 0, debris: 0, active: 0, ribbons: 0 };
  private lastT = -1;

  constructor(private gl: GL2, private damage: EnvDamage) {
    const q = quadMesh(gl), q2 = quadMesh(gl);
    this.add = new InstancePool(gl, q, [1, 2, 3, 4, 5, 6], 26000, 24);
    this.alpha = new InstancePool(gl, q2, [1, 2, 3, 4, 5, 6], 14000, 24);
    // debris: low-poly chunk
    const { verts, faces } = icoPositions(0);
    const mb = new MeshBuilder();
    const rn = mulberry32(11);
    const dv = verts.map((v) => V.mul(v, 0.7 + rn() * 0.5));
    for (const [a, b, c] of faces) mb.flatTri(dv[a], dv[b], dv[c], V.mul([0.5, 0.42, 0.38], 0.8 + rn() * 0.4));
    const dm = mb.toStaticMesh(gl);
    this.debris = new InstancePool(gl, dm, [6, 7, 8, 9, 10], 4200, 20);
    this.glowMesh = new Mesh(gl, LAYOUT.glow, new Float32Array(LAYOUT.glow.stride * 3), undefined, true);
    this.disc = discMesh(96).toStaticMesh(gl);
    this.sphere = uvSphere(24, 14).toStaticMesh(gl);
  }

  setQuality(q: number) { this.quality = q; }

  /** (re)load clips and compile environment damage (craters / cracks) */
  setClips(user: Clip[], derived: Clip[]) {
    for (const i of this.active.values()) this.releaseInst(i);
    this.active.clear();
    this.clips = [...user, ...derived].filter((c) => c.track === 'vfx' || c.track === 'environment').sort((a, b) => a.start - b.start);
    const craters: CraterDef[] = [], cracks: CrackDef[] = [];
    for (const c of this.clips) {
      const p = c.params, pos = (p.pos ?? [0, 0, 0]) as V3, k = p.intensity ?? 1, sc = p.scale ?? 1;
      const sd = (p.seed ?? 1) + hashStr(c.id) % 997;
      if (c.type === 'groundHit') {
        const pw = clamp(k * 0.5 + (sc - 1) * 0.15, 0.05, 1.2);
        cracks.push({ x: pos[0], z: pos[2], length: (1.0 + 3.6 * pw) * Math.min(sc, 1.8), width: 0.035 + 0.06 * pw, yaw: rad((p.rot?.[1] ?? 0)) + sd, start: c.start, seed: sd, glow: pw > 0.7 ? 0.5 : 0, branches: 4 + Math.floor(4 * pw), speed: 14 });
        if (pw > 0.55) craters.push({ ...craterFromPower(pos[0], pos[2], pw, c.start, sd), radius: lerp(1.8, 7, pw) * sc * 0.8 });
      } else if (c.type === 'crater') {
        craters.push({ x: pos[0], z: pos[2], radius: 2.6 * sc, depth: 0.55 * k * sc, start: c.start, grow: 0.3, seed: sd });
        cracks.push({ x: pos[0], z: pos[2], length: 3.6 * Math.min(sc, 2), width: 0.06, yaw: sd, start: c.start, seed: sd + 1, glow: 0.3, branches: 6, speed: 14 });
      } else if (c.type === 'groundCrack') cracks.push({ x: pos[0], z: pos[2], length: 4 * Math.min(sc, 2.4), width: 0.05 * k, yaw: rad(p.rot?.[1] ?? 0) + sd, start: c.start, seed: sd, glow: 0, branches: 5, speed: 14 });
    }
    this.damage.set(craters, cracks);
  }

  private releaseInst(i: Inst) { for (const s of i.slots) s.pool.release(s.start, s.n); i.slots = []; }

  // ------------------------------------------------------------------ helpers
  private origin(c: Clip, ctx: VfxContext, at: number): V3 {
    const p = c.params, off = (p.pos ?? [0, 0, 0]) as V3;
    if (p.attach === 'A' || p.attach === 'B') return V.add(ctx.probe(p.attach, p.bone ?? 'root', at), off);
    return off;
  }
  private put(pool: InstancePool, list: P[], inst: Inst) {
    if (!list.length) return;
    const n = Math.max(1, Math.floor(list.length * this.quality));
    const s = pool.alloc(n);
    if (s < 0) return;
    for (let i = 0; i < n; i++) pool.put(s + i, list[i]);
    inst.slots.push({ pool, start: s, n });
  }
  private putDebris(list: { p: V3; v: V3; birth: number; life: number; axis: V3; spin: number; size: number; gy: number; rest: number; tint: V3 }[], inst: Inst) {
    if (!list.length) return;
    const n = Math.max(1, Math.floor(list.length * this.quality));
    const s = this.debris.alloc(n);
    if (s < 0) return;
    const d = this.debris.data, st = this.debris.stride;
    for (let i = 0; i < n; i++) {
      const q = list[i], o = (s + i) * st;
      d.set([q.p[0], q.p[1], q.p[2], q.birth, q.v[0], q.v[1], q.v[2], q.life, q.axis[0], q.axis[1], q.axis[2], q.spin, q.size, q.gy, q.rest, 0, q.tint[0], q.tint[1], q.tint[2], 0], o);
    }
    this.debris.touch(s, s + n);
    inst.slots.push({ pool: this.debris, start: s, n });
  }

  private sphereDir(r: () => number): V3 { const u = r() * 2 - 1, a = r() * 6.2832, s = Math.sqrt(1 - u * u); return [s * Math.cos(a), u, s * Math.sin(a)]; }
  private coneDir(r: () => number, axis: V3, half: number): V3 {
    const a = V.norm(axis), t = V.norm(Math.abs(a[1]) < 0.9 ? V.cross(a, [0, 1, 0]) : V.cross(a, [1, 0, 0])), b = V.cross(a, t);
    const cz = Math.cos(half * r()), sz = Math.sin(half * r() * 1.0 + 0.0001) * 1, ph = r() * 6.2832;
    const c = Math.cos(half * Math.pow(r(), 0.7));
    void cz; void sz;
    const s = Math.sqrt(1 - c * c);
    return V.norm(V.add(V.add(V.mul(a, c), V.mul(t, s * Math.cos(ph))), V.mul(b, s * Math.sin(ph))));
  }
  private axisOf(rot: V3): V3 { return Q.rotate(Q.euler(rad(rot[0]), rad(rot[1]), rad(rot[2])), [0, 1, 0]); }

  // ------------------------------------------------------------------ emission (once per activation; closed-form afterwards)
  private activate(c: Clip, ctx: VfxContext): Inst {
    const p = c.params, k = p.intensity ?? 1, sc = p.scale ?? 1, op = p.opacity ?? 1;
    const inst: Inst = { clip: c, slots: [], end: c.start + c.dur + (TAIL[c.type] ?? 0.3), rings: [], origin: [0, 0, 0] };
    const rnd = mulberry32(((p.seed ?? 1) * 7919 + hashStr(c.id)) >>> 0);
    const o = this.origin(c, ctx, c.start);
    inst.origin = o;
    const col1 = lin(p.color ?? '#ffd9a0', 1.6 * k), col2 = lin(p.color2 ?? '#ff8a3a', 1.4 * k);
    const t0 = c.start;
    const axis = this.axisOf((p.rot ?? [0, 0, 0]) as V3);
    const gy = terrainHeight(o[0], o[2]);
    const scp = Math.pow(sc, 0.7);
    const list: P[] = [];
    const dbg: Parameters<VfxSystem['putDebris']>[0] = [];
    const sparks = (n: number, spd: number, half: number, life: number, size: number, ax: V3, org: V3 = o) => {
      for (let i = 0; i < n; i++) {
        const d = this.coneDir(rnd, ax, half), s = spd * (0.4 + rnd() * 0.9);
        list.push({ p: V.add(org, V.mul(d, 0.05)), v: V.mul(d, s), birth: t0 + rnd() * 0.05, life: life * (0.5 + rnd() * 0.7), c0: rgba(col1, op), c1: rgba(col2, 0), s0: size * (0.6 + rnd() * 0.8), s1: size * 0.3, g: 9, drag: 0.6, shape: 1 });
      }
    };
    const puffs = (n: number, spd: number, up: number, life: number, s0: number, s1: number, color: V3, a: number, org: V3 = o, radius = 0.3) => {
      for (let i = 0; i < n; i++) {
        const ang = rnd() * 6.2832, sp = spd * (0.3 + rnd());
        const ppos: V3 = [org[0] + Math.cos(ang) * radius * rnd(), Math.max(org[1], gy) + 0.1, org[2] + Math.sin(ang) * radius * rnd()];
        list.push({ p: ppos, v: [Math.cos(ang) * sp, up * (0.3 + rnd()), Math.sin(ang) * sp], birth: t0 + rnd() * 0.12, life: life * (0.6 + rnd() * 0.6), c0: rgba(color, a * op), c1: rgba(color, 0), s0: s0 * (0.6 + rnd() * 0.8), s1: s1 * (0.7 + rnd() * 0.7), rot: rnd() * 6, rotV: (rnd() - 0.5) * 0.8, g: -0.25, drag: 1.5, shape: 2 });
      }
    };
    const chunks = (n: number, spd: number, size: number, org: V3 = o) => {
      for (let i = 0; i < n; i++) {
        const ang = rnd() * 6.2832, up = 0.35 + rnd() * 0.9, s = spd * (0.3 + rnd() * 0.9);
        const tone = 0.7 + rnd() * 0.5;
        dbg.push({ p: [org[0] + (rnd() - 0.5) * 0.6, Math.max(org[1], gy) + 0.1, org[2] + (rnd() - 0.5) * 0.6], v: [Math.cos(ang) * s, up * s, Math.sin(ang) * s], birth: t0 + rnd() * 0.06, life: 7 + rnd() * 8, axis: this.sphereDir(rnd), spin: (rnd() - 0.5) * 16, size: size * (0.3 + rnd() * 1.1), gy: terrainHeight(org[0] + Math.cos(ang) * s * 0.9, org[2] + Math.sin(ang) * s * 0.9) + size * 0.25, rest: 0.25 + rnd() * 0.25, tint: [tone, tone * 0.95, tone * 0.9] });
      }
    };
    const ring = (rmax: number, dur: number, color: V3, alpha: number, dome = false, org: V3 = o, thick = 0.22) => inst.rings.push({ c: [org[0], Math.max(org[1], gy) + 0.06, org[2]], rot: (p.rot ?? [0, 0, 0]) as V3, t0, dur, rmax, thick, color, alpha, dome });
    const dustCol: V3 = [0.42, 0.34, 0.27];

    switch (c.type) {
      case 'sparks': sparks(Math.round(70 * k * sc), 9 * sc, 1.3, 0.8, 0.09 * sc, axis); break;
      case 'burst': sparks(Math.round(50 * k), 7 * sc, 3.14, 0.7, 0.08 * sc, axis); for (let i = 0; i < 24 * k; i++) { const d = this.sphereDir(rnd); list.push({ p: o, v: V.mul(d, 3.5 * sc * (0.3 + rnd())), birth: t0, life: 0.6 * (0.6 + rnd() * 0.6), c0: rgba(col1, op), c1: rgba(col2, 0), s0: 0.22 * sc, s1: 0.02, drag: 2, shape: 0 }); } break;
      case 'dust': puffs(Math.round(18 * k * scp), 2.4 * scp, 1.4, 2.2, 0.32 * scp, 1.2 * scp, dustCol, 0.42); break;
      case 'smoke': puffs(Math.round(20 * k), 1.0 * scp, 3.0 * scp, 4.5, 0.6 * scp, 2.2 * scp, [0.2, 0.17, 0.16], 0.5, o, 0.5 * scp); break;
      case 'fire': for (let i = 0; i < 44 * k; i++) { const ang = rnd() * 6.28, r = rnd() * 0.5 * sc; list.push({ p: [o[0] + Math.cos(ang) * r, o[1], o[2] + Math.sin(ang) * r], v: [0, 2.2 * sc * (0.5 + rnd()), 0], birth: t0 + rnd() * c.dur, life: 0.7 + rnd() * 0.6, c0: rgba(col1, op), c1: rgba(col2, 0), s0: 0.5 * sc, s1: 0.15 * sc, g: -1, drag: 0.6, shape: 3 }); } break;
      case 'debris': chunks(Math.round(20 * k * scp), 8 * scp, 0.22 * scp); break;
      case 'groundHit': {
        const pw = clamp(k * 0.5 + (sc - 1) * 0.15, 0.05, 1.2);
        puffs(Math.round(10 + 22 * pw), 1.6 + 3.4 * pw, 0.6 + 1.6 * pw, 1.6 + 1.6 * pw, 0.3 + 0.35 * pw, 1.0 + 1.6 * pw, dustCol, 0.45);
        if (pw > 0.25) sparks(Math.round(8 + 26 * pw), 5 + 5 * pw, 1.4, 0.55, 0.07, [0, 1, 0]);
        chunks(Math.round(3 + 26 * pw * pw), 3 + 9 * pw, 0.12 + 0.28 * pw);
        if (pw > 0.4) ring(3 + 8 * pw, 0.5 + 0.3 * pw, [1.4, 1.1, 0.8], 0.55 * op);
        break;
      }
      case 'crater': puffs(36, 3.5 * scp, 2.2, 3.0, 0.6 * scp, 2.4 * scp, dustCol, 0.42); chunks(14, 8 * scp, 0.3 * scp); ring(7 * sc, 0.8, [1.3, 1.0, 0.7], 0.5); break;
      case 'groundCrack': puffs(10, 1.4, 0.5, 1.2, 0.3, 0.9, dustCol, 0.4); break;
      case 'explosion': {
        const R = 3.2 * sc * (0.6 + 0.4 * k);
        for (let i = 0; i < 34 * k; i++) { const d = this.sphereDir(rnd); d[1] = Math.abs(d[1]) * 0.8 + 0.1; list.push({ p: V.add(o, V.mul(d, 0.2)), v: V.mul(d, R * (0.7 + rnd() * 1.4)), birth: t0 + rnd() * 0.08, life: 0.7 + rnd() * 0.5, c0: rgba(V.mul(col1, 1.3), op), c1: rgba(col2, 0), s0: 0.9 * sc, s1: 2.2 * sc, drag: 3.2, rotV: 1, shape: rnd() < 0.5 ? 0 : 3 }); }
        sparks(Math.round(60 * k), 12 * sc, 3.14, 1.0, 0.1 * sc, [0, 1, 0]);
        puffs(Math.round(22 * k), 3.0 * scp, 3.5, 4.8, 1.1 * scp, 3.2 * scp, [0.2, 0.17, 0.15], 0.55, V.add(o, [0, 0.4, 0]), 1.0 * scp);
        puffs(Math.round(20 * k), 4.2 * scp, 1.4, 3, 0.8 * scp, 2.4 * scp, dustCol, 0.45);
        chunks(Math.round(14 * k * scp), 9 * scp, 0.32 * scp);
        ring(11 * sc, 0.7, col1, 0.9 * op, false, o, 0.3); ring(5.5 * sc, 0.55, col1, 1.0 * op, true, V.add(o, [0, 0.4, 0]));
        break;
      }
      case 'aura': {
        const who = p.attach === 'B' ? 1 : 0;
        const n = Math.round(Math.min(900, c.dur * 55 * k * this.quality));
        for (let i = 0; i < n; i++) {
          const ang = rnd() * 6.2832, r = (0.25 + rnd() * 0.3) * sc, hgt = rnd() * 1.7 * sc;
          list.push({ p: [Math.cos(ang) * r, hgt * 0.4, Math.sin(ang) * r], v: [0, 1.4 + rnd() * 2.2, 0], birth: t0 + (i / n) * c.dur + rnd() * 0.02, life: 0.55 + rnd() * 0.6, c0: rgba(V.mul(col1, 0.55), 0.7 * op), c1: rgba(col2, 0), s0: (0.3 + rnd() * 0.25) * sc, s1: 0.1 * sc, g: -0.6, drag: 0.4, anchor: 1 + who, shape: 3 });
        }
        for (let i = 0; i < n * 0.3; i++) { const d = this.sphereDir(rnd); list.push({ p: [d[0] * 0.5, 0.2 + rnd() * 1.4, d[2] * 0.5], v: [d[0] * 1.2, 2 + rnd() * 3, d[2] * 1.2], birth: t0 + rnd() * c.dur, life: 0.5 + rnd() * 0.5, c0: rgba(V.mul(col1, 1.8), op), c1: rgba(col2, 0), s0: 0.1 * sc, s1: 0.03, g: 0, drag: 0.5, anchor: 1 + who, shape: 1 }); }
        break;
      }
      case 'shockwave': ring(4 * sc * (0.6 + 0.4 * k), c.dur, col1, 0.9 * op, p.who === 'A', o, 0.28); break;
      default: break;
    }
    // additive vs alpha split: shapes 2 (smoke puffs) go to the alpha pool, everything else additive
    const addL = list.filter((q) => q.shape !== 2), alphaL = list.filter((q) => q.shape === 2);
    this.put(this.add, addL, inst); this.put(this.alpha, alphaL, inst);
    this.putDebris(dbg, inst);
    return inst;
  }

  // ------------------------------------------------------------------ per-frame update
  update(t: number, ctx: VfxContext, lines?: [V3, V3][]) {
    // clear per-frame state
    this.post = emptyPost(); this.flashes = []; this.rings = []; this.glowB.clear();
    this.anchors.fill(0);
    const fa = ctx.fighters.A, fb = ctx.fighters.B;
    const ra = fa.rig.world('root'), rb = fb.rig.world('root');
    this.anchors.set(ra, 0); this.anchors.set(rb, 3);
    fa.clearGhosts(); fb.clearGhosts();
    const back = t < this.lastT - 1e-6;
    this.lastT = t;
    void back;
    const P = this.post;
    let impactMode = 0;
    // activate / deactivate
    const seen = new Set<string>();
    for (const c of this.clips) {
      if (c.start > t) break;
      const end = c.start + c.dur + (TAIL[c.type] ?? 0.3);
      if (t > end) continue;
      seen.add(c.id);
      let inst = this.active.get(c.id);
      if (!inst) { inst = this.activate(c, ctx); this.active.set(c.id, inst); }
      for (const r of inst.rings) this.rings.push(r);
      if (t <= c.start + c.dur + 0.05) this.frameEffects(c, inst, t, ctx, P);
      if (c.type === 'impactFrame' && t <= c.start + c.dur) impactMode = c.params.who === 'A' ? 1 : c.params.who === 'B' ? 2 : 1 + (Math.floor(t * 24) % 2);
      if (c.type === 'explosion' || c.type === 'crater' || (c.type === 'groundHit' && (c.params.intensity ?? 1) > 1.4)) this.explosionScreen(c, inst, t, ctx, P);
    }
    for (const [id, inst] of this.active) if (!seen.has(id)) { this.releaseInst(inst); this.active.delete(id); }
    P.impact = impactMode;
    // rings -> screen distortion (shockwave heat ripple)
    for (const r of this.rings) {
      const u = clamp((t - r.t0) / r.dur);
      if (u <= 0 || u >= 1 || r.dome) continue;
      const pr = ctx.evals; void pr;
      const s = this.proj(r.c, ctx);
      if (!s) continue;
      const rad0 = (r.rmax * ease('outCubic', u)) / (2 * s.depth * Math.tan(ctx.fovY / 2));
      if (P.distort.length < 6 && rad0 < 1.2) P.distort.push({ x: s.x, y: s.y, radius: rad0, amp: (1 - u) * 0.55 * r.alpha, thick: 0.05 + 0.04 * u });
    }
    this.pushRings(t);
    if (lines) for (const [a, b] of lines) this.ribbon([a, b], [0.014, 0.014], [0.2, 1.6, 0.9], [0.2, 1.6, 0.9], ctx, 3);
    this.add.flush(); this.alpha.flush(); this.debris.flush();
    this.glowMesh.update(this.glowB.view(), this.glowB.n / LAYOUT.glow.stride);
    this.stats.particles = this.add.used + this.alpha.used; this.stats.debris = this.debris.used; this.stats.active = this.active.size;
    this.stats.ribbons = this.glowB.n / (LAYOUT.glow.stride * 6);
  }

  private proj(p: V3, ctx: VfxContext): { x: number; y: number; depth: number } | null {
    const v = this.rendererVP;
    if (!v) return null;
    const w = v[3] * p[0] + v[7] * p[1] + v[11] * p[2] + v[15];
    if (w <= 0.05) return null;
    return { x: ((v[0] * p[0] + v[4] * p[1] + v[8] * p[2] + v[12]) / w) * 0.5 + 0.5, y: ((v[1] * p[0] + v[5] * p[1] + v[9] * p[2] + v[13]) / w) * 0.5 + 0.5, depth: w };
  }
  rendererVP: Float32Array | null = null;

  private explosionScreen(c: Clip, inst: Inst, t: number, ctx: VfxContext, P: PostState) {
    const u = (t - c.start), k = c.params.intensity ?? 1;
    if (u < 0 || u > 1.2) return;
    const env = Math.exp(-u * 5.5) * clamp(k, 0, 2);
    const col = lin(c.params.color ?? '#ffd9a0', 1);
    P.flash[0] += col[0] * 0.9; P.flash[1] += col[1] * 0.9; P.flash[2] += col[2] * 0.9; P.flash[3] = Math.min(1.4, P.flash[3] + env * 0.9);
    P.chroma = Math.max(P.chroma, env * 0.03);
    P.radial = Math.max(P.radial, env * 0.6);
    const s = this.proj(inst.origin, ctx);
    if (s) { P.radialCx = s.x; P.radialCy = s.y; }
    this.flashes.push({ pos: V.add(inst.origin, [0, 1.5, 0]), color: col, intensity: env * 60 });
  }

  private frameEffects(c: Clip, inst: Inst, t: number, ctx: VfxContext, P: PostState) {
    const p = c.params, k = p.intensity ?? 1, sc = p.scale ?? 1, op = p.opacity ?? 1;
    const u = clamp((t - c.start) / Math.max(c.dur, 0.001));
    const env = smoothstep(0, 0.12, u) * (1 - smoothstep(0.7, 1, u));
    const col1 = lin(p.color ?? '#ffd9a0', 1.8 * k), col2 = lin(p.color2 ?? '#ff8a3a', 1.5 * k);
    const who = p.attach === 'B' ? 'B' : p.attach === 'A' ? 'A' : null;
    switch (c.type) {
      case 'flash': {
        const e = Math.pow(1 - u, 1.6) * op * k;
        const col = lin(p.color ?? '#ffffff', 1);
        P.flash[0] += col[0]; P.flash[1] += col[1]; P.flash[2] += col[2]; P.flash[3] = Math.min(1.6, P.flash[3] + e * 0.9);
        this.flashes.push({ pos: V.add(this.origin(c, ctx, t), [0, 1, 0]), color: col, intensity: e * 50 * sc });
        break;
      }
      case 'speedLines': {
        P.speedLines = Math.max(P.speedLines, env * k * op); P.speedColor = lin(p.color ?? '#ffffff', 1); if (who) { const s = this.proj(ctx.fighters[who].point('chest'), ctx); if (s) { P.speedCx = s.x; P.speedCy = s.y; } }
        break;
      }
      case 'heatDistort': {
        const o = this.origin(c, ctx, t), s = this.proj(o, ctx);
        if (s && P.distort.length < 6) P.distort.push({ x: s.x, y: s.y, radius: 0.04 + 0.2 * u * sc * 0.5, amp: env * k * 0.5, thick: 0.12 });
        P.heat = Math.max(P.heat, env * k * 0.5);
        break;
      }
      case 'aura': {
        if (!who) break;
        const f = ctx.fighters[who];
        f.visual = { ...f.visual, aura: Math.max(f.visual.aura, env * k * op), auraMix: p.who === 'neutral' ? f.visual.auraMix : Math.max(f.visual.auraMix, p.who === who ? 1 : 0) };
        const gp = f.rig.world('root');
        this.sprite(V.add(gp, [0, 0.05, 0]), 1.7 * sc, V.mul(col2, 0.28 * env), 1, ctx);
        this.flashes.push({ pos: V.add(gp, [0, 1.2, 0]), color: col1, intensity: 2.2 * env * k });
        break;
      }
      case 'lightning': {
        const n = 5, seed = Math.floor(t * 24) * 131 + (p.seed ?? 1);
        const r = mulberry32(seed);
        const org = this.origin(c, ctx, t);
        for (let b = 0; b < n; b++) {
          const start = who ? V.add(ctx.fighters[who].point(['chest', 'head', 'hips', 'fistL', 'fistR', 'footL'][Math.floor(r() * 6)]), [0, 0, 0]) : V.add(org, [(r() - 0.5) * sc, 0, (r() - 0.5) * sc]);
          const end = who ? V.add(start, V.mul(this.sphereDir(r), (0.7 + r() * 1.1) * sc)) : ((p.to && V.len(p.to) > 0.01) ? (p.to as V3) : V.add(start, [(r() - 0.5) * 6 * sc, 3 * sc * r(), (r() - 0.5) * 6 * sc]));
          this.bolt(start, end, r, 0.035 * sc, V.mul(col1, env), ctx);
        }
        this.flashes.push({ pos: V.add(org, [0, 1.5, 0]), color: col1, intensity: (r0(seed) > 0.5 ? 14 : 4) * env });
        break;
      }
      case 'trail': {
        if (!who) break;
        const pts: V3[] = [], wd: number[] = [];
        const N = 14, dt = 0.011;
        for (let i = 0; i < N; i++) { pts.push(ctx.probe(who, p.bone ?? 'fistR', t - i * dt)); wd.push(0.16 * sc * (1 - i / N) * (0.3 + 0.7 * env)); }
        this.ribbon(pts, wd, V.mul(col1, 1.0 * (0.4 + 0.6 * env)), V.mul(col2, 0.6), ctx);
        break;
      }
      case 'afterimage': {
        if (!who) break;
        const f = ctx.fighters[who];
        const tint = lin(p.color ?? '#9fd0ff', 1.0 * k);
        for (let i = 1; i <= 3; i++) f.addGhost(ctx.frameAt(who, t - i * 0.05 * sc), tint, 0.32 * env * op / i);
        break;
      }
      case 'energyBall': {
        const o = this.ballPos(c, t, ctx, u);
        const grow = c.params.to && V.len(c.params.to) > 0.01 ? 1 : smoothstep(0, 1, u);
        const size = sc * (0.25 + 0.75 * grow) * (1 - 0.6 * smoothstep(0.92, 1, u));
        this.sprite(o, size * 2.6, V.mul(col2, 0.7), 1, ctx); this.sprite(o, size * 1.5, col1, 1, ctx); this.sprite(o, size * 0.75, [3.2 * k, 3.2 * k, 3.2 * k], 1, ctx);
        const r = mulberry32(Math.floor(t * 30));
        for (let i = 0; i < 8; i++) { const a = t * 6 + (i / 8) * 6.28, rr = size * (1.0 + 0.4 * Math.sin(t * 9 + i)); this.sprite(V.add(o, [Math.cos(a) * rr, Math.sin(a * 1.3) * rr * 0.6, Math.sin(a) * rr]), size * 0.28, V.mul(col1, 0.8), 1, ctx); }
        void r;
        this.flashes.push({ pos: o, color: col1, intensity: 16 * size * env });
        if (c.params.to && V.len(c.params.to) > 0.01) { // projectile trail
          const pts: V3[] = [], wd: number[] = [];
          for (let i = 0; i < 10; i++) { pts.push(this.ballPos(c, t - i * 0.02, ctx, clamp((t - i * 0.02 - c.start) / c.dur))); wd.push(size * 1.1 * (1 - i / 10)); }
          this.ribbon(pts, wd, V.mul(col1, 0.8), col2, ctx);
        }
        break;
      }
      case 'beam': {
        const s = this.origin(c, ctx, t);
        let e: V3 = (p.to && V.len(p.to) > 0.01) ? (p.to as V3) : (who ? ctx.fighters[who === 'A' ? 'B' : 'A'].point('chest') : V.add(s, [10, 0, 0]));
        const grow = smoothstep(0, 0.12, u), fade = 1 - smoothstep(0.82, 1, u);
        const dir = V.norm(V.sub(e, s)), len = V.dist(s, e) * grow;
        e = V.mad(s, dir, len);
        const w = sc * (0.5 + 0.5 * Math.sin(t * 70) * 0.05) * fade * op;
        const seg = 18;
        const pts: V3[] = []; for (let i = 0; i <= seg; i++) pts.push(V.mad(s, dir, (len * i) / seg));
        this.ribbon(pts, pts.map(() => w * 1.9), V.mul(col2, 0.55 * fade), V.mul(col2, 0.4 * fade), ctx);
        this.ribbon(pts, pts.map(() => w * 1.05), V.mul(col1, 0.9 * fade), V.mul(col1, 0.8 * fade), ctx);
        this.ribbon(pts, pts.map(() => w * 0.45), [3.4 * fade, 3.4 * fade, 3.4 * fade], [3 * fade, 3 * fade, 3 * fade], ctx, 3);
        const side = V.norm(V.cross(dir, [0, 1, 0]));
        for (let sp = 0; sp < 3; sp++) {
          const sp2: V3[] = [];
          for (let i = 0; i <= seg; i++) { const a = (i / seg) * 18 - t * 24 + sp * 2.094, r2 = w * 0.9 * Math.sin(Math.PI * (i / seg)); sp2.push(V.add(pts[i], V.add(V.mul(side, Math.cos(a) * r2), [0, Math.sin(a) * r2, 0]))); }
          this.ribbon(sp2, sp2.map(() => w * 0.16), V.mul(col1, 0.9 * fade), V.mul(col1, 0.6 * fade), ctx);
        }
        this.sprite(s, w * 3.2, V.mul(col1, fade), 1, ctx); this.sprite(e, w * 4.5, V.mul(col2, fade), 1, ctx); this.sprite(e, w * 2, [3 * fade, 3 * fade, 3 * fade], 1, ctx);
        this.flashes.push({ pos: e, color: col1, intensity: 22 * w * fade });
        P.heat = Math.max(P.heat, 0.35 * fade); P.chroma = Math.max(P.chroma, 0.006 * fade);
        break;
      }
      default: break;
    }
  }

  private ballPos(c: Clip, t: number, ctx: VfxContext, u: number): V3 {
    const p = c.params, a = this.origin(c, ctx, Math.min(t, c.start + c.dur * 0.35));
    if (p.to && V.len(p.to) > 0.01) return V.lerp(a, p.to as V3, ease('in', clamp(u)));
    return this.origin(c, ctx, t);
  }

  // ------------------------------------------------------------------ glow batch builders
  private ribbon(pts: V3[], widths: number[], c0: V3, c1: V3, ctx: VfxContext, shape = 0) {
    const b = this.glowB, n = pts.length;
    if (n < 2) return;
    let prevL: V3 | null = null, prevR: V3 | null = null, prevC: V3 = c0;
    for (let i = 0; i < n; i++) {
      const tan = V.norm(V.sub(pts[Math.min(n - 1, i + 1)], pts[Math.max(0, i - 1)]));
      let side = V.cross(tan, V.norm(V.sub(pts[i], ctx.camPos)));
      side = V.len(side) < 1e-5 ? [0, 1, 0] : V.norm(side);
      const L = V.mad(pts[i], side, widths[i] * 0.5), R = V.mad(pts[i], side, -widths[i] * 0.5);
      const col = V.lerp(c0, c1, i / (n - 1));
      if (prevL && prevR) {
        const pc = prevC;
        b.push(...prevL, 0, -1, pc[0], pc[1], pc[2], 1, shape, ...prevR, 0, 1, pc[0], pc[1], pc[2], 1, shape, ...R, 0, 1, col[0], col[1], col[2], 1, shape);
        b.push(...prevL, 0, -1, pc[0], pc[1], pc[2], 1, shape, ...R, 0, 1, col[0], col[1], col[2], 1, shape, ...L, 0, -1, col[0], col[1], col[2], 1, shape);
      }
      prevL = L; prevR = R; prevC = col;
    }
  }
  private sprite(p: V3, size: number, col: V3, shape: number, ctx: VfxContext) {
    const r = V.mul(ctx.camRight, size), u = V.mul(ctx.camUp, size), b = this.glowB;
    const corner = (sx: number, sy: number): V3 => V.add(p, V.add(V.mul(r, sx), V.mul(u, sy)));
    const A = corner(-1, -1), B = corner(1, -1), C = corner(1, 1), D = corner(-1, 1);
    b.push(...A, -1, -1, col[0], col[1], col[2], 1, shape, ...B, 1, -1, col[0], col[1], col[2], 1, shape, ...C, 1, 1, col[0], col[1], col[2], 1, shape);
    b.push(...A, -1, -1, col[0], col[1], col[2], 1, shape, ...C, 1, 1, col[0], col[1], col[2], 1, shape, ...D, -1, 1, col[0], col[1], col[2], 1, shape);
  }
  private bolt(a: V3, b: V3, r: () => number, w: number, col: V3, ctx: VfxContext) {
    const n = 9, pts: V3[] = [], d = V.sub(b, a), len = V.len(d);
    const dir = V.norm(d), t1 = V.norm(V.cross(dir, [0.3, 1, 0.2])), t2 = V.cross(dir, t1);
    for (let i = 0; i <= n; i++) {
      const k = i / n, j = (i === 0 || i === n) ? 0 : 1, amp = len * 0.12 * j * Math.sin(Math.PI * k);
      pts.push(V.add(V.mad(a, d, k), V.add(V.mul(t1, (r() - 0.5) * 2 * amp), V.mul(t2, (r() - 0.5) * 2 * amp))));
    }
    this.ribbon(pts, pts.map((_, i) => w * 4 * (1 - i / (n + 2))), V.mul(col, 0.6), V.mul(col, 0.3), ctx);
    this.ribbon(pts, pts.map(() => w), [3 * col[0] / Math.max(col[0], 0.01) * 0.6 + col[0] * 0.5, 2.6, 3], [2, 2, 2.5], ctx, 3);
  }

  private pushRings(t: number) { void t; }

  // ------------------------------------------------------------------ drawing
  drawShadow(r: Renderer) {
    if (this.debris.high <= 0) return;
    const p = r.progs.debrisShadow.use();
    p.m4('uLightVP', r.lightVP).f('uTime', r.time).f('uShadowPass', 1);
    this.debris.draw();
  }
  drawSolid(r: Renderer) {
    this.rendererVP = r.vp;
    if (this.debris.high <= 0) return;
    const gl = r.gl;
    gl.enable(gl.CULL_FACE); gl.cullFace(gl.BACK);
    const p = r.applyScene(r.progs.debris);
    p.f('uShadowPass', 0);
    this.debris.draw();
    gl.disable(gl.CULL_FACE);
  }
  drawTransparent(r: Renderer) {
    const gl = r.gl;
    // shockwave rings / domes (additive)
    gl.blendFunc(gl.ONE, gl.ONE); gl.disable(gl.CULL_FACE);
    if (this.rings.length) {
      const p = r.progs.ring.use();
      p.m4('uVP', r.vp).v3('uCamPos', r.camPos).f('uTime', r.time);
      for (const s of this.rings) {
        const u = clamp((r.time - s.t0) / s.dur);
        if (u <= 0 || u >= 1) continue;
        const rr = ease('outCubic', u);
        const m = M.fromQP(Q.euler(rad(s.rot[0]), rad(s.rot[1]), rad(s.rot[2])), s.c, s.dome ? s.rmax * rr : s.rmax);
        p.m4('uModel', m).f('uMode', s.dome ? 1 : 0).f('uR', rr).f('uThick', s.thick / s.rmax * 1.0 + 0.04).v4('uColor', s.color[0], s.color[1], s.color[2], s.alpha * Math.pow(1 - u, 1.4));
        (s.dome ? this.sphere : this.disc).draw();
      }
    }
    // particles: alpha then additive
    const pp = r.progs.particle.use();
    pp.m4('uVP', r.vp).f('uTime', r.time).v3('uCamRight', r.camRight).v3('uCamUp', r.camUp).v3('uCamPos', r.camPos).fv('uAnchor', this.anchors, 3).f('uScaleAll', 1);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    pp.f('uAdditive', 0); this.alpha.draw();
    gl.blendFunc(gl.ONE, gl.ONE);
    pp.f('uAdditive', 1); this.add.draw();
    // glow batch
    if (this.glowMesh.vertexCount > 3) { r.progs.glow.use().m4('uVP', r.vp); this.glowMesh.draw(); }
  }
}
const r0 = (s: number) => { const x = Math.sin(s * 12.9898) * 43758.5453; return x - Math.floor(x); };
void snoise1;
