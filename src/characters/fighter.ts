import { V, Q, type V3 } from '../utils/math.js';
import { Mesh, LAYOUT, FloatBatch, type GL2 } from '../engine/gl.js';
import { MAX_BONES } from '../engine/shaders.js';
import type { FighterDrawable, Renderer } from '../engine/renderer.js';
import { hex } from '../engine/meshbuilder.js';
import { Rig, Skeleton, BI, type BoneName } from './rig.js';
import { buildBody } from './meshgen.js';
import { Chain, pushPrism, pushRibbon } from './dynamics.js';
import { FaceBuilder } from './face.js';
import type { CharacterSpec } from './spec.js';
import type { Pose, FKOverride } from '../animation/pose.js';

export interface FighterVisual {
  power: number;      // 0..1 awakening / power state
  rage: number;       // 0..1
  fatigue: number;    // 0..1
  aura: number;       // aura shell intensity
  auraMix: number;    // 0 base colours -> 1 power colours
  eyeGlow: number; hairGlow: number; bodyGlow: number; hairLift: number;
}
export const calmVisual = (): FighterVisual => ({ power: 0, rage: 0, fatigue: 0, aura: 0, auraMix: 0, eyeGlow: 0, hairGlow: 0, bodyGlow: 0, hairLift: 0 });

export interface FighterFrame {
  rootPos: V3; yaw: number; pose: Pose; visual: FighterVisual; time: number; fk?: FKOverride | null; wind: number;
}
export interface Ghost { skin: Float32Array; tint: V3; alpha: number }

const lin = (h: string): V3 => { const c = hex(h); return [c[0] ** 2.2, c[1] ** 2.2, c[2] ** 2.2]; };

interface HairChain { ch: Chain; group: string }
interface ClothChain { ch: Chain; bone: BoneName; w0: number; w1: number; c0: V3; c1: V3; tag: string }

/** A fully rigged fighter: skeleton, skinned body, simulated hair/cloth, facial decals and energy passes. */
export class Fighter implements FighterDrawable {
  readonly skel: Skeleton;
  readonly rig: Rig;
  readonly ghostRig: Rig;
  body: Mesh;
  bodyMB: ReturnType<typeof buildBody>['mb'];
  private hairMesh: Mesh; private clothMesh: Mesh; private faceMesh: Mesh;
  private hairB = new FloatBatch(20000); private clothB = new FloatBatch(20000); private faceB = new FloatBatch(20000);
  private hair: HairChain[] = []; private cloth: ClothChain[] = [];
  private face: FaceBuilder;
  ghosts: Ghost[] = [];
  private ghostPool: Float32Array[] = Array.from({ length: 8 }, () => new Float32Array(MAX_BONES * 16));
  visual: FighterVisual = calmVisual();
  private lastT = -1e9; private acc = 0;
  private c0: V3; private glowLin: V3; private aura1: V3; private aura2: V3; private aura3: V3; private aura4: V3; private glowRage: V3 = lin('#ff4a2a');
  outlineWidth = 0.0075;
  frame!: FighterFrame;

  constructor(private gl: GL2, readonly spec: CharacterSpec) {
    this.skel = new Skeleton(spec);
    this.rig = new Rig(this.skel);
    this.ghostRig = new Rig(this.skel);
    const built = buildBody(spec, this.skel);
    this.bodyMB = built.mb;
    this.body = built.mb.toSkinnedMesh(gl);
    const empty = new Float32Array(LAYOUT.skinned.stride * 3);
    this.hairMesh = new Mesh(gl, LAYOUT.skinned, empty, undefined, true);
    this.clothMesh = new Mesh(gl, LAYOUT.skinned, empty, undefined, true);
    this.faceMesh = new Mesh(gl, LAYOUT.skinned, empty, undefined, true);
    this.face = new FaceBuilder(spec, this.skel.bind[BI.head]);
    const S = spec.scale;
    const hc = hex(spec.hair), ht = hex(spec.hairTip);
    for (const c of spec.clumps) {
      const ch = new Chain(V.mul(c.at, S), c.dir, c.len * S, c.seg ?? 4, V.mul([c.dir[0] * 0.0, -0.05, c.dir[2] * 0.0], S * (c.curl ?? 1)), c.stiff, 0.9, 3.5);
      void hc; void ht;
      this.hair.push({ ch, group: c.group });
    }
    for (const c of spec.cloth) {
      const ch = new Chain(V.mul(c.at, S), c.dir, c.len * S, c.seg, [0, 0, 0], c.stiff, c.drag ?? 0.93, 7);
      this.cloth.push({ ch, bone: c.bone as BoneName, w0: c.w0 * S, w1: c.w1 * S, c0: hex(c.color), c1: hex(c.color2 ?? c.color), tag: c.tag });
    }
    this.c0 = hex(spec.hair);
    this.glowLin = lin(spec.glow);
    this.aura1 = lin(spec.aura.base); this.aura2 = lin(spec.aura.base2); this.aura3 = lin(spec.aura.power); this.aura4 = lin(spec.aura.power2);
  }

