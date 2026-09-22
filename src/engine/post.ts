import { Program, RenderTarget, type GL2 } from './gl.js';
import type { PostState } from '../scene/types.js';
import type { LightingState } from '../scene/lighting.js';

const VS = `#version 300 es
precision highp float;
out vec2 vUV;
void main(){ vec2 p = vec2(float((gl_VertexID<<1)&2), float(gl_VertexID&2)); vUV = p; gl_Position = vec4(p*2.-1.,0.,1.); }`;

const BRIGHT_FS = `#version 300 es
precision highp float; in vec2 vUV; uniform sampler2D uTex; uniform float uThresh; out vec4 o;
void main(){
  vec3 c = vec3(0.);
  vec2 t = 1./vec2(textureSize(uTex,0));
  c += texture(uTex,vUV+t*vec2(-1.,-1.)).rgb; c += texture(uTex,vUV+t*vec2(1.,-1.)).rgb;
  c += texture(uTex,vUV+t*vec2(-1.,1.)).rgb;  c += texture(uTex,vUV+t*vec2(1.,1.)).rgb;
  c *= 0.25;
  float l = max(c.r,max(c.g,c.b));
  float k = clamp((l-uThresh+0.5)/1.0,0.,1.); k = k*k;
  o = vec4(c*k,1.);
}`;
const DOWN_FS = `#version 300 es
precision highp float; in vec2 vUV; uniform sampler2D uTex; out vec4 o;
void main(){ vec2 t = 0.5/vec2(textureSize(uTex,0)); o = 0.25*(texture(uTex,vUV+t*vec2(-1.,-1.))+texture(uTex,vUV+t*vec2(1.,-1.))+texture(uTex,vUV+t*vec2(-1.,1.))+texture(uTex,vUV+t*vec2(1.,1.))); }`;
const BLUR_FS = `#version 300 es
precision highp float; in vec2 vUV; uniform sampler2D uTex; uniform vec2 uDir; out vec4 o;
void main(){
  vec2 t = uDir/vec2(textureSize(uTex,0));
  vec3 c = texture(uTex,vUV).rgb*0.2270270270;
  c += (texture(uTex,vUV+t*1.3846153846).rgb+texture(uTex,vUV-t*1.3846153846).rgb)*0.3162162162;
  c += (texture(uTex,vUV+t*3.2307692308).rgb+texture(uTex,vUV-t*3.2307692308).rgb)*0.0702702703;
  o = vec4(c,1.);
}`;

