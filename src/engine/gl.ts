import type { M4, V3 } from '../utils/math.js';

export type GL2 = WebGL2RenderingContext;

export class Program {
  readonly prog: WebGLProgram;
  private locs = new Map<string, WebGLUniformLocation | null>();
  constructor(readonly gl: GL2, vs: string, fs: string, readonly name = 'program') {
    const compile = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        const log = gl.getShaderInfoLog(s) || '';
        const numbered = src.split('\n').map((l, i) => `${i + 1}: ${l}`).join('\n');
        throw new Error(`[${name}] ${type === gl.VERTEX_SHADER ? 'vertex' : 'fragment'} shader error:\n${log}\n${numbered}`);
      }
      return s;
    };
    const v = compile(gl.VERTEX_SHADER, vs), f = compile(gl.FRAGMENT_SHADER, fs);
    this.prog = gl.createProgram()!;
    gl.attachShader(this.prog, v);
    gl.attachShader(this.prog, f);
    gl.linkProgram(this.prog);
    if (!gl.getProgramParameter(this.prog, gl.LINK_STATUS)) throw new Error(`[${name}] link error: ${gl.getProgramInfoLog(this.prog)}`);
    gl.deleteShader(v);
    gl.deleteShader(f);
  }
  use() { this.gl.useProgram(this.prog); return this; }
  loc(n: string) {
    let l = this.locs.get(n);
    if (l === undefined) { l = this.gl.getUniformLocation(this.prog, n); this.locs.set(n, l); }
    return l;
  }
  f(n: string, v: number) { const l = this.loc(n); if (l) this.gl.uniform1f(l, v); return this; }
  i(n: string, v: number) { const l = this.loc(n); if (l) this.gl.uniform1i(l, v); return this; }
  v2(n: string, a: number, b: number) { const l = this.loc(n); if (l) this.gl.uniform2f(l, a, b); return this; }
  v3(n: string, v: V3 | number[]) { const l = this.loc(n); if (l) this.gl.uniform3f(l, v[0], v[1], v[2]); return this; }
  v4(n: string, a: number, b: number, c: number, d: number) { const l = this.loc(n); if (l) this.gl.uniform4f(l, a, b, c, d); return this; }
  m4(n: string, m: M4) { const l = this.loc(n); if (l) this.gl.uniformMatrix4fv(l, false, m); return this; }
  fv(n: string, a: Float32Array | number[], size: 1 | 2 | 3 | 4) {
    const l = this.loc(n);
    if (!l) return this;
    const arr = a instanceof Float32Array ? a : new Float32Array(a);
    const g = this.gl;
    if (size === 1) g.uniform1fv(l, arr); else if (size === 2) g.uniform2fv(l, arr); else if (size === 3) g.uniform3fv(l, arr); else g.uniform4fv(l, arr);
    return this;
  }
  mv(n: string, a: Float32Array) { const l = this.loc(n); if (l) this.gl.uniformMatrix4fv(l, false, a); return this; }
  tex(n: string, unit: number, t: WebGLTexture | null, target: number = this.gl.TEXTURE_2D) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(target, t);
    const l = this.loc(n);
    if (l) gl.uniform1i(l, unit);
    return this;
  }
}

export interface Attrib { loc: number; size: number; }
export interface Layout { attribs: Attrib[]; stride: number; }

/** interleaved vertex layouts shared across the engine (stride in floats) */
export const LAYOUT = {
  /** pos3 nrm3 col3 */
  static: { attribs: [{ loc: 0, size: 3 }, { loc: 1, size: 3 }, { loc: 2, size: 3 }], stride: 9 } as Layout,
  /** pos3 nrm3 col3 bone2 weight2 mat1 */
  skinned: { attribs: [{ loc: 0, size: 3 }, { loc: 1, size: 3 }, { loc: 2, size: 3 }, { loc: 3, size: 2 }, { loc: 4, size: 2 }, { loc: 5, size: 1 }], stride: 14 } as Layout,
  /** pos3 uv2 col4 shape1 (glow batch) */
  glow: { attribs: [{ loc: 0, size: 3 }, { loc: 1, size: 2 }, { loc: 2, size: 4 }, { loc: 3, size: 1 }], stride: 10 } as Layout,
  /** pos3 aux4 (cracks) */
  crack: { attribs: [{ loc: 0, size: 3 }, { loc: 1, size: 4 }], stride: 7 } as Layout,
  /** pos2 */
  quad: { attribs: [{ loc: 0, size: 2 }], stride: 2 } as Layout,
};