  /** world hit / anchor points used by choreography, camera and VFX */
  point(name: string, rig: Rig = this.rig): V3 {
    const r = rig, S = this.spec.scale;
    switch (name) {
      case 'head': return V.add(r.world('head'), Q.rotate(r.rot[BI.head], [0, 0.12 * S, 0.02 * S]));
      case 'eyes': return V.add(r.world('head'), Q.rotate(r.rot[BI.head], [0, 0.14 * S, 0.09 * S]));
      case 'chest': return V.lerp(r.world('chest'), r.world('spine'), 0.2);
      case 'gut': return r.world('spine');
      case 'hips': return r.world('hips');
      case 'feet': return V.lerp(r.world('footL'), r.world('footR'), 0.5);
      case 'fistL': return V.lerp(r.world('handL'), r.world('idxL1'), 0.6);
      case 'fistR': return V.lerp(r.world('handR'), r.world('idxR1'), 0.6);
      case 'footL': return r.world('toeL');
      case 'footR': return r.world('toeR');
      default: return r.world('root');
    }
  }

  apply(f: FighterFrame) {
    this.frame = f;
    this.visual = f.visual;
    this.rig.solve(f.pose, f.rootPos, f.yaw, f.fk);
    this.stepDynamics(f);
    this.rebuildDynamic(f);
  }

  private stepDynamics(f: FighterFrame) {
    const rig = this.rig;
    const anchor = (b: BoneName): [V3, ReturnType<typeof Q.ident>] => [rig.pos[BI[b]], rig.rot[BI[b]]];
    const jump = f.time < this.lastT - 1e-6 || f.time - this.lastT > 0.4;
    if (jump) {
      for (const h of this.hair) h.ch.reset(...anchor('head'));
      for (const c of this.cloth) c.ch.reset(...anchor(c.bone));
      this.lastT = f.time; this.acc = 0;
      for (let i = 0; i < 8; i++) this.stepOnce(f, 1 / 60, anchor);
      return;
    }
    this.acc += f.time - this.lastT; this.lastT = f.time;
    let n = 0;
    while (this.acc >= 1 / 60 && n < 6) { this.stepOnce(f, 1 / 60, anchor); this.acc -= 1 / 60; n++; }
    if (this.acc > 0.2) this.acc = 0;
  }
  private stepOnce(f: FighterFrame, dt: number, anchor: (b: BoneName) => [V3, ReturnType<typeof Q.ident>]) {
    const w = f.wind, wind: V3 = [w * (1.4 + Math.sin(f.time * 1.3)), 0.3 * Math.sin(f.time * 2.1), w * 0.7 * Math.cos(f.time * 0.9)];
    const lift = f.visual.hairLift;
    const [hp, hq] = anchor('head');
    for (const h of this.hair) h.ch.step(dt, hp, hq, wind, lift * (h.group === 'back' ? 0.6 : 0.9), f.time);
    for (const c of this.cloth) { const [p, q] = anchor(c.bone); c.ch.step(dt, p, q, V.mul(wind, 1.6), 0, f.time); }
  }

  private rebuildDynamic(f: FighterFrame) {
    const rig = this.rig;
    const hq = rig.rot[BI.head];
    const hc0 = hex(this.spec.hair), hc1 = hex(this.spec.hairTip);
    this.hairB.clear(); this.clothB.clear(); this.faceB.clear();
    const hs = Q.rotate(hq, [1, 0, 0]);
    for (const h of this.hair) pushPrism(this.hairB, h.ch, hs, this.spec.clumps[this.hair.indexOf(h)].w * this.spec.scale * 0.62, hc0, hc1);
    for (const c of this.cloth) {
      const q = rig.rot[BI[c.bone]], sd = Q.rotate(q, [1, 0, 0]);
      pushRibbon(this.clothB, c.ch, () => sd, c.w0, c.w1, c.c0, c.c1);
    }
    this.face.build(this.faceB, f.pose.face, f.pose.gaze, f.visual.eyeGlow);
    this.hairMesh.update(this.hairB.view(), this.hairB.n / LAYOUT.skinned.stride);
    this.clothMesh.update(this.clothB.view(), this.clothB.n / LAYOUT.skinned.stride);
    this.faceMesh.update(this.faceB.view(), this.faceB.n / LAYOUT.skinned.stride);
  }