const COMPOSITE_FS = `#version 300 es
precision highp float; in vec2 vUV;
uniform sampler2D uScene; uniform sampler2D uB1; uniform sampler2D uB2; uniform sampler2D uB3;
uniform float uTime; uniform float uAspect; uniform float uExposure; uniform float uBloom; uniform float uContrast; uniform float uSat;
uniform float uVignette; uniform vec3 uGrade; uniform vec4 uFlash; uniform float uImpact; uniform vec3 uImpactTint;
uniform vec4 uSpeed; uniform vec3 uSpeedCol; uniform vec3 uRadial; uniform vec2 uWhip; uniform float uChroma; uniform float uHeat;
uniform float uFade; uniform float uGrain; uniform int uDistN; uniform vec4 uDist[6]; uniform float uDistThick[6];
out vec4 o;
float h11(float n){ return fract(sin(n*127.1)*43758.5453); }
float h21(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
float n2(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f); return mix(mix(h21(i),h21(i+vec2(1,0)),f.x),mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),f.x),f.y); }
vec3 aces(vec3 x){ return clamp((x*(2.51*x+0.03))/(x*(2.43*x+0.59)+0.14),0.,1.); }
vec3 sceneAt(vec2 uv){
  vec3 c;
  if(uChroma>0.0001){
    vec2 d = (uv-0.5)*uChroma;
    c = vec3(texture(uScene,uv+d).r, texture(uScene,uv).g, texture(uScene,uv-d).b);
  } else c = texture(uScene,uv).rgb;
  return c;
}
void main(){
  vec2 uv = vUV;
  // shockwave / heat distortion
  for(int i=0;i<6;i++){
    if(i>=uDistN) break;
    vec2 d = uv-uDist[i].xy; vec2 da = d*vec2(uAspect,1.);
    float dist = length(da);
    float x = (dist-uDist[i].z)/max(uDistThick[i],0.001);
    float ring = exp(-x*x)*uDist[i].w;
    uv += normalize(d+1e-5)*ring*0.05;
  }
  if(uHeat>0.){ uv += (vec2(n2(uv*vec2(14.,9.)+uTime*3.),n2(uv*vec2(11.,15.)-uTime*2.7))-0.5)*uHeat*0.012; }
  vec3 col;
  if(uRadial.x>0.001 || uWhip.x>0.001){
    vec3 acc=vec3(0.); float wsum=0.;
    for(int i=0;i<10;i++){
      float k = float(i)/9.;
      vec2 off = vec2(0.);
      if(uRadial.x>0.001) off += (uRadial.yz-uv)*uRadial.x*k*0.35;
      if(uWhip.x>0.001) off += vec2(cos(uWhip.y),sin(uWhip.y))*uWhip.x*(k-0.5)*0.5;
      float w = 1.-k*0.5; acc += sceneAt(uv+off)*w; wsum += w;
    }
    col = acc/wsum;
  } else col = sceneAt(uv);
  vec3 bloom = texture(uB1,uv).rgb*0.45+texture(uB2,uv).rgb*0.35+texture(uB3,uv).rgb*0.35;
  col += bloom*uBloom;
  col *= uExposure*uGrade;
  col = aces(col);
  col = (col-0.5)*uContrast+0.5;
  float lum = dot(col,vec3(0.299,0.587,0.114));
  col = mix(vec3(lum),col,uSat);
  vec2 vc = (vUV-0.5)*vec2(uAspect,1.);
  col *= 1.-uVignette*smoothstep(0.35,1.05,length(vc)*1.15);
  // speed lines: radial ink streaks around a centre, clear in the middle
  if(uSpeed.x>0.001){
    vec2 d = (vUV-uSpeed.yz)*vec2(uAspect,1.);
    float r = length(d), a = atan(d.y,d.x);
    float cells = 90.; float id = floor((a/6.2831+0.5)*cells+uSpeed.w*7.);
    float wdt = h11(id)*0.6+0.15; float len = 0.28+h11(id+9.)*0.5;
    float fa = fract((a/6.2831+0.5)*cells+uSpeed.w*7.);
    float line = smoothstep(wdt*0.5,0.,abs(fa-0.5)*1.0-0.02)*smoothstep(len,len+0.25,r)*step(0.35,h11(id+3.));
    col = mix(col, uSpeedCol, clamp(line*uSpeed.x,0.,1.)*0.9);
  }
  col += uFlash.rgb*uFlash.a;
  if(uImpact>0.5){
    float l = dot(col,vec3(0.299,0.587,0.114));
    float m = smoothstep(0.30,0.36,l);
    vec3 ink = uImpact<1.5 ? mix(vec3(0.02,0.02,0.04),vec3(1.),m) : mix(vec3(1.),vec3(0.02,0.02,0.04),m);
    vec2 d = (vUV-0.5)*vec2(uAspect,1.); float a = atan(d.y,d.x);
    float burst = smoothstep(0.55,1.,h11(floor(a*46.)))*smoothstep(0.12,0.5,length(d));
    ink = uImpact<1.5 ? mix(ink, vec3(0.02), burst*0.85) : mix(ink, vec3(1.), burst*0.85);
    ink *= mix(vec3(1.),uImpactTint,0.55);
    col = ink;
  }
  col = mix(col, vec3(0.), uFade);
  col = pow(max(col,0.), vec3(1./2.2));
  col += (h21(vUV*vec2(1024.,576.)+uTime)-0.5)*uGrain;
  o = vec4(col,1.);
}`;