export class Mesh {
  readonly vao: WebGLVertexArrayObject;
  readonly vbo: WebGLBuffer;
  readonly ibo: WebGLBuffer | null = null;
  vertexCount: number;
  indexCount = 0;
  indexType: number;
  private cap: number;
  constructor(readonly gl: GL2, readonly layout: Layout, verts: Float32Array, indices?: Uint16Array | Uint32Array, readonly dynamic = false) {
    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);
    this.vbo = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, verts, dynamic ? gl.DYNAMIC_DRAW : gl.STATIC_DRAW);
    this.cap = verts.byteLength;
    let off = 0;
    for (const a of layout.attribs) {
      gl.enableVertexAttribArray(a.loc);
      gl.vertexAttribPointer(a.loc, a.size, gl.FLOAT, false, layout.stride * 4, off * 4);
      off += a.size;
    }
    this.vertexCount = verts.length / layout.stride;
    this.indexType = gl.UNSIGNED_SHORT;
    if (indices) {
      this.ibo = gl.createBuffer()!;
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ibo);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
      this.indexCount = indices.length;
      this.indexType = indices instanceof Uint32Array ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT;
    }
    gl.bindVertexArray(null);
  }
  /** replace vertex data (dynamic meshes). Grows the buffer when needed. */
  update(verts: Float32Array, count = verts.length / this.layout.stride) {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    if (verts.byteLength > this.cap) { gl.bufferData(gl.ARRAY_BUFFER, verts, gl.DYNAMIC_DRAW); this.cap = verts.byteLength; }
    else gl.bufferSubData(gl.ARRAY_BUFFER, 0, verts, 0, count * this.layout.stride);
    this.vertexCount = count;
  }
  /** attach a per-instance buffer as extra attributes with divisor 1 */
  addInstances(buf: WebGLBuffer, attribs: Attrib[], strideFloats: number) {
    const gl = this.gl;
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    let off = 0;
    for (const a of attribs) {
      gl.enableVertexAttribArray(a.loc);
      gl.vertexAttribPointer(a.loc, a.size, gl.FLOAT, false, strideFloats * 4, off * 4);
      gl.vertexAttribDivisor(a.loc, 1);
      off += a.size;
    }
    gl.bindVertexArray(null);
  }
  draw(mode: number = this.gl.TRIANGLES, instances = 0) {
    const gl = this.gl;
    gl.bindVertexArray(this.vao);
    if (this.ibo) {
      if (instances > 0) gl.drawElementsInstanced(mode, this.indexCount, this.indexType, 0, instances);
      else gl.drawElements(mode, this.indexCount, this.indexType, 0);
    } else if (instances > 0) gl.drawArraysInstanced(mode, 0, this.vertexCount, instances);
    else gl.drawArrays(mode, 0, this.vertexCount);
    gl.bindVertexArray(null);
  }
  dispose() {
    this.gl.deleteVertexArray(this.vao);
    this.gl.deleteBuffer(this.vbo);
    if (this.ibo) this.gl.deleteBuffer(this.ibo);
  }
}

/** growable dynamic float buffer used to batch procedural geometry every frame */
export class FloatBatch {
  data: Float32Array;
  n = 0; // floats used
  constructor(cap = 4096) { this.data = new Float32Array(cap); }
  clear() { this.n = 0; }
  ensure(extra: number) {
    if (this.n + extra > this.data.length) {
      const d = new Float32Array(Math.max(this.data.length * 2, this.n + extra));
      d.set(this.data.subarray(0, this.n));
      this.data = d;
    }
  }
  push(...v: number[]) {
    this.ensure(v.length);
    for (let i = 0; i < v.length; i++) this.data[this.n++] = v[i];
  }
  view() { return this.data.subarray(0, this.n); }
}