  /** solve a pose into the ghost rig and return bone positions (for trails) */
  probe(frame: FighterFrame, names: BoneName[]): V3[] {
    this.ghostRig.solve(frame.pose, frame.rootPos, frame.yaw, frame.fk);
    return names.map((n) => [...this.ghostRig.pos[BI[n]]] as V3);
  }
  /** queue an afterimage of the given frame */
  addGhost(frame: FighterFrame, tint: V3, alpha: number) {
    if (this.ghosts.length >= this.ghostPool.length) return;
    this.ghostRig.solve(frame.pose, frame.rootPos, frame.yaw, frame.fk);
    const skin = this.ghostPool[this.ghosts.length];
    skin.set(this.ghostRig.skin);
    this.ghosts.push({ skin, tint, alpha });
  }
  clearGhosts() { this.ghosts.length = 0; }

  // ------------------------------------------------------------------ drawing
  drawShadow(r: Renderer) {
    const p = r.progs.shadow.use();
    p.m4('uLightVP', r.lightVP).mv('uBones', this.rig.skin).f('uSkin', 1);
    this.body.draw();
    p.f('uSkin', 0);
    if (this.hairMesh.vertexCount > 3) this.hairMesh.draw();
    if (this.clothMesh.vertexCount > 3) this.clothMesh.draw();
  }

  private glowUniforms(p: ReturnType<Renderer['applyScene']>) {
    const v = this.visual;
    const gc = V.lerp(this.glowLin, this.glowRage, Math.max(0, v.rage - v.power) * 0.8);
    const powerCol = v.power > 0.01 ? V.lerp(gc, this.aura3, v.power) : gc;
    p.v3('uGlowCol', powerCol).f('uHairGlow', v.hairGlow).f('uEyeGlow', v.eyeGlow).f('uBodyGlow', v.bodyGlow);
  }

  drawBody(r: Renderer) {
    const gl = r.gl;
    const p = r.applyScene(r.progs.char);
    this.glowUniforms(p);
    p.v4('uGhost', 0, 0, 0, 0);
    const dyn = (outline: number) => {
      p.f('uSkin', 0).f('uOutline', outline);
      if (this.hairMesh.vertexCount > 3) this.hairMesh.draw();
    };
    // outline (inverted hull)
    gl.enable(gl.CULL_FACE); gl.cullFace(gl.FRONT);
    p.mv('uBones', this.rig.skin).f('uSkin', 1).f('uOutline', this.outlineWidth * this.spec.scale);
    this.body.draw();
    dyn(this.outlineWidth * this.spec.scale * 0.8);
    gl.cullFace(gl.BACK);
    p.mv('uBones', this.rig.skin).f('uSkin', 1).f('uOutline', 0);
    this.body.draw();
    gl.disable(gl.CULL_FACE);
    p.f('uSkin', 0).f('uOutline', 0);
    if (this.hairMesh.vertexCount > 3) this.hairMesh.draw();
    if (this.clothMesh.vertexCount > 3) this.clothMesh.draw();
    p.f('uSkin', 1);
    gl.enable(gl.CULL_FACE);
    if (this.faceMesh.vertexCount > 3) this.faceMesh.draw();
    gl.disable(gl.CULL_FACE);
  }

  drawAura(r: Renderer) {
    const gl = r.gl, v = this.visual;
    gl.enable(gl.CULL_FACE); gl.cullFace(gl.BACK);
    if (v.aura > 0.01) {
      gl.blendFunc(gl.ONE, gl.ONE);
      const a = r.progs.aura.use();
      a.m4('uVP', r.vp).v3('uCamPos', r.camPos).f('uTime', r.time).mv('uBones', this.rig.skin);
      const c1 = V.lerp(this.aura1, this.aura3, v.auraMix), c2 = V.lerp(this.aura2, this.aura4, v.auraMix);
      a.v3('uAuraCol1', c1).v3('uAuraCol2', c2).f('uAuraInt', v.aura).f('uAuraW', 0.035 + 0.05 * v.aura);
      this.body.draw();
    }
    if (this.ghosts.length) {
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
      const p = r.applyScene(r.progs.char);
      p.f('uSkin', 1).f('uOutline', 0);
      for (const g of this.ghosts) { p.mv('uBones', g.skin).v4('uGhost', g.tint[0], g.tint[1], g.tint[2], g.alpha); this.body.draw(); }
      p.v4('uGhost', 0, 0, 0, 0);
    }
    gl.disable(gl.CULL_FACE);
  }
}