/** bloom chain (1/4, 1/8, 1/16 resolution) + composite to the canvas */
export class PostFX {
  private bright: Program; private down: Program; private blur: Program; private comp: Program;
  private a: RenderTarget[] = []; private b: RenderTarget[] = [];
  private vao: WebGLVertexArrayObject;
  private w = 0; private h = 0;
  constructor(private gl: GL2, private float: boolean) {
    this.bright = new Program(gl, VS, BRIGHT_FS, 'bright');
    this.down = new Program(gl, VS, DOWN_FS, 'down');
    this.blur = new Program(gl, VS, BLUR_FS, 'blur');
    this.comp = new Program(gl, VS, COMPOSITE_FS, 'composite');
    this.vao = gl.createVertexArray()!;
  }
  resize(w: number, h: number) {
    this.w = w; this.h = h;
    for (const t of [...this.a, ...this.b]) t.dispose();
    this.a = []; this.b = [];
    for (const d of [4, 8, 16]) {
      const bw = Math.max(2, Math.floor(w / d)), bh = Math.max(2, Math.floor(h / d));
      this.a.push(new RenderTarget(this.gl, bw, bh, { float: this.float, depth: false, samples: 1 }));
      this.b.push(new RenderTarget(this.gl, bw, bh, { float: this.float, depth: false, samples: 1 }));
    }
  }
  private tri() { this.gl.bindVertexArray(this.vao); this.gl.drawArrays(this.gl.TRIANGLES, 0, 3); this.gl.bindVertexArray(null); }

  run(scene: RenderTarget, L: LightingState, P: PostState, time: number, canvasW: number, canvasH: number) {
    const gl = this.gl;
    gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND); gl.disable(gl.CULL_FACE);
    // bright pass into level 0, then downsample chain
    this.a[0].bind();
    this.bright.use().tex('uTex', 0, scene.tex).f('uThresh', L.bloomThresh);
    this.tri();
    for (let i = 1; i < 3; i++) {
      this.a[i].bind();
      this.down.use().tex('uTex', 0, this.a[i - 1].tex);
      this.tri();
    }
    for (let i = 0; i < 3; i++) {
      this.b[i].bind();
      this.blur.use().tex('uTex', 0, this.a[i].tex).v2('uDir', 1.4, 0);
      this.tri();
      this.a[i].bind();
      this.blur.use().tex('uTex', 0, this.b[i].tex).v2('uDir', 0, 1.4);
      this.tri();
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvasW, canvasH);
    const p = this.comp.use();
    p.tex('uScene', 0, scene.tex).tex('uB1', 1, this.a[0].tex).tex('uB2', 2, this.a[1].tex).tex('uB3', 3, this.a[2].tex);
    p.f('uTime', time).f('uAspect', canvasW / canvasH).f('uExposure', L.exposure).f('uBloom', L.bloom).f('uContrast', L.contrast).f('uSat', L.saturation);
    p.f('uVignette', L.vignette).v3('uGrade', L.grade);
    p.v4('uFlash', P.flash[0], P.flash[1], P.flash[2], P.flash[3]).f('uImpact', P.impact).v3('uImpactTint', P.impactTint);
    p.v4('uSpeed', P.speedLines, P.speedCx, P.speedCy, Math.floor(time * 24) % 97).v3('uSpeedCol', P.speedColor);
    p.v3('uRadial', [P.radial, P.radialCx, P.radialCy]).v2('uWhip', P.whip, P.whipAngle).f('uChroma', P.chroma).f('uHeat', P.heat);
    p.f('uFade', P.fade).f('uGrain', P.grain);
    const n = Math.min(6, P.distort.length);
    const d = new Float32Array(24), th = new Float32Array(6);
    for (let i = 0; i < n; i++) { const s = P.distort[i]; d.set([s.x, s.y, s.radius, s.amp], i * 4); th[i] = s.thick; }
    p.i('uDistN', n).fv('uDist', d, 4).fv('uDistThick', th, 1);
    this.tri();
  }
}