/** color + depth render target (optionally multisampled renderbuffers with a resolve texture) */
export class RenderTarget {
  fbo: WebGLFramebuffer;
  tex: WebGLTexture;
  resolveFbo: WebGLFramebuffer | null = null;
  private colorRb: WebGLRenderbuffer | null = null;
  private depthRb: WebGLRenderbuffer | null = null;
  constructor(readonly gl: GL2, readonly w: number, readonly h: number, opts: { float: boolean; depth: boolean; samples: number; linear?: boolean }) {
    const fmt = opts.float ? gl.RGBA16F : gl.RGBA8;
    this.tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, fmt, w, h, 0, gl.RGBA, opts.float ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE, null);
    const filt = opts.linear === false ? gl.NEAREST : gl.LINEAR;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filt);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filt);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    if (opts.samples > 1) {
      // multisampled render buffers -> blit into `tex` on resolve()
      this.fbo = gl.createFramebuffer()!;
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
      this.colorRb = gl.createRenderbuffer()!;
      gl.bindRenderbuffer(gl.RENDERBUFFER, this.colorRb);
      gl.renderbufferStorageMultisample(gl.RENDERBUFFER, opts.samples, fmt, w, h);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, this.colorRb);
      if (opts.depth) {
        this.depthRb = gl.createRenderbuffer()!;
        gl.bindRenderbuffer(gl.RENDERBUFFER, this.depthRb);
        gl.renderbufferStorageMultisample(gl.RENDERBUFFER, opts.samples, gl.DEPTH_COMPONENT24, w, h);
        gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, this.depthRb);
      }
      this.resolveFbo = gl.createFramebuffer()!;
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.resolveFbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.tex, 0);
    } else {
      this.fbo = gl.createFramebuffer()!;
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.tex, 0);
      if (opts.depth) {
        this.depthRb = gl.createRenderbuffer()!;
        gl.bindRenderbuffer(gl.RENDERBUFFER, this.depthRb);
        gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, w, h);
        gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, this.depthRb);
      }
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }
  bind() {
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, this.fbo);
    this.gl.viewport(0, 0, this.w, this.h);
  }
  resolve() {
    if (!this.resolveFbo) return;
    const gl = this.gl;
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.fbo);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.resolveFbo);
    gl.blitFramebuffer(0, 0, this.w, this.h, 0, 0, this.w, this.h, gl.COLOR_BUFFER_BIT, gl.NEAREST);
  }
  dispose() {
    const gl = this.gl;
    gl.deleteTexture(this.tex);
    gl.deleteFramebuffer(this.fbo);
    if (this.resolveFbo) gl.deleteFramebuffer(this.resolveFbo);
    if (this.colorRb) gl.deleteRenderbuffer(this.colorRb);
    if (this.depthRb) gl.deleteRenderbuffer(this.depthRb);
  }
}

/** depth-only shadow map with hardware PCF comparison */
export class ShadowMap {
  fbo: WebGLFramebuffer;
  tex: WebGLTexture;
  constructor(readonly gl: GL2, readonly size: number) {
    this.tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT24, size, size, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL);
    this.fbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, this.tex, 0);
    gl.drawBuffers([gl.NONE]);
    gl.readBuffer(gl.NONE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }
  bind() {
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, this.fbo);
    this.gl.viewport(0, 0, this.size, this.size);
    this.gl.clear(this.gl.DEPTH_BUFFER_BIT);
  }
}

export function createGL(canvas: HTMLCanvasElement): GL2 {
  const gl = canvas.getContext('webgl2', {
    antialias: false, alpha: false, depth: false, stencil: false,
    preserveDrawingBuffer: true, powerPreference: 'high-performance',
  });
  if (!gl) throw new Error('WebGL2 is not available in this browser.');
  return gl;
}
