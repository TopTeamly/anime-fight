import { M, V, type M4, type V3 } from '../utils/math.js';
import { Program, RenderTarget, ShadowMap, createGL, type GL2 } from './gl.js';
import * as S from './shaders.js';
import { PostFX } from './post.js';
import type { CameraState, FlashLight, PostState } from '../scene/types.js';
import type { LightingState } from '../scene/lighting.js';
import type { Terrain, EnvDamage } from '../environment/terrain.js';
import type { RockField } from '../environment/rocks.js';
import type { Sky } from '../environment/sky.js';

export interface FighterDrawable {
  drawShadow(r: Renderer): void;
  drawBody(r: Renderer): void;
  drawAura(r: Renderer): void;
}
export interface VfxDrawable {
  drawShadow(r: Renderer): void;
  drawSolid(r: Renderer): void;
  drawTransparent(r: Renderer): void;
}
export interface Drawables { terrain: Terrain; damage: EnvDamage; rocks: RockField; sky: Sky; fighters: FighterDrawable[]; vfx: VfxDrawable }
export interface FrameInput { time: number; camera: CameraState; light: LightingState; post: PostState; flashes: FlashLight[]; focus: V3; world: Drawables }

export interface QualitySettings { scale: number; msaa: number; shadow: number; bloom: boolean; particles: number }
export const DEFAULT_QUALITY: QualitySettings = { scale: 1, msaa: 4, shadow: 2048, bloom: true, particles: 1 };

export class Renderer {
  gl: GL2;
  progs!: Record<'char' | 'shadow' | 'aura' | 'terrain' | 'crack' | 'rock' | 'rockShadow' | 'debris' | 'debrisShadow' | 'particle' | 'glow' | 'ring' | 'sky', Program>;
  shadow!: ShadowMap;
  scene!: RenderTarget;
  post!: PostFX;
  width = 1; height = 1;
  float = false;
  // per-frame state shared with drawables
  view: M4 = M.ident(); proj: M4 = M.ident(); vp: M4 = M.ident(); lightVP: M4 = M.ident();
  camPos: V3 = [0, 0, 0]; camRight: V3 = [1, 0, 0]; camUp: V3 = [0, 1, 0];
  time = 0;
  light!: LightingState;
  flashes: FlashLight[] = [];
  stats = { draws: 0, lastFrameMs: 0 };

  constructor(readonly canvas: HTMLCanvasElement, public quality: QualitySettings = { ...DEFAULT_QUALITY }) {
    const gl = (this.gl = createGL(canvas));
    this.float = !!gl.getExtension('EXT_color_buffer_float') || !!gl.getExtension('EXT_color_buffer_half_float');
    this.progs = {
      char: new Program(gl, S.CHAR_VS, S.CHAR_FS, 'char'),
      shadow: new Program(gl, S.SHADOW_VS, S.SHADOW_FS, 'shadow'),
      aura: new Program(gl, S.AURA_VS, S.AURA_FS, 'aura'),
      terrain: new Program(gl, S.TERRAIN_VS, S.TERRAIN_FS, 'terrain'),
      crack: new Program(gl, S.CRACK_VS, S.CRACK_FS, 'crack'),
      rock: new Program(gl, S.ROCK_VS, S.ROCK_FS, 'rock'),
      rockShadow: new Program(gl, S.ROCK_VS, S.SHADOW_FS, 'rockShadow'),
      debris: new Program(gl, S.DEBRIS_VS, S.ROCK_FS.replace('vCol*(0.9+0.1*step(0.5,fract(vW.y*0.42)))', 'vCol'), 'debris'),
      debrisShadow: new Program(gl, S.DEBRIS_VS, S.SHADOW_FS, 'debrisShadow'),
      particle: new Program(gl, S.PARTICLE_VS, S.PARTICLE_FS, 'particle'),
      glow: new Program(gl, S.GLOW_VS, S.GLOW_FS, 'glow'),
      ring: new Program(gl, S.RING_VS, S.RING_FS, 'ring'),
      sky: new Program(gl, S.SKY_VS, S.SKY_FS, 'sky'),
    };
    this.shadow = new ShadowMap(gl, this.quality.shadow);
    this.post = new PostFX(gl, this.float);
    this.resize(2, 2, true);
  }

  applyQuality() {
    this.shadow = new ShadowMap(this.gl, this.quality.shadow);
    this.resizeRaw(this.cssW, this.cssH, true);
  }

  private cssW = 2; private cssH = 2;
  resize(w: number, h: number, force = false) { this.resizeRaw(w, h, force); }
  private resizeRaw(cw: number, ch: number, force: boolean) {
    this.cssW = cw; this.cssH = ch;
    const w = Math.max(2, Math.floor(cw * this.quality.scale)), h = Math.max(2, Math.floor(ch * this.quality.scale));
    if (!force && w === this.width && h === this.height) return;
    this.width = w; this.height = h;
    this.canvas.width = w; this.canvas.height = h;
    this.scene?.dispose();
    this.scene = new RenderTarget(this.gl, w, h, { float: this.float, depth: true, samples: this.quality.msaa });
    this.post.resize(w, h);
  }

  /** world position -> uv (0..1) + visibility, using the last rendered camera */
  project(p: V3): { x: number; y: number; visible: boolean; depth: number } {
    const c = this.vp;
    const w = c[3] * p[0] + c[7] * p[1] + c[11] * p[2] + c[15];
    const x = (c[0] * p[0] + c[4] * p[1] + c[8] * p[2] + c[12]) / (w || 1);
    const y = (c[1] * p[0] + c[5] * p[1] + c[9] * p[2] + c[13]) / (w || 1);
    return { x: x * 0.5 + 0.5, y: y * 0.5 + 0.5, visible: w > 0 && Math.abs(x) < 1.4 && Math.abs(y) < 1.4, depth: w };
  }

  /** upload camera + lighting + shadow uniforms shared by every lit shader */
  applyScene(p: Program) {
    const L = this.light;
    p.use();
    p.m4('uVP', this.vp).v3('uCamPos', this.camPos).f('uTime', this.time);
    p.v3('uSunDir', L.sunDir).v3('uSunCol', L.sunCol).v3('uAmbSky', L.ambSky).v3('uAmbGround', L.ambGround);
    p.v3('uRimCol', L.rimCol).v3('uRimDir', L.rimDir).v3('uFogCol', L.fogCol).f('uFogDen', L.fogDen);
    const fp = new Float32Array(16), fc = new Float32Array(12);
    this.flashes.slice(0, 4).forEach((f, i) => { fp.set([f.pos[0], f.pos[1], f.pos[2], f.intensity], i * 4); fc.set(f.color, i * 3); });
    p.fv('uFlash', fp, 4).fv('uFlashCol', fc, 3);
    p.m4('uLightVP', this.lightVP).f('uShadowTexel', 1 / this.shadow.size).tex('uShadow', 7, this.shadow.tex);
    return p;
  }

  render(f: FrameInput) {
    const gl = this.gl;
    const t0 = performance.now();
    this.time = f.time; this.light = f.light; this.flashes = f.flashes;
    const aspect = this.width / this.height;
    const cam = f.camera;
    const fwd = V.norm(V.sub(cam.target, cam.pos));
    const upRef: V3 = Math.abs(fwd[1]) > 0.995 ? [0, 0, 1] : [0, 1, 0];
    const right0 = V.norm(V.cross(fwd, upRef));
    const up0 = V.cross(right0, fwd);
    const cr = Math.cos(cam.roll), sr = Math.sin(cam.roll);
    const up = V.add(V.mul(up0, cr), V.mul(right0, sr));
    this.camPos = cam.pos;
    this.view = M.lookAt(cam.pos, cam.target, up);
    this.proj = M.perspective(cam.fov, aspect, cam.near, cam.far);
    this.vp = M.mul(this.proj, this.view);
    this.camRight = [this.view[0], this.view[4], this.view[8]];
    this.camUp = [this.view[1], this.view[5], this.view[9]];
    // sun shadow: orthographic box centred on the fight
    const ext = 26, L = f.light.sunDir;
    const eye = V.add(f.focus, V.mul(L, 70));
    this.lightVP = M.mul(M.ortho(-ext, ext, -ext, ext, 1, 160), M.lookAt(eye, f.focus, Math.abs(L[1]) > 0.98 ? [0, 0, 1] : [0, 1, 0]));

    const W = f.world;
    W.rocks.update(cam.pos);
    this.stats.draws = 0;

    // ---- shadow pass
    this.shadow.bind();
    gl.enable(gl.DEPTH_TEST); gl.depthMask(true); gl.disable(gl.BLEND); gl.disable(gl.CULL_FACE);
    gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(2, 4);
    for (const fd of W.fighters) fd.drawShadow(this);
    this.progs.rockShadow.use().m4('uLightVP', this.lightVP).f('uTime', f.time);
    W.rocks.draw(true, this.progs.rockShadow);
    W.vfx.drawShadow(this);
    gl.disable(gl.POLYGON_OFFSET_FILL);

    // ---- main scene (HDR, multisampled)
    this.scene.bind();
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.disable(gl.DEPTH_TEST); gl.depthMask(false);
    const sky = this.progs.sky.use();
    sky.m4('uInvVP', M.invert(this.vp)).v3('uCamPos', cam.pos).f('uTime', f.time);
    sky.v3('uSkyTop', f.light.skyTop).v3('uSkyHor', f.light.skyHor).v3('uSunDir', f.light.sunDir).v3('uSunCol', f.light.sunCol).f('uGlow', f.light.glow);
    sky.v3('uCloudLit', f.light.cloudLit).v3('uCloudShade', f.light.cloudShade).f('uCloudCover', f.light.cloudCover).v2('uWind', f.light.wind, f.light.wind * 0.35).v3('uFogCol', f.light.fogCol);
    W.sky.draw();
    gl.enable(gl.DEPTH_TEST); gl.depthMask(true); gl.enable(gl.CULL_FACE); gl.cullFace(gl.BACK);

    const tp = this.applyScene(this.progs.terrain);
    W.damage.bind(tp, f.time);
    W.terrain.draw();

    if (W.damage.hasCracks) {
      gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false); gl.disable(gl.CULL_FACE);
      gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(-2, -2);
      const cp = this.progs.crack.use();
      cp.m4('uVP', this.vp).v3('uCamPos', cam.pos).v3('uFogCol', f.light.fogCol).f('uFogDen', f.light.fogDen).f('uGrow', 14);
      W.damage.bind(cp, f.time);
      W.damage.drawCracks();
      gl.disable(gl.POLYGON_OFFSET_FILL); gl.disable(gl.BLEND); gl.depthMask(true); gl.enable(gl.CULL_FACE);
    }

    this.applyScene(this.progs.rock);
    W.rocks.draw(false, this.progs.rock);

    for (const fd of W.fighters) fd.drawBody(this);
    W.vfx.drawSolid(this);

    gl.depthMask(false); gl.enable(gl.BLEND);
    for (const fd of W.fighters) fd.drawAura(this);
    W.vfx.drawTransparent(this);
    gl.disable(gl.BLEND); gl.depthMask(true);

    this.scene.resolve();
    this.post.run(this.scene, f.light, f.post, f.time, this.width, this.height);
    this.stats.lastFrameMs = performance.now() - t0;
  }
}
